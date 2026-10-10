type ErrorWithContext = {
  context?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

type CaptchaPayload = {
  challenge_id?: unknown;
  image?: unknown;
};

const CAPTCHA_IMAGE_PREFIX = 'data:image/svg+xml;base64,';

/** Accepts only the documented CAPTCHA response shape and its inline SVG image. */
export function parseCaptchaPayload(value: unknown): { id: string; image: string } | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as CaptchaPayload;
  if (typeof payload.challenge_id !== 'string' || !payload.challenge_id.trim()) return null;
  if (typeof payload.image !== 'string' || !payload.image.startsWith(CAPTCHA_IMAGE_PREFIX)) return null;
  const encodedSvg = payload.image.slice(CAPTCHA_IMAGE_PREFIX.length);
  if (!encodedSvg || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSvg) || encodedSvg.length % 4 !== 0) return null;
  return { id: payload.challenge_id, image: payload.image };
}

function statusFromError(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as ErrorWithContext;
  const context = candidate.context;
  const status = typeof Response !== 'undefined' && context instanceof Response
    ? context.status
    : candidate.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

function captchaFailureCode(status: number | null, error: unknown): string {
  if (status === 429) return 'captcha_rate_limited';
  if (status === 404) return 'captcha_endpoint_not_found';
  if (status === 401 || status === 403) return 'captcha_access_denied';
  if (status === 503) return 'captcha_service_unavailable';
  if (status !== null && status >= 500) return 'captcha_server_error';
  if (status !== null && status >= 400) return 'captcha_request_rejected';
  if (status !== null) return 'captcha_invalid_response';

  const candidate = error && typeof error === 'object' ? error as ErrorWithContext : null;
  const text = `${String(candidate?.name || '')} ${String(candidate?.message || error || '')}`;
  return /abort|timeout|timed out/i.test(text) ? 'captcha_timeout' : 'captcha_network_error';
}

/** Formats a CAPTCHA-only diagnostic without exposing response bodies, URLs, or credentials. */
export function captchaFailureDiagnostic(error: unknown, fallback: string): string {
  const status = statusFromError(error);
  const code = captchaFailureCode(status, error);
  const detail = status === null ? `代碼 ${code}` : `HTTP ${status}／代碼 ${code}`;
  return `${fallback}（${detail}）`;
}
