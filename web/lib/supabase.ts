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

    let response: Response | undefined;
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
      console.warn('Node.js API connection failed, falling back to Supabase Edge Function');
      // Do nothing, let it fall through to the Supabase Edge Function below
    }

    if (response) {
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.message || '系統服務回傳失敗');
      return result.data as T;
    }
  }

  const { data, error } = await getSupabase().functions.invoke('app-api', {
    body: { action, ...payload },
  });
  if (error) {
    console.error('Edge Function Error:', error);
    let msg = error.message || '連線失敗';
    if ((error as any).context && typeof (error as any).context.json === 'function') {
      try {
        const errData = await (error as any).context.json();
        if (errData?.message) msg = errData.message;
      } catch { /* ignore */ }
    }
    throw new Error(`Edge Function 失敗: ${msg}`);
  }
  if (!data?.ok) throw new Error(data?.message || '系統服務回傳失敗');
  return data.data as T;
}
