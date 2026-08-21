'use client';

// 讀取存取稽核 —— V1 system/theme.js `installReadAccessAudit` 的移植。
//
// 為什麼需要這一份：資安告警（security_alerts）不是資料庫觸發器產生的，而是由前端
// 呼叫 audit-event edge function、由該函式在 5 分鐘視窗內判定「非互動高頻讀取」後
// 建立。呼叫端**只有 V1 的 theme.js**；V2 完全沒有，因此每一個搬到 V2 的頁面都會讓
// 這條線少一份訊號。等 V1 停用，資安告警與操作稽核的「讀取面」會直接歸零，而且不會
// 有任何錯誤訊息——畫面只是空的。
//
// payload 逐欄比照 V1，偵測邏輯與既有資料格式一行都不用改：
//   event_type：data_read / file_read / access_denied
//   details.access_origin：user_action（15 秒內有互動）或 page_load
//   details.user_initiated：布林。**必須是布林不是字串**——audit-event 用嚴格比較
//     `=== false` 篩選自動化讀取，送成 "false" 會讓該筆永遠不列入判定。
//   details.resource：資料表名或「儲存區/物件路徑」，偵測用它算「跨幾個資源」。
// actor 由 edge function 從 JWT 自行取得，前端不必也不該送。
//
// 攔截點是 window.fetch：supabase-js 與 storage 都走它，包在這一層就不必修改任何
// 呼叫端，也不會漏掉日後新增的查詢。

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

const USER_ACTIVITY_WINDOW_MS = 15_000;   // 15 秒內有互動即視為使用者主動讀取
const DEDUPE_WINDOW_MS = 1_200;           // 同頁同資源同狀態 1.2 秒內只送一次
const SEND_TIMEOUT_MS = 8_000;

// 稽核自己的資料表不列入，否則查看稽核頁會不斷產生新的稽核紀錄。
const SKIPPED_TABLES = new Set(['audit_logs', 'security_alerts']);

type ReadMeta = {
  kind: 'data' | 'file';
  resource: string;
  method: string;
  path: string;
  suspicious: boolean;
};

let installed = false;
let lastActivityAt = 0;
const recentReads = new Map<string, number>();

function safeText(value: unknown, max: number) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function decodePath(value: string) {
  try { return decodeURIComponent(value); } catch { return String(value || ''); }
}

function pageInfo() {
  const path = location.pathname.split('/').filter(Boolean).pop() || 'index';
  return {
    system: path.replace(/\.html$/i, ''),
    page: safeText(document.title || path, 160),
    path,
    hash: safeText(location.hash, 160),
    url: safeText(location.pathname + location.search + location.hash, 500),
  };
}

function isUserInitiated() {
  return lastActivityAt > 0 && Date.now() - lastActivityAt <= USER_ACTIVITY_WINDOW_MS;
}

/** 判斷這次 fetch 是否為需要記錄的讀取；不是就回 null。 */
function readMeta(input: RequestInfo | URL, init?: RequestInit): ReadMeta | null {
  const raw = typeof input === 'string' ? input
    : input instanceof URL ? input.href
    : (input as Request)?.url || '';
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw, location.href); } catch { return null; }

  const method = String(
    init?.method || (input instanceof Request ? input.method : '') || 'GET',
  ).toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;

  const rest = url.pathname.match(/\/rest\/v1\/([^/]+)/i);
  if (rest) {
    const table = decodePath(rest[1]);
    if (!table || SKIPPED_TABLES.has(table)) return null;
    return { kind: 'data', resource: table, method, path: url.pathname, suspicious: false };
  }

  const marker = '/storage/v1/object/';
  const position = url.pathname.indexOf(marker);
  if (position < 0) return null;
  const storagePath = decodePath(url.pathname.slice(position + marker.length));
  const parts = storagePath.split('/').filter(Boolean);
  if (['public', 'sign', 'authenticated'].includes(parts[0])) parts.shift();
  const bucket = parts.shift() || '未知儲存區';
  const objectPath = parts.join('/');
  // 目錄跳脫與敏感檔名：V1 在這裡直接擋下並記成 access_denied，不是只記錄。
  const suspicious = /(^|\/)\.\.(\/|$)/.test(storagePath)
    || /(^|\/)(?:\.env|\.git|id_rsa|service[_-]?role|private[_-]?key)(?:\/|$)/i.test(storagePath);
  return {
    kind: 'file',
    resource: bucket + (objectPath ? `/${objectPath}` : ''),
    method, path: url.pathname, suspicious,
  };
}

