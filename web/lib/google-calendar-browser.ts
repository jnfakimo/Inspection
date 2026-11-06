const KEY = 'google-calendar-transaction-v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Invoke = <T>(action: string, payload: Record<string, unknown>) => Promise<T>;
function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function startCalendarLink(invoke: Invoke, store: Store, userId: string, returnTo: string) {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const browserHash = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // 寫入失敗必須在發出授權請求前停止；不把秘密放進可分享的 URL。
  store.setItem(KEY, JSON.stringify({ verifier, userId, expiresAt: Date.now() + 600_000 }));
  try {
    const result = await invoke<{ url: string; state: string }>('oauth_start', { return_to: returnTo, browser_verifier_hash: browserHash });
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.state)) throw new Error('授權狀態無效');
    const url = new URL(result.url);
    if (url.origin !== 'https://accounts.google.com' || url.searchParams.get('state') !== result.state) throw new Error('授權網址無效');
    store.setItem(KEY, JSON.stringify({ verifier, userId, state: result.state, expiresAt: Date.now() + 600_000 }));
    return result.url;
  } catch (error) { store.removeItem(KEY); throw error; }
}

/** Caller must scrub the fragment synchronously before awaiting network work. */
export function consumeCalendarReturn(url: URL, userId: string, store: Store) {
  const params = new URLSearchParams(url.hash.slice(1));
  if (params.get('google_calendar') !== 'finish') return null;
  const raw = store.getItem(KEY);
  store.removeItem(KEY);
  const pending = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  const state = params.get('state'), code = params.get('code');
  if (!pending || pending.userId !== userId || pending.state !== state
    || typeof pending.expiresAt !== 'number' || pending.expiresAt <= Date.now()
    || typeof pending.verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pending.verifier)
    || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4000 || /[\u0000-\u001f]/.test(code)) {
    throw new Error('請回到發起授權的帳號與瀏覽器重新連結');
  }
  return { state, code, browser_verifier: pending.verifier };
}
