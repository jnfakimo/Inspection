'use client';

import { getSupabase } from './supabase';

const USERNAME_LOGIN_TIMEOUT_MS = 15_000;

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
  const { data, error } = await getSupabase().functions.invoke('username-login', {
    body,
    timeout: USERNAME_LOGIN_TIMEOUT_MS,
  });
  if (error) throw new Error(await localizedFunctionError(error, fallback));
  return data as T;
}
