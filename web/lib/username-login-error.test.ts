import test from 'node:test';
import assert from 'node:assert/strict';
import { captchaFailureDiagnostic, parseCaptchaPayload } from './username-login-error.ts';

const fallback = '驗證碼載入失敗，請稍後再試';

test('CAPTCHA HTTP failures expose only a safe status and diagnostic code', () => {
  const error = Object.assign(new Error('private backend details'), {
    context: new Response(JSON.stringify({ message: 'sensitive body content' }), { status: 503 }),
  });
  const diagnostic = captchaFailureDiagnostic(error, fallback);

  assert.equal(diagnostic, `${fallback}（HTTP 503／代碼 captcha_service_unavailable）`);
  assert.doesNotMatch(diagnostic, /private backend|sensitive body/);
});

test('CAPTCHA status codes distinguish throttling, missing route, and denied access', () => {
  assert.match(captchaFailureDiagnostic({ context: new Response('', { status: 429 }) }, fallback), /HTTP 429／代碼 captcha_rate_limited/);
  assert.match(captchaFailureDiagnostic({ context: new Response('', { status: 404 }) }, fallback), /HTTP 404／代碼 captcha_endpoint_not_found/);
  assert.match(captchaFailureDiagnostic({ context: new Response('', { status: 403 }) }, fallback), /HTTP 403／代碼 captcha_access_denied/);
});

test('network and timeout diagnostics never expose raw transport text', () => {
  const network = captchaFailureDiagnostic(new Error('fetch https://example.test/?apikey=secret failed'), fallback);
  const timeout = captchaFailureDiagnostic(new Error('Request timed out: secret-value'), fallback);

  assert.equal(network, `${fallback}（代碼 captcha_network_error）`);
  assert.equal(timeout, `${fallback}（代碼 captcha_timeout）`);
  assert.doesNotMatch(`${network} ${timeout}`, /example\.test|apikey|secret/i);
});

test('the documented CAPTCHA success contract is accepted as an inline SVG image', () => {
  const payload = {
    ok: true,
    challenge_id: '00000000-0000-4000-8000-000000000001',
    image: 'data:image/svg+xml;base64,PHN2Zy8+',
    expires_in: 300,
  };
  assert.deepEqual(parseCaptchaPayload(payload), { id: payload.challenge_id, image: payload.image });
});

test('malformed CAPTCHA payloads and non-inline image URLs are rejected', () => {
  assert.equal(parseCaptchaPayload({ challenge_id: 'synthetic', image: '' }), null);
  assert.equal(parseCaptchaPayload({ challenge_id: '', image: 'data:image/svg+xml;base64,PHN2Zy8+' }), null);
  assert.equal(parseCaptchaPayload({ challenge_id: 'synthetic', image: 'https://example.test/captcha.svg' }), null);
  assert.equal(parseCaptchaPayload({ challenge_id: 'synthetic', image: 'data:image/svg+xml;base64,%%%=' }), null);
});
