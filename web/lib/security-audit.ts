'use client';

/**
 * V2 全站安全稽核。
 *
 * 這裡只蒐集「操作的種類與目標」，不蒐集表單值、查詢字串、JWT、Cookie 或
 * Authorization header。事件一律送到 audit-event，由後端用 JWT 重新判定操作者並
 * 取得來源 IP；前端傳入的身分不作為稽核依據。
 */

import type { Profile } from '@/types/app';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { getSupabase } from './supabase';
import {
  auditSafeDestination,
  auditSafeHash,
  auditIsSensitivePath,
  auditSafeText as safeText,
  auditSafeValue as safeValue,
} from './security-audit-sanitize';

export type SecurityAuditEventType =
  | 'page_view'
  | 'function_use'
  | 'data_read'
  | 'file_read'
  | 'access_denied';

type AuditPayload = {
  event_id: string;
  event_type: SecurityAuditEventType;
  occurred_at: string;
  page: Record<string, unknown>;
  details: unknown;
};

type ReadMeta = {
  kind: 'data' | 'file';
  resource: string;
  method: 'GET' | 'HEAD' | 'POST';
  path: string;
  suspicious: boolean;
};

type SecurityAction = {
  force_logout?: unknown;
  confirmed_automated_access?: unknown;
  server_verified_rate_limit?: unknown;
  detection_basis?: unknown;
  automated_read_count?: unknown;
  unique_resource_count?: unknown;
  user_initiated_read_count?: unknown;
  message?: unknown;
};

const AUDIT_ENDPOINT = `${SUPABASE_URL}/functions/v1/audit-event`;
const MAX_QUEUE = 200;
const DEDUPE_MS = 1_200;
const USER_ACTIVITY_WINDOW_MS = 15_000;
const SKIPPED_REST_RESOURCES = new Set(['audit_logs', 'security_alerts']);
const READ_ONLY_RPCS = new Set(['repair_monthly_counts']);

const pending: AuditPayload[] = [];
const recentActions = new Map<string, number>();
const recentReads = new Map<string, number>();
const recentPages = new Map<string, number>();
let profile: Profile | null = null;
let profileAuthId: string | null = null;
let installed = false;
let flushing = false;
let logoutInProgress = false;
let lastUserActivityAt = 0;
let nativeFetch: typeof window.fetch | null = null;

function safeHash() {
  return auditSafeHash(location.hash);
}

function pageInfo() {
  const path = location.pathname.slice(0, 500);
  const parts = path.split('/').filter(Boolean);
  const systemsIndex = parts.indexOf('systems');
  const system = systemsIndex >= 0 ? parts[systemsIndex + 1] || 'systems' : parts.at(-1) || 'v2';
  const heading = document.querySelector<HTMLElement>('.nav-title, h1');
  return {
    system: safeText(system, 80),
    page: safeText(heading?.textContent || document.title || path, 160),
    path,
    hash: safeHash(),
    // url 故意不含 search/hash；hash 另以已遮蔽的欄位保存。
    url: `${location.origin}${path}`.slice(0, 1000),
  };
}

