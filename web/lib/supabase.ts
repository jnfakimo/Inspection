'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;
const nodeAppApiUrl = process.env.NEXT_PUBLIC_APP_API_URL?.trim().replace(/\/$/, '');

export function getSupabase() {
  if (client) return client;
  if (typeof window === 'undefined') throw new Error('Supabase browser client is not available during prerendering');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

export async function invokeAppApi<T>(action: string, payload: Record<string, unknown> = {}) {
  if (nodeAppApiUrl) {
    const supabase = getSupabase();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) throw new Error('登入狀態無效，請重新登入');

    let response: Response;
    try {
      response = await fetch(`${nodeAppApiUrl}/api/app-api`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
      });
    } catch {
      throw new Error('Node.js API 連線失敗，請稍後再試');
    }

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.message || '系統服務回傳失敗');
    return result.data as T;
  }

  const { data, error } = await getSupabase().functions.invoke('app-api', {
    body: { action, ...payload },
  });
  if (error) throw new Error('系統服務連線失敗，請稍後再試');
  if (!data?.ok) throw new Error(data?.message || '系統服務回傳失敗');
  return data.data as T;
}
