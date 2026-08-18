import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET') || '';
const GOOGLE_REDIRECT_URI = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI') || `${SUPABASE_URL}/functions/v1/google-calendar-callback`;
const TOKEN_KEY_B64 = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY') || '';
const APP_BOOKINGS_URL = 'https://jnfakimo.github.io/Inspection/v2/systems/meetingroom/bookings/';
const allowedOrigins = new Set(['https://jnfakimo.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function clean(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function base64Url(bytes: Uint8Array) { let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromBase64(value: string) { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
async function digest(value: string) { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function tokenKey() { const raw = fromBase64(TOKEN_KEY_B64); if (raw.byteLength !== 32) throw new Error('Google Calendar 尚未完成伺服器設定'); return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encrypt(value: string, aad: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const additionalData = new TextEncoder().encode(aad); const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, await tokenKey(), new TextEncoder().encode(value))); return `v1.${base64Url(iv)}.${base64Url(encrypted)}`; }
async function decrypt(value: string, aad: string) { const [version, ivText, encryptedText] = value.split('.'); if (version !== 'v1' || !ivText || !encryptedText) throw new Error('Google 授權資料格式無效'); const additionalData = new TextEncoder().encode(aad); const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivText), additionalData }, await tokenKey(), fromBase64(encryptedText)); return new TextDecoder().decode(decrypted); }
function safeReturnTo(value: unknown) { try { const url = new URL(clean(value, 1000) || APP_BOOKINGS_URL); if (!allowedOrigins.has(url.origin) || !url.pathname.startsWith('/Inspection/v2/')) return APP_BOOKINGS_URL; return url.toString(); } catch { return APP_BOOKINGS_URL; } }
function redirectWith(returnTo: string, value: string) { const url = new URL(returnTo); url.searchParams.set('google_calendar', value); return new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } }); }
async function tokenRequest(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google OAuth 交換失敗（${response.status}）`);
  return body as Record<string, unknown>;
}

Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  const state = clean(url.searchParams.get('state'), 500);
  const code = clean(url.searchParams.get('code'), 4000);
  let returnTo = APP_BOOKINGS_URL;
  try {
    if (!state) throw new Error('缺少 OAuth state');
    const { data: stateRow } = await admin.from('google_calendar_oauth_states').delete().eq('state_hash', await digest(state)).gt('expires_at', new Date().toISOString()).select('*').maybeSingle();
    returnTo = safeReturnTo(stateRow?.return_to);
    if (!stateRow || !code || url.searchParams.has('error')) throw new Error('Google 授權未完成或已逾期');
    const userAgentHash = await digest(req.headers.get('user-agent') || 'unknown');
    if (userAgentHash !== stateRow.user_agent_hash) throw new Error('授權瀏覽器驗證失敗');
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !TOKEN_KEY_B64) throw new Error('Google Calendar 尚未完成伺服器設定');
    const verifier = await decrypt(stateRow.pkce_verifier_ciphertext, `${stateRow.user_id}:pkce`);
    const tokens = await tokenRequest({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' });
    const accessToken = clean(tokens.access_token, 4000);
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!profileResponse.ok) throw new Error('無法取得 Google 帳號資料');
    const googleProfile = await profileResponse.json();
    const subject = clean(googleProfile.sub, 255), email = clean(googleProfile.email, 320);
    if (!subject || !email || googleProfile.email_verified !== true) throw new Error('Google 帳號資料未完成驗證');
    const { data: existing } = await admin.from('google_calendar_connections').select('refresh_token_ciphertext').eq('user_id', stateRow.user_id).maybeSingle();
    const refreshCiphertext = tokens.refresh_token ? await encrypt(clean(tokens.refresh_token, 4000), `${stateRow.user_id}:refresh`) : existing?.refresh_token_ciphertext;
    if (!refreshCiphertext) throw new Error('Google 未回傳長效授權，請重新同意存取權限');
    const { error: connectionError } = await admin.from('google_calendar_connections').upsert({ user_id: stateRow.user_id, google_subject: subject, google_email: email, refresh_token_ciphertext: refreshCiphertext, granted_scope: clean(tokens.scope, 1000), status: 'active', connected_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null }, { onConflict: 'user_id' });
    if (connectionError) throw new Error('Google 帳號連結資料儲存失敗');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
    const { data: bookings } = await admin.from('meeting_bookings').select('booking_id').eq('user_id', stateRow.user_id).eq('google_sync_enabled', true).in('status', ['booked', 'checked_in']).gte('booking_date', today);
    if (bookings?.length) await admin.from('google_calendar_sync_jobs').upsert(bookings.map(row => ({ booking_id: row.booking_id, action: 'upsert', status: 'pending', attempt_count: 0, next_attempt_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })), { onConflict: 'booking_id' });
    return redirectWith(returnTo, 'connected');
  } catch (error) {
    console.error('Google OAuth callback rejected:', error instanceof Error ? error.message : 'unknown');
    return redirectWith(returnTo, 'oauth_failed');
  }
});