function randomId() {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rememberRecent(store: Map<string, number>, key: string) {
  const now = Date.now();
  const previous = store.get(key) || 0;
  if (now - previous < DEDUPE_MS) return false;
  store.set(key, now);
  if (store.size > 500) {
    for (const [item, time] of store) {
      if (now - time > 60_000) store.delete(item);
    }
  }
  return true;
}

function isSysadmin(current: Profile) {
  return current.rbac_role === 'sysadmin' || current.role === 'admin';
}

async function enforceSecurityLogout(action: SecurityAction, current: Profile) {
  const automatedReadCount = Number(action.automated_read_count) || 0;
  const uniqueResourceCount = Number(action.unique_resource_count) || 0;
  const userInitiatedReadCount = Number(action.user_initiated_read_count) || 0;
  const confirmed = action.force_logout === true &&
    action.confirmed_automated_access === true &&
    action.server_verified_rate_limit === true &&
    action.detection_basis === 'non_interactive_high_rate' &&
    automatedReadCount >= 40 && uniqueResourceCount >= 8 && userInitiatedReadCount === 0;
  if (!confirmed || isSysadmin(current) || logoutInProgress) return;

  logoutInProgress = true;
  profile = null;
  profileAuthId = null;
  pending.length = 0;
  const message = safeText(action.message, 300) ||
    '系統確認目前工作階段出現非互動高頻資料存取，已中止目前連線並通知系統管理員。';
  try { sessionStorage.setItem('securityLogoutMessage', message); } catch { /* 儲存區可能被瀏覽器停用 */ }
  try { await getSupabase().auth.signOut({ scope: 'local' }); } catch { /* 後端可能已撤銷 session */ }
  try {
    const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
    sessionStorage.removeItem(`sb-${projectRef}-auth-token`);
  } catch { /* 已盡力清除 */ }
  try { window.alert(message); } catch { /* 非互動瀏覽器不支援 alert */ }
  location.replace('/Inspection/v2/login/?security=bulk-read');
}

async function flush() {
  if (flushing || !profile || !pending.length || !nativeFetch) return;
  flushing = true;
  try {
    const current = profile;
    const expectedAuthId = profileAuthId;
    let sessionResult: Awaited<ReturnType<ReturnType<typeof getSupabase>['auth']['getSession']>>;
    try {
      sessionResult = await getSupabase().auth.getSession();
    } catch {
      if (profile === current && profileAuthId === expectedAuthId) {
        profile = null;
        profileAuthId = null;
        pending.length = 0;
      }
      return;
    }
    const { data, error } = sessionResult;
    let token = data.session?.access_token;
    if (profile !== current || profileAuthId !== expectedAuthId) return;
    if (error || !token || !current || !expectedAuthId || data.session?.user.id !== expectedAuthId) {
      // 不把前一個工作階段排隊的事件留給下一個登入帳號，避免稽核誤掛名。
      profile = null;
      profileAuthId = null;
      pending.length = 0;
      return;
    }

    while (profile === current && profileAuthId === expectedAuthId && pending.length && !logoutInProgress) {
      const payload = pending.shift();
      if (!payload) break;
      let response: Response;
      try {
        response = await nativeFetch(AUDIT_ENDPOINT, {
          method: 'POST',
          keepalive: true,
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        // 稽核失敗不回補佇列，避免離線或函式故障時形成無限重送迴圈。
        continue;
      }
      if (profile !== current || profileAuthId !== expectedAuthId) break;
      if (response.status === 401 || response.status === 403) {
        // getSession 與 POST 之間可能剛好輪替 JWT。先更新一次同帳號 session，
        // 避免單次權杖過期讓本分頁後續稽核永久停止；若仍遭拒才視為失效。
        try {
          const refreshed = await getSupabase().auth.refreshSession();
          const refreshedSession = refreshed.data.session;
          if (profile !== current || profileAuthId !== expectedAuthId) break;
          if (refreshed.error || !refreshedSession?.access_token || refreshedSession.user.id !== expectedAuthId) {
            profile = null;
            profileAuthId = null;
            pending.length = 0;
            break;
          }
          token = refreshedSession.access_token;
          response = await nativeFetch(AUDIT_ENDPOINT, {
            method: 'POST',
            keepalive: true,
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8_000),
          });
          if (profile !== current || profileAuthId !== expectedAuthId) break;
        } catch {
          // 暫時網路失敗不應關閉本分頁後續稽核；這一筆丟棄即可。
          continue;
        }
        if (response.status === 401 || response.status === 403) {
          profile = null;
          profileAuthId = null;
          pending.length = 0;
          break;
        }
      }
      if (!response.ok) continue;
      const result = await response.json().catch(() => null) as { security_action?: SecurityAction } | null;
      if (result?.security_action) await enforceSecurityLogout(result.security_action, current);
    }
  } finally {
    flushing = false;
    if (profile && pending.length && !logoutInProgress) void flush();
  }
}

/** AuthGate 取得有效 session 與正式 profile 後才呼叫；此前只排隊、不送網路請求。 */
export function setSecurityAuditProfile(current: Profile | null, authUserId: string | null = null) {
  profile = current?.user_id ? current : null;
  profileAuthId = profile && authUserId ? authUserId : null;
  if (profile) void flush();
  else pending.length = 0;
}

export function recordSecurityAudit(eventType: SecurityAuditEventType, details: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  if (pending.length >= MAX_QUEUE) pending.shift();
  pending.push({
    event_id: randomId(),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    page: pageInfo(),
    details: safeValue(details),
  });
  void flush();
}

function decodePath(value: string) {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { break; }
  }
  return decoded;
}

function readMeta(input: RequestInfo | URL, init?: RequestInit): ReadMeta | null {
  const raw = input instanceof Request ? input.url : String(input);
  let url: URL;
  let api: URL;
  try {
    url = new URL(raw, location.href);
    api = new URL(SUPABASE_URL);
  } catch { return null; }
  if (url.origin !== api.origin) return null;

  const requestedMethod = init?.method || (input instanceof Request ? input.method : 'GET');
  const method = requestedMethod.toUpperCase();
  const rest = url.pathname.match(/\/rest\/v1\/(?:rpc\/)?([^/]+)/i);
  if (rest) {
    const resource = decodePath(rest[1]);
    if (!resource || SKIPPED_REST_RESOURCES.has(resource.toLocaleLowerCase('en-US'))) return null;
    const rpcRead = url.pathname.includes('/rest/v1/rpc/') && method === 'POST' && READ_ONLY_RPCS.has(resource);
    if (!rpcRead && method !== 'GET' && method !== 'HEAD') return null;
    return {
      kind: 'data', resource: url.pathname.includes('/rest/v1/rpc/') ? `rpc:${resource}` : resource,
      method, path: url.pathname, suspicious: false,
    };
  }

  const marker = '/storage/v1/object/';
  if (method !== 'GET' && method !== 'HEAD') return null;
  const markerAt = url.pathname.indexOf(marker);
  if (markerAt < 0) return null;
  const storagePath = decodePath(url.pathname.slice(markerAt + marker.length));
  const parts = storagePath.split('/').filter(Boolean);
  if (['public', 'sign', 'authenticated'].includes(parts[0] || '')) parts.shift();
  const bucket = parts.shift() || '未知儲存區';
  const objectPath = parts.join('/');
  // URL 解析會正規化 ../，因此同時檢查解析前的原始路徑（含百分比編碼）。
  const rawPath = decodePath(raw.split(/[?#]/, 1)[0]);
  const suspicious = auditIsSensitivePath(storagePath) || auditIsSensitivePath(rawPath);
  return {
    kind: 'file', resource: `${bucket}${objectPath ? `/${objectPath}` : ''}`,
    method, path: url.pathname, suspicious,
  };
}

function userInitiatedRead() {
  return lastUserActivityAt > 0 && Date.now() - lastUserActivityAt <= USER_ACTIVITY_WINDOW_MS;
}

function recordRead(meta: ReadMeta, response: Response | null, error?: unknown) {
  const status = response?.status || 0;
  const denied = meta.suspicious || status === 401 || status === 403 || status === 429;
  const eventType: SecurityAuditEventType = denied ? 'access_denied' : meta.kind === 'file' ? 'file_read' : 'data_read';
  const key = [location.pathname, eventType, meta.kind, meta.resource, status].join('|');
  if (!rememberRecent(recentReads, key)) return;
  const initiated = userInitiatedRead();
  const result = meta.suspicious
    ? '系統已阻擋可疑路徑'
    : response ? response.ok ? '讀取成功' : status === 429 ? '存取頻率受限' : '讀取失敗' : '網路錯誤';
  window.setTimeout(() => recordSecurityAudit(eventType, {
    feature: meta.kind === 'file' ? '讀取檔案' : '讀取資料',
    access_kind: meta.kind,
    resource: safeText(meta.resource, 320),
    request_path: safeText(meta.path, 500),
    method: meta.method,
    http_status: status || null,
    result,
    response_range: safeText(response?.headers.get('content-range'), 80),
    user_initiated: initiated,
    access_origin: initiated ? 'user_action' : 'page_load',
    reason: meta.suspicious
      ? '偵測到目錄跳脫或敏感檔名'
      : denied ? status === 429 ? '系統限制存取頻率' : '權限驗證拒絕' : safeText(error instanceof Error ? error.message : error, 160),
    risk_level: denied ? '高風險' : '一般',
  }), 0);
}

function safeDestination(href: string) {
  return auditSafeDestination(href, location.href, location.origin);
}

function fileHref(href: string) {
  if (!href) return '';
  try {
    const url = new URL(href, location.href);
    if (url.pathname.includes('/storage/v1/object/') || /\.(?:pdf|xlsx?|csv|docx?|pptx?|zip|png|jpe?g|webp)$/i.test(url.pathname)) {
      return decodePath(url.pathname).slice(0, 500);
    }
  } catch { /* 不是可解析的連結 */ }
  return '';
}

function installInteractionAudit() {
  const markActivity = () => { lastUserActivityAt = Date.now(); };
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'change', 'submit']) {
    document.addEventListener(type, markActivity, true);
  }

  document.addEventListener('click', event => {
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element)) return;
    const target = rawTarget.closest<HTMLElement>('a[href], button, [role="button"], input[type="submit"], input[type="button"]');
    if (!target || target.matches(':disabled') || target.closest('[data-audit-ignore="true"]')) return;
    // submit 交給下方 submit 事件記一次，避免同一動作同時留下 click 與 submit。
    if ((target instanceof HTMLButtonElement && target.type === 'submit') ||
      (target instanceof HTMLInputElement && target.type === 'submit')) return;

    const label = safeText(
      target.dataset.auditFeature || target.getAttribute('aria-label') || target.title ||
      (target instanceof HTMLInputElement ? target.value : target.textContent) || target.id,
      120,
    );
    if (!label) return;
    const href = target.getAttribute('href') || '';
    const destination = safeDestination(href);
    const linkedRead = href ? readMeta(href, { method: 'GET' }) : null;
    if (linkedRead?.suspicious) {
      event.preventDefault();
      recordRead(linkedRead, new Response(JSON.stringify({ message: '系統已阻擋可疑檔案路徑' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      }));
      return;
    }
    const path = fileHref(href);
    if (path) recordSecurityAudit('file_read', {
      feature: '開啟或下載檔案', access_kind: 'file', resource: path,
      request_path: path, method: '導覽', result: '使用者要求開啟',
      risk_level: '一般', user_initiated: true, access_origin: 'user_action',
    });
    const key = `${location.pathname}|${label}|${destination}`;
    if (!rememberRecent(recentActions, key)) return;
    recordSecurityAudit('function_use', {
      feature: label,
      element_id: safeText(target.id, 80),
      destination,
      result: '已操作',
    });
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.closest('[data-audit-ignore="true"]')) return;
    const label = safeText(form.dataset.auditFeature || form.getAttribute('aria-label') || form.id || '送出表單', 120);
    const key = `${location.pathname}|submit|${label}`;
    if (!rememberRecent(recentActions, key)) return;
    recordSecurityAudit('function_use', { feature: label, form_id: safeText(form.id, 80), result: '已送出' });
  }, true);

  window.addEventListener('hashchange', () => recordPageView('切換系統功能頁'));
  window.addEventListener('inspection:security-data-read', event => {
    const detail = event instanceof CustomEvent && event.detail && typeof event.detail === 'object'
      ? event.detail as Record<string, unknown>
      : {};
    const initiated = userInitiatedRead();
    const feature = safeText(detail.feature, 120) || '讀取系統資料';
    recordSecurityAudit('data_read', {
      feature,
      access_kind: 'data', resource: feature, method: '受信任後端查詢',
      result: '讀取成功', risk_level: '一般', user_initiated: initiated,
      access_origin: initiated ? 'user_action' : 'page_load',
    });
  });
}

/**
 * 安裝一次 DOM 操作監聽器；SSR 時直接略過。
 *
 * REST／Storage 的 fetch 攔截由根版面的 access-audit.ts 單獨負責。這裡若再包一次
 * window.fetch，同一筆資料讀取會建立兩筆稽核事件，既破壞告警門檻，也會讓進頁時
 * 多送一整批 Edge Function 請求。nativeFetch 只保留給本檔的稽核佇列送信使用。
 */
export function installSecurityAudit() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  nativeFetch = window.fetch.bind(window);
  installInteractionAudit();
}

/** SecurityAuditMount 在 Next 路由變更後呼叫。 */
export function recordPageView(feature = '進入系統頁面') {
  if (typeof window === 'undefined') return;
  const info = pageInfo();
  const key = `${info.path}|${info.hash}`;
  if (!rememberRecent(recentPages, key)) return;
  recordSecurityAudit('page_view', { feature, destination: info.page });
}
