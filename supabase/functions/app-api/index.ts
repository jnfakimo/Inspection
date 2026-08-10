import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const allowedOrigins = new Set([
  'https://jnfakimo.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://jnfakimo.github.io',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(value: unknown, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function canonicalFloor(value: unknown) {
  const raw = text(value, 20).toUpperCase().replace(/\s+/g, '');
  if (raw === 'B1' || raw === 'B1F') return 'B1F';
  if (raw === 'RF' || raw === 'ROOF' || raw === '頂樓') return 'RF';
  const match = raw.match(/^(\d+)F?$/);
  return match ? `${match[1]}F` : (raw || '未設定');
}

async function countQuery(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const result = await query;
  if (result.error) console.warn('Count query skipped:', result.error.message);
  return result.error ? 0 : (result.count || 0);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { ok: false, message: 'Method not allowed' }, 405);

  try {
    const authorization = req.headers.get('authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return reply(req, { ok: false, message: '未登入' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, message: '登入狀態無效' }, 401);

    const { data: profile, error: profileError } = await admin.from('users')
      .select('user_id,username,name,department,role,rbac_role,status')
      .eq('auth_id', authData.user.id).eq('status', 'active').maybeSingle();
    if (profileError || !profile) return reply(req, { ok: false, message: '找不到啟用中的系統帳號' }, 403);

    const roleId = profile.rbac_role || ({ admin: 'sysadmin', supervisor: 'unit_supervisor', maintenance: 'technician', inspector: 'reporter' } as Record<string, string>)[profile.role] || profile.role;
    const isSysadmin = roleId === 'sysadmin' || profile.role === 'admin';
    const { data: permissions } = await admin.from('role_permissions').select('perm,allowed').eq('role_id', roleId).eq('allowed', true).like('perm', 'sys_%');
    const allowedSystems = new Set((permissions || []).map(row => String(row.perm).replace(/^sys_/, '')));
    const can = (system: string) => isSysadmin || allowedSystems.has(system);

    const userDb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const body = await req.json().catch(() => ({}));
    const action = text(body.action, 40);

    if (action === 'profile') {
      return reply(req, { ok: true, data: { ...profile, allowed_systems: isSysadmin ? ['*'] : [...allowedSystems] } });
    }

    if (action === 'dashboard') {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [equipment, inspections, abnormal, openRepairs, trendResult, repairsResult, recentResult] = await Promise.all([
        countQuery(userDb.from('equipment').select('*', { count: 'exact', head: true }).neq('status', 'retired')),
        countQuery(userDb.from('inspection_records').select('*', { count: 'exact', head: true }).gte('inspect_time', since)),
        countQuery(userDb.from('inspection_records').select('*', { count: 'exact', head: true }).gte('inspect_time', since).eq('run_status', 'abnormal')),
        countQuery(userDb.from('repair_requests').select('*', { count: 'exact', head: true }).neq('status', 'closed')),
        userDb.from('inspection_records').select('record_id,inspect_time,run_status').gte('inspect_time', since).order('inspect_time').limit(5000),
        userDb.from('repair_requests').select('request_id,req_no,fault_location,status,created_at').order('created_at', { ascending: false }).limit(8),
        userDb.from('inspection_records').select('record_id,inspect_time,run_status,equipment(name)').order('inspect_time', { ascending: false }).limit(8),
      ]);
      const buckets = new Map<string, { date: string; total: number; abnormal: number }>();
      for (let offset = 29; offset >= 0; offset--) {
        const date = new Date(Date.now() - offset * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        buckets.set(date, { date, total: 0, abnormal: 0 });
      }
      for (const row of trendResult.data || []) {
        const date = new Date(row.inspect_time).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
        const bucket = buckets.get(date);
        if (bucket) { bucket.total += 1; if (row.run_status === 'abnormal') bucket.abnormal += 1; }
      }
      const recentInspections = (recentResult.data || []).map((row) => ({
        ...row,
        equipment_name: Array.isArray(row.equipment) ? row.equipment[0]?.name : (row.equipment as { name?: string } | null)?.name,
      }));
      return reply(req, { ok: true, data: {
        metrics: { equipment, inspections, abnormal, open_repairs: openRepairs, completion_rate: inspections ? Math.round((inspections - abnormal) / inspections * 1000) / 10 : 100 },
        inspection_trend: [...buckets.values()], recent_repairs: repairsResult.data || [], recent_inspections: recentInspections,
      } });
    }

    if (action === 'inspections') {
      if (!can('guardpatrol')) return reply(req, { ok: false, message: '目前角色沒有巡檢系統權限' }, 403);
      const [records, equipment] = await Promise.all([
        userDb.from('inspection_records').select('record_id,inspect_time,run_status,light_status,abnormal_note,location_point,equipment(name,asset_code,floor),users!inspection_records_inspector_id_fkey(name)').order('inspect_time', { ascending: false }).limit(200),
        userDb.from('equipment').select('equipment_id,name,asset_code,floor').neq('status', 'retired').order('name').limit(1000),
      ]);
      if (records.error) throw records.error;
      if (equipment.error) throw equipment.error;
      return reply(req, { ok: true, data: { rows: records.data || [], equipment: equipment.data || [] } });
    }

    if (action === 'create_inspection') {
      if (!can('guardpatrol')) return reply(req, { ok: false, message: '目前角色沒有新增巡檢權限' }, 403);
      const equipmentId = text(body.equipment_id, 80);
      const runStatus = body.run_status === 'abnormal' ? 'abnormal' : 'normal';
      if (!/^[0-9a-f-]{36}$/i.test(equipmentId)) return reply(req, { ok: false, message: '請選擇有效設備' }, 400);
      const abnormalNote = text(body.abnormal_note, 1000);
      if (runStatus === 'abnormal' && !abnormalNote) return reply(req, { ok: false, message: '異常巡檢必須填寫說明' }, 400);
      const { data, error } = await userDb.from('inspection_records').insert({
        equipment_id: equipmentId, inspector_id: profile.user_id, run_status: runStatus,
        light_status: runStatus === 'abnormal' ? 'red' : 'green',
        location_point: text(body.location_point, 240) || null, abnormal_note: abnormalNote || null,
      }).select('record_id').single();
      if (error) throw error;
      return reply(req, { ok: true, data });
    }

    if (action === 'equipment_map') {
      if (!can('structuremap') && !can('equipment')) return reply(req, { ok: false, message: '目前角色沒有設備圖臺權限' }, 403);
      const [equipment, markers, locations] = await Promise.all([
        userDb.from('equipment').select('equipment_id,name,asset_code,category,status,floor,location,location_id').order('floor').order('name').limit(2000),
        userDb.from('plan_markers').select('marker_id,equipment_id,floor,x,y,label').limit(5000),
        userDb.from('locations').select('location_id,name,floor').limit(2000),
      ]);
      if (equipment.error) throw equipment.error;
      return reply(req, { ok: true, data: {
        equipment: (equipment.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })),
        markers: markers.error ? [] : (markers.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })),
        locations: locations.error ? [] : (locations.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })),
      } });
    }

    return reply(req, { ok: false, message: '不支援的 API 動作' }, 400);
  } catch (error) {
    console.error('app-api failed', error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: 'API 處理失敗，請稍後再試' }, 500);
  }
});
