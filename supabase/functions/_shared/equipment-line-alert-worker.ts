import { sendLineTextMessage, type LineTextMessageInput, type LineTextMessageResult } from './line-message.ts';
import { classifyLineAttempt } from './vehicle-dispatch-line-retry.ts';
import { constantTimeSecretEqual } from './vehicle-dispatch-line-worker.ts';

export type AlertClaim = { outbox_id: string; lease_token: string };
export type AlertPrepared = {
  outcome: 'ready' | 'suppressed' | 'lease_lost';
  line_user_id?: string;
  message_text?: string;
  attempts?: number;
  first_attempt_at?: string;
};
export type AlertStore = {
  loadToken(): Promise<string | null>;
  claim(now: string): Promise<AlertClaim[]>;
  prepare(job: AlertClaim, now: Date): Promise<AlertPrepared>;
  finish(job: AlertClaim, resolution: 'sent' | 'retry' | 'cancelled' | 'dead_letter' | 'uncertain',
    status: number | null, nextAttemptAt: string | null, now: Date): Promise<string>;
};
export type AlertWorkerDeps = {
  cronSecret: () => string;
  createStore: () => AlertStore | Promise<AlertStore>;
  sendMessage?: (input: LineTextMessageInput) => Promise<LineTextMessageResult>;
  now?: () => Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LINE_ID = /^U[0-9a-f]{32}$/i;
const MESSAGE_PREFIX = '⚠️ 中央巡檢設備異常';
const MESSAGE_URL = 'https://jnfakimo.github.io/Inspection/v2/systems/equipment/monitoring/';

export function createEquipmentLineAlertWorkerHandler(deps: AlertWorkerDeps) {
  const now = deps.now || (() => new Date());
  const send = deps.sendMessage || sendLineTextMessage;
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return Response.json({ ok: false, message: 'Method not allowed' }, { status: 405 });
    const secret = deps.cronSecret();
    if (!secret) return Response.json({ ok: false, message: 'Worker unavailable' }, { status: 503 });
    if (!constantTimeSecretEqual(secret, req.headers.get('x-cron-secret') || '')) {
      return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }
    let body: unknown;
    try { body = JSON.parse(await req.text() || '{}'); }
    catch { return Response.json({ ok: false, message: 'Invalid request' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => key !== 'mode')
      || (body as Record<string, unknown>).mode !== undefined
        && (body as Record<string, unknown>).mode !== 'production') {
      return Response.json({ ok: false, message: 'Invalid request' }, { status: 400 });
    }
    try {
      const store = await deps.createStore();
      const token = await store.loadToken();
      if (!token) return Response.json({ ok: false, message: 'Worker unavailable' }, { status: 503 });
      const jobs = await store.claim(now().toISOString());
      const counts = { claimed: jobs.length, sent: 0, retry: 0, cancelled: 0, dead_letter: 0, uncertain: 0, failed: 0 };
      for (const job of jobs) {
        try {
          const prepared = await store.prepare(job, now());
          if (prepared.outcome === 'lease_lost') continue;
          if (prepared.outcome === 'suppressed') {
            const state = await store.finish(job, 'cancelled', null, null, now());
            if (state === 'cancelled') counts.cancelled++;
            continue;
          }
          const text = prepared.message_text || '';
          if (!UUID.test(job.outbox_id) || !LINE_ID.test(prepared.line_user_id || '')
            || !text.startsWith(MESSAGE_PREFIX) || !text.endsWith(MESSAGE_URL)
            || text.length > 1000 || !Number.isInteger(prepared.attempts)
            || (prepared.attempts || 0) < 1 || !prepared.first_attempt_at) {
            const state = await store.finish(job, 'dead_letter', null, null, now());
            if (state === 'dead_letter') counts.dead_letter++;
            continue;
          }
          let result: LineTextMessageResult;
          try {
            result = await send({
              token, recipient: prepared.line_user_id!, text, retryKey: job.outbox_id,
            });
          } catch { result = { ok: false, status: null }; }
          const classified = classifyLineAttempt(result, {
            attempts: prepared.attempts!, firstAttemptAt: prepared.first_attempt_at!,
            now: now(),
          });
          const resolution = classified.resolution === 'accepted' ? 'sent'
            : classified.resolution === 'retry_wait' ? 'retry'
              : classified.resolution;
          const state = await store.finish(job, resolution, result.status, classified.nextAttemptAt, now());
          if (resolution === 'retry' && state === 'pending') counts.retry++;
          else if (state in counts && state !== 'claimed' && state !== 'failed') {
            counts[state as 'sent' | 'retry' | 'cancelled' | 'dead_letter' | 'uncertain']++;
          } else counts.failed++;
        } catch {
          // A lease expires and is reclaimed with the same LINE retry key.
          counts.failed++;
        }
      }
      return Response.json({ ok: true, data: counts }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return Response.json({ ok: false, message: 'Worker unavailable' }, { status: 503 });
    }
  };
}
