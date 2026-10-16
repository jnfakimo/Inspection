import { sendLineTextMessage, type LineTextMessageInput, type LineTextMessageResult } from "./line-message.ts";
import { classifyLineAttempt } from "./vehicle-dispatch-line-retry.ts";

export const VEHICLE_DISPATCH_NOTICE_URL = "https://jnfakimo.github.io/Inspection/v2/systems/vehicle/requests/";
export const VEHICLE_DISPATCH_NOTICE_TEXT = `公務車派車資訊已更新，請登入系統查看：${VEHICLE_DISPATCH_NOTICE_URL}`;
export const VEHICLE_LINE_NOTIFICATION_TEST_TEXT = "公務車個人 LINE 通知測試：此為管理員發起的合成測試，沒有建立或變更任何派車案件。";
const BATCH_LIMIT = 20;
const LEASE_SECONDS = 90;
const LINE_USER_ID_PATTERN = /^U[0-9A-Fa-f]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VehicleDispatchLineClaim = { outbox_id: string; lease_token: string };
export type VehicleDispatchLinePrepared = {
  outcome: string;
  line_user_id?: string | null;
  retry_key?: string | null;
  message_text?: string | null;
  attempts?: number | null;
  first_attempt_at?: string | null;
};

export type VehicleDispatchLineWorkerStore = {
  loadChannelAccessToken(): Promise<string | null>;
  claim(input: { limit: number; leaseSeconds: number; now: string }): Promise<VehicleDispatchLineClaim[]>;
  prepare(input: { outboxId: string; leaseToken: string; now: string }): Promise<VehicleDispatchLinePrepared>;
  finish(input: {
    outboxId: string;
    leaseToken: string;
    resolution: "accepted" | "retry_wait" | "uncertain" | "dead_letter";
    httpStatus: number | null;
    errorCode: string | null;
    nextAttemptAt: string | null;
    acceptedRequestId: string | null;
    now: string;
  }): Promise<string>;
  claimTest(input: { testRunId: string; leaseSeconds: number; now: string }): Promise<VehicleDispatchLineClaim[]>;
  prepareTest(input: { testRunId: string; leaseToken: string; now: string }): Promise<VehicleDispatchLinePrepared>;
  finishTest(input: {
    testRunId: string;
    leaseToken: string;
    resolution: "accepted" | "uncertain" | "dead_letter";
    httpStatus: number | null;
    now: string;
  }): Promise<string>;
};

