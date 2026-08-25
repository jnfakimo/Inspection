'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { reportIfInfrastructureError } from './error-tracker';
import { emitSecurityDataRead } from './security-audit-sink';

let client: SupabaseClient | null = null;
const nodeAppApiUrl = process.env.NEXT_PUBLIC_APP_API_URL?.trim().replace(/\/$/, '');
// Render 的免費／低用量服務可能需要冷啟動；不能讓前端無限等待。
// 逾時後沿用既有的 Supabase Edge Function 備援，讓畫面可繼續工作。
const NODE_API_TIMEOUT_MS = 5000;
const READ_ACTION_LABELS: Record<string, string> = {
  profile: '讀取個人帳號資料',
  module_data: '讀取系統模組資料',
  workorder_list: '讀取報修與工單清單',
  workorder_options: '讀取報修表單選項',
  workorder_detail: '讀取報修與工單明細',
  dashboard: '讀取戰情儀表板資料',
  inspections: '讀取巡檢資料',
  equipment_map: '讀取設備地圖資料',
};

const recordAppRead = (action: string) => {
  const label = READ_ACTION_LABELS[action];
  if (label) emitSecurityDataRead(label);
};

const isTransientNodeResponse = (response: Response) => (
  response.status === 408 || response.status === 429 || response.status >= 500
);

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
    let timeoutId: number | undefined;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), NODE_API_TIMEOUT_MS);
      response = await fetch(`${nodeAppApiUrl}/api/app-api`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      console.warn('Node.js API connection timed out or failed; falling back to Supabase Edge Function');
      // Do nothing, let it fall through to the Supabase Edge Function below
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }

    if (response && !isTransientNodeResponse(response)) {
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        reportIfInfrastructureError(result?.message, { action, via: 'node-api' });
        throw new Error(result?.message || '系統服務回傳失敗');
      }
      recordAppRead(action);
      return result.data as T;
    }
    if (response) {
      console.warn(`Node.js API returned ${response.status}; falling back to Supabase Edge Function`);
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
  if (!data?.ok) {
    reportIfInfrastructureError(data?.message, { action, via: 'edge-function' });
    throw new Error(data?.message || '系統服務回傳失敗');
  }
  recordAppRead(action);
  return data.data as T;
}
