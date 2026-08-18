'use client';

import { getSupabase } from './supabase';

export type GoogleCalendarStatus = {
  connected: boolean;
  google_email?: string | null;
  status?: string | null;
  connected_at?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
};

export async function invokeGoogleCalendar<T>(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await getSupabase().functions.invoke('google-calendar', {
    body: { action, ...payload },
  });
  if (error) throw new Error('Google 行事曆服務連線失敗，請稍後再試');
  if (!data?.ok) throw new Error(data?.message || 'Google 行事曆操作失敗');
  return data.data as T;
}

export function openPersonalProfile() {
  window.dispatchEvent(new CustomEvent('open-personal-profile'));
}
