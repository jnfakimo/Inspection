'use client';

import { getSupabase } from './supabase';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

const USERNAME_LOGIN_TIMEOUT_MS = 15_000;

async function invokePublicLogin(body: Record<string, unknown>) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), USERNAME_LOGIN_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/username-login`, {
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
  } catch (error) {
    if (controller.signal.aborted) throw new Error('驗證服務回應逾時，請稍後再試');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function localizedFunctionError(error: unknown, fallback: string) {
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
  const maxRetries = options?.retries ?? (body.action === 'captcha' ? 2 : 0);
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      // Captcha is public and must not wait for an old Auth session to refresh.
      if (body.action === 'captcha') return await invokePublicLogin(body) as T;
      // Follow the configured backend: Next.js development has no Edge routes.
      if (typeof window !== 'undefined' && SUPABASE_URL === window.location.origin) {
        try {
          return await invokePublicLogin(body) as T;
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          // Do not fallback or retry on deliberate 4xx client errors (e.g. 400 bad captcha, 401 wrong password, 429 rate limit).
          if (typeof status === 'number' && status >= 400 && status < 500) {
            throw new Error(await localizedFunctionError(error, fallback));
          }
          // On same-origin connection/server failure (5xx or fetch error), attempt cloud fallback
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
        const context = (error as { context?: unknown } | null)?.context;
        if (typeof Response !== 'undefined' && context instanceof Response && context.status >= 400 && context.status < 500) {
          throw new Error(await localizedFunctionError(error, fallback));
        }
        throw new Error(await localizedFunctionError(error, fallback));
      }
      return data as T;
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number } | null)?.status;
      const errorText = err instanceof Error ? err.message : String(err || '');
      // Do not retry client validation errors or explicit user-facing status messages
      if (attempt <= maxRetries && !(typeof status === 'number' && status >= 400 && status < 500)
        && !/帳號|密碼|驗證碼錯誤|頻繁|無效/i.test(errorText)) {
        await new Promise(resolve => setTimeout(resolve, attempt * 400));
        continue;
      }
      throw err;
    }
  }

  throw new Error(await localizedFunctionError(lastError, fallback));
}
