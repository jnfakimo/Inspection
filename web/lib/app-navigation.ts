const APP_BASE_PATH = '/Inspection/v2';

function normalizeAppPath(pathname: string) {
  const rawPath = String(pathname || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
  let appPath = rawPath || '/';

  if (appPath === APP_BASE_PATH) appPath = '/';
  else if (appPath.startsWith(`${APP_BASE_PATH}/`)) appPath = appPath.slice(APP_BASE_PATH.length);

  return `/${appPath.split('/').filter(Boolean).join('/')}`;
}

/**
 * 共用頁首的「上頁」依應用程式階層返回，不能依賴瀏覽器歷史。
 * 瀏覽紀錄可能來自外部網站、暫存 QA 頁或已刪除檔案，使用 history.back()
 * 會把使用者帶離巡檢系統。
 */
export function resolveAppBackHref(pathname: string) {
  const appPath = normalizeAppPath(pathname);
  const parts = appPath.split('/').filter(Boolean);

  if (parts[0] === 'systems') {
    if (parts.length >= 3) {
      const systemKey = parts[1];
      return /^[a-z0-9-]+$/i.test(systemKey) ? `/systems/${systemKey}/` : '/systems/';
    }
    if (parts.length === 2) return '/systems/';
    return '/';
  }

  return parts.length === 0 ? '/systems/' : '/';
}

/* ───────────── 上頁＝回到上一個動作（站內瀏覽軌跡） ───────────── */

const VISIT_STACK_KEY = 'beinong-nav-visits';
const VISIT_STACK_LIMIT = 30;
// 登入與授權頁不是「上一個動作」：回到登入頁沒有意義，也不該把使用者丟出已登入的流程。
const VISIT_EXCLUDED_ROOTS = new Set(['login', 'oauth', 'account-apply']);
const VISIT_SENSITIVE_QUERY = /token|password|secret|code=|key=|session/i;

/**
 * 這一頁在站內軌跡的記錄值（應用程式相對路徑，含查詢字串，結尾斜線）。
 * 登入類頁面回傳空字串＝不記錄；含憑證字樣的查詢字串一律捨棄，只留路徑。
 */
export function appVisitEntry(pathname: string, search = '') {
  const path = normalizeAppPath(pathname);
  const first = path.split('/').filter(Boolean)[0] || '';
  if (VISIT_EXCLUDED_ROOTS.has(first)) return '';
  const base = path === '/' ? '/' : `${path}/`;
  const query = /^\?[^#\r\n]{1,300}$/.test(search) && !VISIT_SENSITIVE_QUERY.test(search) ? search : '';
  return `${base}${query}`;
}

/** 進入新頁面時更新軌跡：重複載入同一頁不重複記；回到前一頁時移除目前這一頁；其餘視為新動作。 */
export function pushVisit(stack: readonly string[], entry: string) {
  if (!entry) return [...stack];
  if (stack[stack.length - 1] === entry) return [...stack];
  if (stack.length >= 2 && stack[stack.length - 2] === entry) return stack.slice(0, -1);
  return [...stack, entry].slice(-VISIT_STACK_LIMIT);
}

/**
 * 「上頁」的目的地：有上一個站內頁面就回到它（上一個動作），沒有（剛開啟、換了分頁、
 * 來自站外）才依應用程式階層回到父層。永遠只回傳站內路徑，不使用瀏覽器歷史。
 */
export function resolveBackTarget(stack: readonly string[], pathname: string, search = '') {
  const current = appVisitEntry(pathname, search);
  const previous = current && stack.length >= 2 && stack[stack.length - 1] === current ? stack[stack.length - 2] : '';
  return previous && previous !== current ? previous : resolveAppBackHref(pathname);
}

type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;

const validEntry = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && value.length <= 400;

export function readVisitStack(storage: VisitStorage | null | undefined): string[] {
  try {
    const parsed = JSON.parse(storage?.getItem(VISIT_STACK_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(validEntry).slice(-VISIT_STACK_LIMIT) : [];
  } catch {
    return [];
  }
}

export function writeVisitStack(storage: VisitStorage | null | undefined, stack: readonly string[]) {
  try { storage?.setItem(VISIT_STACK_KEY, JSON.stringify(stack.slice(-VISIT_STACK_LIMIT))); } catch { /* 無痕或停用儲存空間時退回依階層返回 */ }
}
