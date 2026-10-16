import type { LineTextMessageResult } from "./line-message.ts";

export const LINE_MAX_ATTEMPTS = 8;
export const LINE_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export const LINE_BACKOFF_BASE_MS = 30 * 1000;
export const LINE_BACKOFF_CAP_MS = 30 * 60 * 1000;

export type LineRetryResolution = {
  resolution: "accepted" | "retry_wait" | "uncertain" | "dead_letter";
  errorCode: string | null;
  nextAttemptAt: string | null;
};

function exponentialBackoffMs(attempt: number, random: () => number): number {
  const exponent = Math.max(0, Math.min(20, Math.trunc(attempt) - 1));
  const ceiling = Math.min(LINE_BACKOFF_CAP_MS, LINE_BACKOFF_BASE_MS * 2 ** exponent);
  const sample = random();
  const normalized = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5;
  return Math.floor(ceiling * (0.5 + normalized * 0.5));
}

/**
 * LINE documents 2xx/409 as accepted, network/5xx as retryable and all 4xx as
 * non-retryable. Retrying reuses the immutable recipient, body and retry key.
 */
export function classifyLineAttempt(
  result: LineTextMessageResult,
  input: {
    attempts: number;
    firstAttemptAt: string;
    now: Date;
    random?: () => number;
  },
): LineRetryResolution {
  const status = result.status;
  if (status !== null && status >= 200 && status <= 299) {
    return { resolution: "accepted", errorCode: null, nextAttemptAt: null };
  }
  if (status === 409) {
    return result.acceptedRequestId
      ? { resolution: "accepted", errorCode: null, nextAttemptAt: null }
      : { resolution: "uncertain", errorCode: "line_conflict_without_id", nextAttemptAt: null };
  }
  if (status !== null && status >= 400 && status <= 499) {
    return { resolution: "dead_letter", errorCode: status === 429 ? "line_rate_limited" : "line_client_error", nextAttemptAt: null };
  }

  const retryableUnknown = status === null || status >= 500;
  if (!retryableUnknown) {
    return { resolution: "dead_letter", errorCode: "line_unexpected_status", nextAttemptAt: null };
  }

  const firstAttemptMs = Date.parse(input.firstAttemptAt);
  const nowMs = input.now.getTime();
  if (!Number.isFinite(firstAttemptMs) || nowMs >= firstAttemptMs + LINE_RETRY_WINDOW_MS) {
    return { resolution: "uncertain", errorCode: "retry_window_expired", nextAttemptAt: null };
  }
  if (input.attempts >= LINE_MAX_ATTEMPTS) {
    return { resolution: "uncertain", errorCode: "max_attempts", nextAttemptAt: null };
  }

  const random = input.random ?? Math.random;
  const nextMs = nowMs + exponentialBackoffMs(input.attempts, random);
  if (nextMs >= firstAttemptMs + LINE_RETRY_WINDOW_MS) {
    return { resolution: "uncertain", errorCode: "retry_window_expired", nextAttemptAt: null };
  }
  return { resolution: "retry_wait", errorCode: status === null ? "network_unknown" : "line_server_error", nextAttemptAt: new Date(nextMs).toISOString() };
}