export type VehicleDispatchLineWorkerDependencies = {
  cronSecret: () => string;
  createStore: () => Promise<VehicleDispatchLineWorkerStore> | VehicleDispatchLineWorkerStore;
  sendMessage?: (input: LineTextMessageInput) => Promise<LineTextMessageResult>;
  now?: () => Date;
  random?: () => number;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Compare the full byte sequences without an early length or character exit. */
export function constantTimeSecretEqual(expected: string, supplied: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(supplied);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0 && a.length > 0;
}

function safePreparedNotice(prepared: VehicleDispatchLinePrepared): boolean {
  if (prepared.message_text !== VEHICLE_DISPATCH_NOTICE_TEXT) return false;
  try {
    const url = new URL(VEHICLE_DISPATCH_NOTICE_URL);
    return url.protocol === "https:" && url.hostname === "jnfakimo.github.io"
      && !/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(prepared.message_text);
  } catch {
    return false;
  }
}

function safePreparedTest(prepared: VehicleDispatchLinePrepared): boolean {
  return prepared.message_text === VEHICLE_LINE_NOTIFICATION_TEST_TEXT;
}

type WorkerMode = { kind: "production" } | { kind: "test"; testRunId: string };

async function readWorkerMode(req: Request): Promise<WorkerMode | null> {
  const text = await req.text();
  if (!text.trim()) return { kind: "production" };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (record.mode === undefined) return { kind: "production" };
  if (record.mode === "production") return { kind: "production" };
  if (record.mode !== "test" || Object.keys(record).some((key) => key !== "mode" && key !== "test_run_id")) return null;
  const testRunId = typeof record.test_run_id === "string" ? record.test_run_id : "";
  return UUID_PATTERN.test(testRunId) ? { kind: "test", testRunId } : null;
}

/** POST-only worker. Production is the default; test mode can address only one synthetic run id. */
export function createVehicleDispatchLineWorkerHandler(deps: VehicleDispatchLineWorkerDependencies) {
  const now = deps.now ?? (() => new Date());
  const sendMessage = deps.sendMessage ?? sendLineTextMessage;

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, message: "Method not allowed" }, 405);
    const configuredSecret = deps.cronSecret();
    if (!configuredSecret) return json({ ok: false, message: "Worker unavailable" }, 503);
    const suppliedSecret = req.headers.get("x-cron-secret") ?? "";
    if (!constantTimeSecretEqual(configuredSecret, suppliedSecret)) return json({ ok: false, message: "Unauthorized" }, 401);

    const mode = await readWorkerMode(req);
    if (!mode) return json({ ok: false, message: "Invalid worker mode" }, 400);

    try {
      const store = await deps.createStore();
      const token = await store.loadChannelAccessToken();
      if (!token) return json({ ok: false, message: "Worker unavailable" }, 503);

      const claimedAt = now();
      const jobs = mode.kind === "test"
        ? await store.claimTest({ testRunId: mode.testRunId, leaseSeconds: LEASE_SECONDS, now: claimedAt.toISOString() })
        : await store.claim({ limit: BATCH_LIMIT, leaseSeconds: LEASE_SECONDS, now: claimedAt.toISOString() });
      const counts = { claimed: jobs.length, accepted: 0, retry_wait: 0, uncertain: 0, dead_letter: 0, suppressed: 0, stale: 0, failed: 0 };

      for (const job of jobs) {
        try {
          const prepared = mode.kind === "test"
            ? await store.prepareTest({ testRunId: job.outbox_id, leaseToken: job.lease_token, now: now().toISOString() })
            : await store.prepare({ outboxId: job.outbox_id, leaseToken: job.lease_token, now: now().toISOString() });
          if (prepared.outcome !== "ready") {
            if (prepared.outcome === "suppressed" || prepared.outcome === "retry_window_expired") counts.suppressed++;
            else counts.stale++;
            continue;
          }

          if (!prepared.line_user_id || !LINE_USER_ID_PATTERN.test(prepared.line_user_id)
              || !prepared.retry_key || !UUID_PATTERN.test(prepared.retry_key)
              || !(mode.kind === "test" ? safePreparedTest(prepared) : safePreparedNotice(prepared))
              || !Number.isInteger(prepared.attempts) || (prepared.attempts ?? 0) < 1
              || !prepared.first_attempt_at) {
            const stored = mode.kind === "test"
              ? await store.finishTest({
                testRunId: job.outbox_id, leaseToken: job.lease_token, resolution: "dead_letter",
                httpStatus: 400, now: now().toISOString(),
              })
              : await store.finish({
                outboxId: job.outbox_id, leaseToken: job.lease_token, resolution: "dead_letter",
                httpStatus: null, errorCode: "invalid_payload", nextAttemptAt: null,
                acceptedRequestId: null, now: now().toISOString(),
              });
            if (stored === "dead_letter") counts.dead_letter++;
            else counts.stale++;
            continue;
          }

          let result: LineTextMessageResult;
          try {
            result = await sendMessage({
              token,
              recipient: prepared.line_user_id,
              text: prepared.message_text!,
              retryKey: prepared.retry_key,
            });
          } catch {
            result = { ok: false, status: null };
          }

          const attemptedAt = now();
          const stored = mode.kind === "test"
            ? await store.finishTest({
              testRunId: job.outbox_id,
              leaseToken: job.lease_token,
              resolution: result.ok ? "accepted"
                : result.status === null || result.status === 409 || result.status >= 500 ? "uncertain" : "dead_letter",
              httpStatus: result.status,
              now: attemptedAt.toISOString(),
            })
            : await (() => {
              const resolution = classifyLineAttempt(result, {
                attempts: prepared.attempts!,
                firstAttemptAt: prepared.first_attempt_at,
                now: attemptedAt,
                random: deps.random,
              });
              return store.finish({
                outboxId: job.outbox_id,
                leaseToken: job.lease_token,
                resolution: resolution.resolution,
                httpStatus: result.status,
                errorCode: resolution.errorCode,
                nextAttemptAt: resolution.nextAttemptAt,
                acceptedRequestId: resolution.resolution === "accepted" ? result.acceptedRequestId ?? null : null,
                now: attemptedAt.toISOString(),
              });
            })();
          if (stored in counts && stored !== "claimed" && stored !== "stale" && stored !== "failed" && stored !== "suppressed") {
            counts[stored as "accepted" | "retry_wait" | "uncertain" | "dead_letter"]++;
          } else if (stored === "lease_lost") counts.stale++;
          else counts.failed++;
        } catch {
          // The expired lease can safely be reclaimed using its unchanged LINE retry key.
          counts.failed++;
        }
      }

      return json({ ok: true, data: counts });
    } catch {
      // No request, recipient, message, credential, or provider response is logged.
      return json({ ok: false, message: "Worker unavailable" }, 503);
    }
  };
}
