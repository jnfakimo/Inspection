'use client';

// 正式地端部署由同一個站台同時提供前端與 API，避免瀏覽器跨連接埠限制。
const LOCAL_API_URL = (process.env.NEXT_PUBLIC_LOCAL_API_URL || '').replace(/\/$/, '');

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${LOCAL_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail || body?.message || '地端服務連線失敗');
  return body as T;
}

export const localAuth = {
  login: (username: string, password: string) => request('/api/local/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  me: <T>() => request<T>('/api/local/auth/me'),
  logout: () => request('/api/local/auth/logout', { method: 'POST' }),
};
