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
