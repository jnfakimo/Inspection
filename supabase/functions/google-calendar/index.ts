import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET') || '';
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI') || `${SUPABASE_URL}/functions/v1/google-calendar-callback`;
const TOKEN_KEY_B64 = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY') || '';
const APP_BOOKINGS_URL = 'https://jnfakimo.github.io/Inspection/v2/systems/meetingroom/bookings/';
const allowedOrigins = new Set(['https://jnfakimo.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function cors(req: Request) { const origin = req.headers.get('origin') || ''; return { 'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://jnfakimo.github.io', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }; }
function reply(req: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
// 這支函式所有自己 throw 的訊息都是寫給使用者看的中文。除此之外的例外——Google API
// 回應、AES-GCM 解密失敗、PostgREST 錯誤——message 是底層產生的，帶得出內部路徑、
// 資料表與設定細節，不該原樣送回瀏覽器。用一個標記型別把兩者分開。
class UserError extends Error {}
function clean(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function base64Url(bytes: Uint8Array) { let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromBase64(value: string) { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
async function digest(value: string) { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function tokenKey() { const raw = fromBase64(TOKEN_KEY_B64); if (raw.byteLength !== 32) throw new UserError('Google Calendar 尚未完成伺服器設定'); return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encrypt(value: string, aad: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const additionalData = new TextEncoder().encode(aad); const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, await tokenKey(), new TextEncoder().encode(value))); return `v1.${base64Url(iv)}.${base64Url(encrypted)}`; }
async function decrypt(value: string, aad: string) { const [version, ivText, encryptedText] = value.split('.'); if (version !== 'v1' || !ivText || !encryptedText) throw new UserError('Google 授權資料格式無效'); const additionalData = new TextEncoder().encode(aad); const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivText), additionalData }, await tokenKey(), fromBase64(encryptedText)); return new TextDecoder().decode(decrypted); }
function safeReturnTo(value: unknown) { try { const url = new URL(clean(value, 1000) || APP_BOOKINGS_URL); if (!allowedOrigins.has(url.origin) || !url.pathname.startsWith('/Inspection/v2/')) return APP_BOOKINGS_URL; url.searchParams.delete('google_calendar'); url.hash = ''; return url.toString(); } catch { return APP_BOOKINGS_URL; } }
async function actor(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) throw new UserError('尚未登入');
  const authClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error || !user) throw new UserError('登入憑證無效');
  const { data: profile } = await admin.from('users').select('user_id,name,status').eq('auth_id', user.id).eq('status', 'active').maybeSingle();
  if (!profile) throw new UserError('找不到有效的使用者資料');
  return { profile: profile as { user_id: string; name: string }, authClient };
}
type RateLimitClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
// 此處僅封裝固定名稱與固定參數的限流 RPC，不接受外部函式名稱。
async function rateLimit(authClient: RateLimitClient, action: string) {
  const config: Record<string, [number, number]> = { status: [60, 60], oauth_start: [600, 10], oauth_finish: [600, 10], disconnect: [600, 10], retry: [300, 20] };
  const [seconds, maximum] = config[action] || [60, 30];
  const { data, error } = await authClient.rpc('consume_api_rate_limit', { p_scope: `google-calendar:${action}`, p_window_seconds: seconds, p_max_requests: maximum });
  if (error || data !== true) throw new UserError(error ? '安全限流服務暫時無法使用' : '操作過於頻繁，請稍後再試');
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google OAuth 交換失敗（${response.status}）`);
  return body as Record<string, unknown>;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { ok: false, message: 'Method not allowed' }, 405);
  try {
    const { profile, authClient } = await actor(req);
    const body = await req.json().catch(() => ({}));
    const action = clean(body.action, 50);
    await rateLimit(authClient as unknown as RateLimitClient, action);
    if (action === 'status') {
      const { data } = await admin.from('google_calendar_connections').select('google_email,status,connected_at,last_sync_at,last_error').eq('user_id', profile.user_id).maybeSingle();
      return reply(req, { ok: true, data: { connected: data?.status === 'active', ...(data || {}) } });
    }
    if (action === 'oauth_start') {
      if (!GOOGLE_CLIENT_ID || !TOKEN_KEY_B64) throw new UserError('Google Calendar 尚未完成伺服器設定');
      const browserHash = body.browser_verifier_hash;
      if (typeof browserHash !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(browserHash)) throw new UserError('請從原瀏覽器重新開始授權');
      const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
      const challenge = await digest(verifier);
      const userAgentHash = await digest(req.headers.get('user-agent') || 'unknown');
      await admin.from('google_calendar_oauth_states').delete().lt('expires_at', new Date().toISOString());
      const { error } = await admin.from('google_calendar_oauth_states').insert({ state_hash: await digest(state), browser_verifier_hash: browserHash, user_id: profile.user_id, return_to: safeReturnTo(body.return_to), pkce_verifier_ciphertext: await encrypt(verifier, `${profile.user_id}:pkce`), user_agent_hash: userAgentHash, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (error) throw new UserError('無法建立 Google 授權狀態');
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.search = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email https://www.googleapis.com/auth/calendar.events.owned', access_type: 'offline', prompt: 'consent select_account', include_granted_scopes: 'true', code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
      return reply(req, { ok: true, data: { url: authUrl.toString(), state } });
    }
    if (action === 'oauth_finish') {
      const { state, code, browser_verifier: browserVerifier } = body;
      if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)
        || typeof browserVerifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(browserVerifier)
        || typeof code !== 'string' || !code || code.length > 4000 || /[\u0000-\u001f]/.test(code)) {
        throw new UserError('授權驗證資料無效，請重新連結');
      }
      // 身份、瀏覽器秘密與期限全部符合才原子消耗；錯誤帳號不能消耗別人的交易。
      const { data: stateRow, error: stateError } = await admin.from('google_calendar_oauth_states').delete()
        .eq('state_hash', await digest(state)).eq('user_id', profile.user_id)
        .eq('browser_verifier_hash', await digest(browserVerifier)).gt('expires_at', new Date().toISOString())
        .select('*').maybeSingle();
      if (stateError || !stateRow) throw new UserError('授權已逾期或不是由此帳號與瀏覽器發起');
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !TOKEN_KEY_B64) throw new UserError('Google Calendar 尚未完成伺服器設定');
      const verifier = await decrypt(stateRow.pkce_verifier_ciphertext, `${stateRow.user_id}:pkce`);
      const tokens = await tokenRequest({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' });
      const accessToken = clean(tokens.access_token, 4000);
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!profileResponse.ok) throw new UserError('無法取得 Google 帳號資料');
      const googleProfile = await profileResponse.json();
      const subject = clean(googleProfile.sub, 255), email = clean(googleProfile.email, 320);
      if (!subject || !email || googleProfile.email_verified !== true) throw new UserError('Google 帳號資料未完成驗證');
      const { data: existing } = await admin.from('google_calendar_connections').select('refresh_token_ciphertext').eq('user_id', stateRow.user_id).eq('google_subject', subject).maybeSingle();
      const refreshCiphertext = tokens.refresh_token ? await encrypt(clean(tokens.refresh_token, 4000), `${stateRow.user_id}:refresh`) : existing?.refresh_token_ciphertext;
      if (!refreshCiphertext) throw new UserError('Google 未回傳長效授權，請重新同意存取權限');
      const { error: connectionError } = await admin.from('google_calendar_connections').upsert({ user_id: stateRow.user_id, google_subject: subject, google_email: email, refresh_token_ciphertext: refreshCiphertext, granted_scope: clean(tokens.scope, 1000), status: 'active', connected_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }, { onConflict: 'user_id' });
      if (connectionError) throw new UserError('Google 帳號連結資料儲存失敗');
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
      const { data: bookings } = await admin.from('meeting_bookings').select('booking_id').eq('user_id', stateRow.user_id).eq('google_sync_enabled', true).in('status', ['booked', 'checked_in']).gte('booking_date', today);
      if (bookings?.length) await admin.from('google_calendar_sync_jobs').upsert(bookings.map(row => ({ booking_id: row.booking_id, action: 'upsert', status: 'pending', attempt_count: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })), { onConflict: 'booking_id' });
      return reply(req, { ok: true, data: { connected: true } });
    }
    if (action === 'disconnect') {
      const { data } = await admin.from('google_calendar_connections').select('refresh_token_ciphertext').eq('user_id', profile.user_id).maybeSingle();
      if (data?.refresh_token_ciphertext) { try { const token = await decrypt(data.refresh_token_ciphertext, `${profile.user_id}:refresh`); await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); } catch { /* 本機端仍清除憑證 */ } }
      await admin.from('google_calendar_connections').update({ status: 'disconnected', refresh_token_ciphertext: null, updated_at: new Date().toISOString(), last_error: null }).eq('user_id', profile.user_id);
      return reply(req, { ok: true, data: { connected: false } });
    }
    if (action === 'retry') {
      const bookingId = clean(body.booking_id, 80);
      const { data: booking } = await admin.from('meeting_bookings').select('booking_id,user_id,status,google_sync_enabled,google_event_id').eq('booking_id', bookingId).maybeSingle();
      if (!booking || booking.user_id !== profile.user_id) return reply(req, { ok: false, message: '找不到可重試的預約' }, 404);
      const jobAction = booking.status === 'cancelled' || !booking.google_sync_enabled ? 'delete' : 'upsert';
      await admin.from('google_calendar_sync_jobs').upsert({ booking_id: booking.booking_id, action: jobAction, status: 'pending', attempt_count: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'booking_id' });
      await admin.from('meeting_bookings').update({ google_calendar_sync_status: 'pending', google_calendar_sync_error: null }).eq('booking_id', booking.booking_id);
      return reply(req, { ok: true, data: { queued: true } });
    }
    return reply(req, { ok: false, message: '不支援的操作' }, 400);
  } catch (error) {
    if (error instanceof UserError) return reply(req, { ok: false, message: clean(error.message) || 'Google Calendar 操作失敗' }, 400);
    console.error('google-calendar 未預期錯誤', error);
    return reply(req, { ok: false, message: 'Google Calendar 操作失敗，請稍後再試' }, 400);
  }
});
