'use client';

/**
 * V2 的前端錯誤回報。
 *
 * V1 由 system/theme.js 自動注入 system/error-tracker.js，V2 一直沒有對應機制，
 * 後台「系統健康」因此只看得到 V1 頁面的錯誤——2026-08-20 查證時，最新一筆停在
 * 08-17，而那三天 V2 上實際發生過三個故障，一筆都沒被記錄。
 *
 * 沿用 V1 的兩條規則：
 * 1. 未登入不蒐集。錯誤只送到受信任 Edge Function，由後端綁定本人與伺服器
 *    時間；瀏覽器不能直接寫 client_error_logs 或偽造未來時間。
 * 2. 只留 origin + pathname，不保存 query 與 hash。
 *
 * 監聽器在版面掛載時就註冊、事件先進佇列，等 AuthGate 取得身分後才送出，
 * 這樣驗證完成前發生的錯誤不會漏掉。
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { getSupabase } from './supabase';

type Entry = {
  kind: 'js_error' | 'unhandled_rejection' | 'manual';
  message: string;
  detail: string | null;
  page: string;
  url: string;
  user_agent: string;
  occurred_at: string;
};

const MAX_QUEUE = 50; // 錯誤回報本身不可以無限累積
const queue: Entry[] = [];
let installed = false;
let flushing = false;
let userId: string | null = null;
let authUserId: string | null = null;
let profileGeneration = 0;

/** 瀏覽器延後 ResizeObserver 通知時送出的非致命警告，版面下一影格就會補上。 */
const isBenignResizeWarning = (message: unknown) =>
  /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\.?$/i
    .test(String(message ?? '').trim());

async function flush() {
  if (flushing || !userId || !queue.length) return;
  flushing = true;
  const currentUserId = userId;
  const currentAuthUserId = authUserId;
  const currentGeneration = profileGeneration;
  const batch = queue.splice(0, queue.length).slice(0, 10);
  try {
    const { data, error } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (profileGeneration !== currentGeneration || userId !== currentUserId || authUserId !== currentAuthUserId) return;
    if (error || !token || !currentAuthUserId || data.session?.user.id !== currentAuthUserId) return;
    for (const entry of batch) {
      if (profileGeneration !== currentGeneration || userId !== currentUserId || authUserId !== currentAuthUserId) break;
      const response = await fetch(`${SUPABASE_URL}/functions/v1/audit-event`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ event_type: 'client_error', error: entry }),
        signal: AbortSignal.timeout(8_000),
      });
      if (profileGeneration !== currentGeneration || userId !== currentUserId || authUserId !== currentAuthUserId) break;
      if (response.status === 401 || response.status === 403 || response.status === 429) break;
    }
  } catch {
    // 回報失敗就放棄這批，不重排隊——重試迴圈本身可能又觸發錯誤。
  } finally {
    flushing = false;
    if (userId && authUserId && queue.length) void flush();
  }
}

function report(kind: Entry['kind'], message: unknown, detail?: unknown) {
  try {
    if (queue.length >= MAX_QUEUE) return;
    queue.push({
      kind,
      message: String(message ?? '').slice(0, 2000),
      detail: detail ? JSON.stringify(detail).slice(0, 4000) : null,
      page: location.pathname.slice(0, 500),
      url: `${location.origin}${location.pathname}`.slice(0, 1000),
      user_agent: navigator.userAgent.slice(0, 500),
      occurred_at: new Date().toISOString(),
    });
    void flush();
  } catch {
    // 錯誤回報本身絕對不可以拋出例外。
  }
}

export function installErrorTracker() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', event => {
    if (isBenignResizeWarning(event.message)) { event.preventDefault?.(); return; }
    report('js_error', event.message, {
      source: event.filename, line: event.lineno, col: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', event => {
    const reason: unknown = event.reason;
    report('unhandled_rejection', reason instanceof Error ? reason.message : String(reason), {
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

/** AuthGate 取得身分後呼叫；在此之前的事件會留在佇列裡等這一刻送出。 */
export function setErrorTrackerUser(id: string | null, authId: string | null = null) {
  profileGeneration += 1;
  userId = id;
  authUserId = id && authId ? authId : null;
  if (userId) void flush();
  else queue.length = 0;
}

/**
 * 主動回報「已經被 catch、但仍屬重要異常」的情況。
 * 今天早上那三個故障都是這一類——被攔下來顯示成訊息，全域監聽器永遠看不到。
 */
export function reportHandledError(message: unknown, detail?: unknown) {
  report('manual', message, detail);
}

/**
 * 只回報「一看就是缺陷」的基礎設施錯誤，使用者的驗證訊息不記，避免灌爆紀錄。
 *
 * 2026-08-19 排班頁因為正式環境缺少 patrol_shift_template.status 整頁掛掉，訊息是
 * PostgREST 的 `column ... does not exist`；那類錯誤被 catch 起來顯示成畫面文字，
 * 全域監聽器看不到，於是故障持續了十六個小時都沒有任何紀錄。這個過濾器就是為了
 * 讓同一類事件下次會自己浮出來。
 */
const INFRA_ERROR = /does not exist|permission denied|schema cache|violates .* constraint|Could not find the .* function|JWSError|relation .* does not exist/i;

export function reportIfInfrastructureError(message: unknown, detail?: unknown) {
  const text = String(message ?? '');
  if (!INFRA_ERROR.test(text)) return;
  report('manual', text, detail);
}
