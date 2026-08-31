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
const EDGE_API_TIMEOUT_MS = 15_000;
const READ_ACTION_LABELS: Record<string, string> = {
  profile: '讀取個人帳號資料',
  module_data: '讀取系統模組資料',
  workorder_list: '讀取報修與工單清單',
  workorder_options: '讀取報修表單選項',
  workorder_detail: '讀取報修與工單明細',
  dashboard: '讀取戰情儀表板資料',
  inspections: '讀取巡檢資料',
  equipment_map: '讀取設備地圖資料',
  official_documents: '讀取公文傳送資料',
  market_catalog: '讀取市場分析設定',
  market_analysis: '讀取交易行情分析',
  dashboard_market_rotation: '讀取戰情蔬果行情輪播',
};

// 公文流程的寫入動作固定走 Edge Function，避免舊版 Node API 尚未包含
// 自動取號／不可刪除時間軸時，前端先收到不支援或欄位錯誤。
const EDGE_ONLY_ACTIONS = new Set(['official_document_create', 'official_document_action', 'market_source_save', 'market_template_save', 'market_import_rows']);

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
  // 查詢直接走與資料庫同區的 Edge Function。Render 在低用量時會冷啟動，實測會先
  // 等滿 3～5 秒才回覆或進入 Edge 備援，導致每一頁的 AuthGate 與模組資料都延後。
  // 寫入仍沿用既有 Node-first 路徑，避免在尚未確認結果時跨兩個後端重送同一動作。
  if (nodeAppApiUrl && !READ_ACTION_LABELS[action] && !EDGE_ONLY_ACTIONS.has(action)) {
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
        // Render 服務可能仍在滾動部署舊版 handler；新 V2 動作先由 Edge
        // Function 提供，遇到明確的「不支援」才安全回退，其他業務錯誤仍直接呈現，
        // 避免把驗證失敗重送到第二個後端。
        if (result?.message !== '不支援的 API 動作') {
          reportIfInfrastructureError(result?.message, { action, via: 'node-api' });
          throw new Error(result?.message || '系統服務回傳失敗');
        }
        console.warn(`Node.js API 尚未支援 ${action}，改由 Supabase Edge Function 處理`);
      } else {
        recordAppRead(action);
        return result.data as T;
      }
    }
    if (response) {
      console.warn(`Node.js API returned ${response.status}; falling back to Supabase Edge Function`);
    }
  }

  const { data, error } = await getSupabase().functions.invoke('app-api', {
    body: { action, ...payload },
    timeout: EDGE_API_TIMEOUT_MS,
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
    if (/abort|timeout|timed out|failed to send/i.test(msg)) msg = '系統服務回應逾時，請稍後再試';
    throw new Error(`系統服務失敗：${msg}`);
  }
  if (!data?.ok) {
    reportIfInfrastructureError(data?.message, { action, via: 'edge-function' });
    throw new Error(data?.message || '系統服務回傳失敗');
  }
  recordAppRead(action);
  return data.data as T;
}
