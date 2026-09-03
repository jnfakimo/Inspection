'use client';

import { getSupabase } from './supabase';
import { SUPABASE_ANON_KEY } from './config';

const USERNAME_LOGIN_TIMEOUT_MS = 15_000;

const isIpAddress = (hostname: string) => /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname);

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

export async function invokeUsernameLogin<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  // Self-hosted deployments are commonly opened by IP with a router port
  // (e.g. https://1.34.250.22:5057). Force the request to the same origin so
  // the browser never silently falls back to the cloud Supabase URL.
  if (typeof window !== 'undefined' && (isIpAddress(window.location.hostname)
    || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    try {
      return await invokeSameOrigin(body) as T;
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      // Do not retry a deliberate API response (bad credentials, expired
      // captcha, rate limit, etc.); only surface a localized network error.
      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new Error(await localizedFunctionError(error, fallback));
      }
      throw new Error(await localizedFunctionError(error, fallback));
    }
  }
  const { data, error } = await getSupabase().functions.invoke('username-login', {
    body,
    timeout: USERNAME_LOGIN_TIMEOUT_MS,
  });
  if (error) throw new Error(await localizedFunctionError(error, fallback));
  return data as T;
}