async function sendAuditEvent(eventType: string, details: Record<string, unknown>) {
  // 動態載入避免與 lib/supabase 互相 import；此處只需要目前的 access token。
  const { getSupabase } = await import('./supabase');
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;   // 尚未登入：沒有身分就沒有可稽核的對象

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/audit-event`, {
      method: 'POST',
      keepalive: true,
      signal: controller.signal,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_id: crypto.randomUUID(),
        event_type: eventType,
        details,
        page: pageInfo(),
        occurred_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) return;
    const body = await response.json().catch(() => null);
    // 大量讀取切斷：這是實際的資安控制，不是提示，收到就必須照做。
    if (body?.security_action) await enforceSecurityAction(String(body.security_action));
  } catch {
    // 稽核失敗不能影響使用者操作，也不重試——重試只會在異常時放大流量。
  } finally {
    window.clearTimeout(timer);
  }
}

async function enforceSecurityAction(action: string) {
  if (action !== 'force_logout' && action !== 'session_block') return;
  try {
    const { getSupabase } = await import('./supabase');
    await getSupabase().auth.signOut({ scope: 'local' });
  } catch { /* 仍要導離 */ }
  location.replace('/Inspection/v2/login/?security=bulk-read');
}

function recordRead(meta: ReadMeta, response: Response | null, error: unknown) {
  const status = response ? Number(response.status) || 0 : 0;
  const denied = meta.suspicious || status === 401 || status === 403;
  const eventType = denied ? 'access_denied' : (meta.kind === 'file' ? 'file_read' : 'data_read');
  const result = meta.suspicious ? '系統已阻擋可疑路徑'
    : response ? (response.ok ? '讀取成功' : '讀取失敗') : '網路錯誤';

  const key = [pageInfo().path, eventType, meta.kind, meta.resource, status].join('|');
  const now = Date.now();
  const previous = recentReads.get(key);
  if (previous && now - previous < DEDUPE_WINDOW_MS) return;
  recentReads.set(key, now);
  // 一頁停留久了 Map 會長大，順手清掉過期的鍵。
  if (recentReads.size > 200) {
    for (const [existing, at] of recentReads) if (now - at > DEDUPE_WINDOW_MS) recentReads.delete(existing);
  }

  const userInitiated = isUserInitiated();
  const message = error instanceof Error ? error.message : '';
  // 排到下一個 task，讓原本的 fetch 先回到呼叫端。
  window.setTimeout(() => {
    void sendAuditEvent(eventType, {
      feature: meta.kind === 'file' ? '讀取檔案' : '讀取資料',
      access_kind: meta.kind,
      resource: safeText(meta.resource, 320),
      request_path: safeText(meta.path, 500),
      method: meta.method,
      http_status: status || null,
      result,
      response_range: safeText(response?.headers?.get('content-range'), 80),
      user_initiated: userInitiated,
      access_origin: userInitiated ? 'user_action' : 'page_load',
      reason: meta.suspicious ? '偵測到目錄跳脫或敏感檔名'
        : denied ? '權限驗證拒絕' : safeText(message, 160),
      risk_level: denied ? '高風險' : '一般',
    });
  }, 0);
}

/** 掛在根版面，每一頁都會執行；重複呼叫無效果。 */
export function installAccessAudit() {
  if (installed || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installed = true;

  const markActivity = () => { lastActivityAt = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'change', 'submit']) {
    document.addEventListener(type, markActivity, true);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const meta = readMeta(input, init);
    // 可疑路徑直接擋下，不送出請求——與 V1 相同，這是阻擋而不只是記錄。
    if (meta?.suspicious) {
      const denied = new Response(JSON.stringify({ message: '系統已阻擋可疑檔案路徑' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } });
      recordRead(meta, denied, null);
      return Promise.resolve(denied);
    }
    return nativeFetch(input, init).then(response => {
      if (meta) recordRead(meta, response, null);
      return response;
    }, (error: unknown) => {
      if (meta) recordRead(meta, null, error);
      throw error;
    });
  };
}
