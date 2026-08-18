import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID') || '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET') || '';
const TOKEN_KEY_B64 = Deno.env.get('GOOGLE_TOKEN_ENCRYPTION_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const APP_BOOKINGS_URL = 'https://jnfakimo.github.io/Inspection/v2/systems/meetingroom/bookings/';
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function clean(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function fromBase64(value: string) { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')); return Uint8Array.from(binary, char => char.charCodeAt(0)); }
async function tokenKey() { const raw = fromBase64(TOKEN_KEY_B64); if (raw.byteLength !== 32) throw new Error('Google Calendar 尚未完成伺服器設定'); return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); }
async function decrypt(value: string, aad: string) { const [version, ivText, encryptedText] = value.split('.'); if (version !== 'v1' || !ivText || !encryptedText) throw new Error('Google 授權資料格式無效'); const additionalData = new TextEncoder().encode(aad); const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(ivText), additionalData }, await tokenKey(), fromBase64(encryptedText)); return new TextDecoder().decode(decrypted); }
async function eventId(bookingId: unknown) { const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean(bookingId, 80)))); return `beinong${Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('')}`; }
function timeValue(value: unknown) { return clean(value, 20).slice(0, 5); }
function relation(value: unknown) { const row = Array.isArray(value) ? value[0] : value; return row && typeof row === 'object' ? row as Record<string, unknown> : {}; }
function eventBody(booking: Record<string, unknown>) {
  const room = relation(booking.meeting_rooms), date = clean(booking.booking_date, 10), start = timeValue(booking.start_time), end = timeValue(booking.end_time);
  const roomName = clean(room.name, 150), floor = clean(room.floor, 30), bookingNo = clean(booking.booking_no, 80);
  return { summary: clean(booking.purpose, 300) || '北農會議室預約', location: [roomName, floor].filter(Boolean).join('｜'), description: [`北農會議室預約`, `預約編號：${bookingNo || '—'}`, `會議室：${roomName || '—'}`, `系統連結：${APP_BOOKINGS_URL}`].join('\n'), start: { dateTime: `${date}T${start}:00+08:00`, timeZone: 'Asia/Taipei' }, end: { dateTime: `${date}T${end}:00+08:00`, timeZone: 'Asia/Taipei' }, reminders: { useDefault: true }, extendedProperties: { private: { source: 'taipec-mkt-1', booking_id: clean(booking.booking_id, 80), booking_no: bookingNo } } };
}
class GoogleAuthError extends Error {}
async function refreshAccessToken(userId: string, ciphertext: string) {
  const refreshToken = await decrypt(ciphertext, `${userId}:refresh`);
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { if (body.error === 'invalid_grant') throw new GoogleAuthError('Google 授權已失效，請重新連結'); throw new Error(`Google Token 更新失敗（${response.status}）`); }
  return clean(body.access_token, 4000);
}
async function googleEvent(accessToken: string, booking: Record<string, unknown>, action: string) {
  const currentId = clean(booking.google_event_id, 300), deterministicId = await eventId(booking.booking_id);
  const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  if (action === 'delete') {
    if (!currentId) return { eventId: '', deleted: true };
    const response = await fetch(`${base}/${encodeURIComponent(currentId)}?sendUpdates=none`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google Calendar 刪除失敗（${response.status}）`);
    return { eventId: '', deleted: true };
  }
  const payload = eventBody(booking);
  const put = async (id: string) => fetch(`${base}/${encodeURIComponent(id)}?sendUpdates=none`, { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (currentId) { const update = await put(currentId); if (update.ok) return { eventId: clean((await update.json()).id, 300), deleted: false }; if (update.status !== 404 && update.status !== 410) throw new Error(`Google Calendar 更新失敗（${update.status}）`); }
  const create = await fetch(`${base}?sendUpdates=none`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deterministicId, ...payload }) });
  if (create.ok) return { eventId: clean((await create.json()).id, 300), deleted: false };
  if (create.status === 409) { const update = await put(deterministicId); if (update.ok) return { eventId: deterministicId, deleted: false }; }
  throw new Error(`Google Calendar 建立失敗（${create.status}）`);
}

Deno.serve(async req => {
  if (req.method !== 'POST') return Response.json({ ok: false, message: 'Method not allowed' }, { status: 405 });
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !TOKEN_KEY_B64) return Response.json({ ok: false, message: 'Google Calendar 尚未完成伺服器設定' }, { status: 503 });
  const { data: jobs, error: claimError } = await admin.rpc('claim_google_calendar_sync_jobs', { p_limit: 20 });
  if (claimError) return Response.json({ ok: false, message: '同步工作領取失敗' }, { status: 500 });
  let synced = 0, failed = 0, skipped = 0;
  const tokenCache = new Map<string, string>();
  for (const job of jobs || []) {
    const { data: booking } = await admin.from('meeting_bookings').select('*,meeting_rooms(name,floor)').eq('booking_id', job.booking_id).maybeSingle();
    if (!booking) { await admin.from('google_calendar_sync_jobs').update({ status: 'skipped', last_error: '找不到預約', updated_at: new Date().toISOString() }).eq('job_id', job.job_id); skipped++; continue; }
    await admin.from('meeting_bookings').update({ google_calendar_sync_status: 'processing', google_calendar_sync_error: null }).eq('booking_id', booking.booking_id);
    const { data: connection } = await admin.from('google_calendar_connections').select('*').eq('user_id', booking.user_id).eq('status', 'active').maybeSingle();
    if (!connection?.refresh_token_ciphertext) { await admin.from('google_calendar_sync_jobs').update({ status: 'skipped', last_error: '尚未連結 Google Calendar', updated_at: new Date().toISOString() }).eq('job_id', job.job_id); await admin.from('meeting_bookings').update({ google_calendar_sync_status: 'not_connected', google_calendar_sync_error: null }).eq('booking_id', booking.booking_id); skipped++; continue; }
    try {
      let accessToken = tokenCache.get(connection.user_id);
      if (!accessToken) { accessToken = await refreshAccessToken(connection.user_id, connection.refresh_token_ciphertext); tokenCache.set(connection.user_id, accessToken); }
      const result = await googleEvent(accessToken, booking, job.action), now = new Date().toISOString();
      await admin.from('meeting_bookings').update({ google_event_id: result.eventId || null, google_calendar_sync_status: result.deleted ? 'cancelled' : 'synced', google_calendar_synced_at: now, google_calendar_sync_error: null }).eq('booking_id', booking.booking_id);
      await admin.from('google_calendar_sync_jobs').update({ status: 'synced', attempt_count: Number(job.attempt_count || 0) + 1, last_error: null, updated_at: now }).eq('job_id', job.job_id);
      await admin.from('google_calendar_connections').update({ last_sync_at: now, last_error: null, updated_at: now }).eq('connection_id', connection.connection_id); synced++;
    } catch (error) {
      const attempts = Number(job.attempt_count || 0) + 1, message = clean(error instanceof Error ? error.message : error, 500), next = new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString();
      await admin.from('google_calendar_sync_jobs').update({ status: 'failed', attempt_count: attempts, next_attempt_at: next, last_error: message, updated_at: new Date().toISOString() }).eq('job_id', job.job_id);
      await admin.from('meeting_bookings').update({ google_calendar_sync_status: 'failed', google_calendar_sync_error: message }).eq('booking_id', booking.booking_id);
      await admin.from('google_calendar_connections').update({ status: error instanceof GoogleAuthError ? 'error' : 'active', last_error: message, updated_at: new Date().toISOString(), ...(error instanceof GoogleAuthError ? { refresh_token_ciphertext: null } : {}) }).eq('connection_id', connection.connection_id); failed++;
    }
  }
  return Response.json({ ok: true, data: { processed: synced + failed + skipped, synced, failed, skipped } }, { headers: { 'Cache-Control': 'no-store' } });
});
