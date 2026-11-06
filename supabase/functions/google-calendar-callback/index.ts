import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const APP_BOOKINGS_URL = 'https://jnfakimo.github.io/Inspection/v2/systems/meetingroom/bookings/';
const allowedOrigins = new Set(['https://jnfakimo.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);
async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function safeReturnTo(value: unknown) {
  try {
    if (typeof value !== 'string') return APP_BOOKINGS_URL;
    const url = new URL(value);
    if (!allowedOrigins.has(url.origin) || !url.pathname.startsWith('/Inspection/v2/')) return APP_BOOKINGS_URL;
    url.hash = ''; url.searchParams.delete('google_calendar');
    return url.toString();
  } catch { return APP_BOOKINGS_URL; }
}
Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url), state = url.searchParams.get('state'), code = url.searchParams.get('code');
  let returnTo = APP_BOOKINGS_URL;
  try {
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new Error('invalid state');
    const { data: row, error } = await admin.from('google_calendar_oauth_states').select('return_to,browser_verifier_hash')
      .eq('state_hash', await digest(state)).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error || !row || !row.browser_verifier_hash) throw new Error('expired state');
    returnTo = safeReturnTo(row.return_to);
    if (!code || code.length > 4000 || /[\u0000-\u001f]/.test(code) || url.searchParams.has('error')) throw new Error('consent failed');
    const target = new URL(returnTo);
    target.hash = new URLSearchParams({ google_calendar: 'finish', state, code }).toString();
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    const target = new URL(returnTo); target.searchParams.set('google_calendar', 'oauth_failed');
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
});
