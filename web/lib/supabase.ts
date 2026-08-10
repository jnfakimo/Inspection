'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

let client: SupabaseClient | null = null;

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
  const { data, error } = await getSupabase().functions.invoke('app-api', {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message || 'API 呼叫失敗');
  if (!data?.ok) throw new Error(data?.message || 'API 回傳失敗');
  return data.data as T;
}
