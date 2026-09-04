'use client';

export async function invokeAdminApi<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  const response = await fetch('/api/local/admin/action', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.detail || result?.message || '地端後台服務失敗');
  return result as T;
}
