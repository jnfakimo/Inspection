'use client';

import { getSupabase } from './supabase';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { captchaFailureDiagnostic } from './username-login-error';
import { shouldUseSameOriginUsernameLogin } from './username-login-routing';

const USERNAME_LOGIN_TIMEOUT_MS = 15_000;

async function invokeSameOrigin(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), USERNAME_LOGIN_TIMEOUT_MS);
  try {
    const response = await fetch(`${window.location.origin}/functions/v1/username-login`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(payload?.message || `登入服務回應 ${response.status}`));
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

async function invokePublicLogin(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), USERNAME_LOGIN_TIMEOUT_MS);
  try {
    const response = await fetch(SUPABASE_URL + '/functions/v1/username-login', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('登入服務回應 ' + response.status) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error('驗證服務回應逾時，請稍後再試');
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
async function localizedFunctionError(error: unknown, fallback: string, isCaptcha: boolean) {
  if (isCaptcha) return captchaFailureDiagnostic(error, fallback);

  const context = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== 'undefined' && context instanceof Response) {
    try {
      const payload = await context.clone().json() as { message?: unknown };
      if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
    } catch { /* 回應不是 JSON 時改用下方的繁體中文訊息。 */ }
  }

  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error || '');
  if (/abort|timeout|timed out|failed to send/i.test(raw)) return '系統服務回應逾時，請稍後再試';
  return fallback;
}

export async function invokeUsernameLogin<T>(
  body: Record<string, unknown>,
  fallback: string,
  options?: { retries?: number }
): Promise<T> {
  const isCaptcha = body.action === 'captcha';
  // CAPTCHA requests insert a challenge row, so they must never be replayed automatically.
  const maxRetries = isCaptcha ? 0 : options?.retries ?? 0;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      // CAPTCHA is public; bypass the Auth-aware Functions transport so an old session cannot block its request.
      if (body.action === 'captcha') {
        try {
          return await invokePublicLogin(body) as T;
        } catch (error) {
          throw new Error(await localizedFunctionError(error, fallback, true));
        }
      }
      // Non-loopback IPv4 hosts may be self-hosted reverse proxies.
      // Loopback development uses the already configured Supabase Functions client.
      if (typeof window !== 'undefined' && shouldUseSameOriginUsernameLogin(window.location.hostname)) {
        try {
          return await invokeSameOrigin(body) as T;
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          // Do not fallback or retry on deliberate 4xx client errors (e.g. 400 bad captcha, 401 wrong password, 429 rate limit).
          if (typeof status === 'number' && status >= 400 && status < 500) {
            throw new Error(await localizedFunctionError(error, fallback, isCaptcha));
          }
          // A 5xx or lost response may still have inserted a challenge; do not send it again elsewhere.
          if (isCaptcha) throw new Error(await localizedFunctionError(error, fallback, true));
          // On same-origin connection/server failure (5xx or fetch error), use the configured Supabase Functions client
          try {
            const { data: cloudData, error: cloudError } = await getSupabase().functions.invoke('username-login', {
              body,
              timeout: USERNAME_LOGIN_TIMEOUT_MS,
            });
            if (!cloudError && cloudData) return cloudData as T;
          } catch { /* ignore cloud fallback error and throw localized error below */ }
          throw error;
        }
      }

      const { data, error } = await getSupabase().functions.invoke('username-login', {
        body,
        timeout: USERNAME_LOGIN_TIMEOUT_MS,
      });
      if (error) {
        throw new Error(await localizedFunctionError(error, fallback, isCaptcha));
      }
      return data as T;
    } catch (err) {
      lastError = err;
      const errorText = err instanceof Error ? err.message : String(err || '');
      // Do not retry client validation errors or explicit user-facing status messages
      if (attempt <= maxRetries && !/帳號|密碼|驗證碼錯誤|頻繁|無效/i.test(errorText)) {
        await new Promise(resolve => setTimeout(resolve, attempt * 400));
        continue;
      }
      throw err;
    }
  }

  throw new Error(await localizedFunctionError(lastError, fallback, isCaptcha));
}
