import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
});
const safeEqual = (left: string, right: string) => {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ ok: false, message: '只接受排程送出的 POST 請求。' }, 405);
  const expectedSecret = Deno.env.get('CRON_SECRET') || '';
  if (!safeEqual(request.headers.get('x-cron-secret') || '', expectedSecret)) {
    return reply({ ok: false, message: '排程驗證失敗。' }, 401);
  }

  try {
    const body = await request.json().catch(() => ({})) as { retention?: boolean };
    const database = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const staleResult = await database.rpc('detect_stale_vehicle_tracking');
    if (staleResult.error) throw staleResult.error;

    let removed: number | null = null;
    if (body.retention === true) {
      const retentionResult = await database.rpc('purge_expired_vehicle_location_points');
      if (retentionResult.error) throw retentionResult.error;
      removed = Number(retentionResult.data || 0);
    }
    return reply({
      ok: true,
      stale_events_created: Number(staleResult.data || 0),
      expired_points_removed: removed,
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error('vehicle-tracking-maintenance failed', { requestId, error });
    return reply({ ok: false, message: '公務車定位維護工作暫時無法完成，請稍後再試。', request_id: requestId }, 500);
  }
});
