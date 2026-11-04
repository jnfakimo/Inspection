import { equipmentFlexMessage, sendEquipmentLineReply } from './equipment-line-card.ts';

// Supabase client is supplied by the Edge Function after signature verification.
// deno-lint-ignore no-explicit-any
type Db = any;

type Access = { assets: boolean; monitoring: boolean; repairs: boolean };

/** Re-evaluate the same four-level system/module access used by app-api for every LINE query. */
export async function equipmentLineAccess(db: Db, userId: string): Promise<Access> {
  const { data: user, error: userError } = await db.from('users')
    .select('user_id,role,rbac_role,status').eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (userError) throw userError;
  if (!user) return { assets: false, monitoring: false, repairs: false };
  const roleId = user.rbac_role || ({
    admin: 'sysadmin', supervisor: 'unit_supervisor',
    maintenance: 'technician', inspector: 'reporter',
  } as Record<string, string>)[user.role] || user.role;
  if (roleId === 'sysadmin' || user.role === 'admin') {
    return { assets: true, monitoring: true, repairs: true };
  }
  const [role, systems, modules, roleModules] = await Promise.all([
    db.from('role_permissions').select('perm,allowed').eq('role_id', roleId).eq('allowed', true),
    db.from('user_system_access').select('system_key,mode').eq('user_id', userId),
    db.from('user_module_access').select('system_key,module_key,mode').eq('user_id', userId),
    db.from('role_module_access').select('system_key,module_key,mode').eq('role_id', roleId),
  ]);
  for (const result of [role, systems, modules, roleModules]) if (result.error) throw result.error;
  const roleSystems = new Set((role.data || []).map((item: { perm: string }) => String(item.perm)));
  const systemModes = new Map((systems.data || []).map((item: { system_key: string; mode: string }) =>
    [item.system_key, item.mode]));
  const moduleModes = new Map((modules.data || []).map((item: { system_key: string; module_key: string; mode: string }) =>
    [`${item.system_key}/${item.module_key}`, item.mode]));
  const roleModuleModes = new Map((roleModules.data || []).map((item: { system_key: string; module_key: string; mode: string }) =>
    [`${item.system_key}/${item.module_key}`, item.mode]));
  const can = (system: string, module: string) => {
    const systemMode = systemModes.get(system) || 'inherit';
    const systemAllowed = systemMode === 'allow'
      || (systemMode === 'inherit' && roleSystems.has(`sys_${system}`));
    if (!systemAllowed) return false;
    const key = `${system}/${module}`;
    const personal = moduleModes.get(key) || 'inherit';
    if (personal === 'deny') return false;
    if (personal === 'allow') return true;
    return (roleModuleModes.get(key) || 'inherit') !== 'deny';
  };
  return {
    assets: can('equipment', 'assets'),
    monitoring: can('equipment', 'monitoring'),
    repairs: can('workorder', 'requests'),
  };
}

function assertRows(result: { data: unknown[] | null; error: unknown }): unknown[] {
  if (result.error) throw result.error;
  return result.data || [];
}

export async function replyEquipmentLineQuery(input: {
  db: Db; lineUserId: string; code: string; replyToken: string;
  token: string; now: Date; fetcher?: typeof fetch;
}): Promise<void> {
  const { db, lineUserId, code, replyToken, token, now, fetcher } = input;
  const send = (message: unknown) => sendEquipmentLineReply({ token, replyToken, message, fetcher });
  const binding = await db.from('inspection_line_bindings').select('user_id')
    .eq('line_user_id', lineUserId).eq('state', 'linked').maybeSingle();
  if (binding.error) throw binding.error;
  if (!binding.data?.user_id) {
    await send({ type: 'text', text: '請先登入中央巡檢系統，在個人設定綁定本人 LINE，才能查詢設備。' });
    return;
  }
  const userId = String(binding.data.user_id);
  const limit = await db.rpc('enforce_request_rate_limit', {
    p_subject: `line-equipment:${userId}`, p_scope: 'app-api:equipment_map',
    p_actor_id: userId,
  });
  if (limit.error) throw limit.error;
  if (limit.data !== true) {
    await send({ type: 'text', text: '設備查詢過於頻繁，請稍後再試。' });
    return;
  }
  const access = await equipmentLineAccess(db, userId);
  if (!access.assets) {
    await send({ type: 'text', text: '目前沒有設備查詢權限，請洽系統管理員。' });
    return;
  }
  const selected = 'equipment_id,asset_code,qr_code,name,floor,location,status';
  const asset = await db.from('equipment').select(selected).eq('asset_code', code).limit(2);
  let rows = assertRows(asset);
  if (!rows.length) {
    const qr = await db.from('equipment').select(selected).eq('qr_code', code).limit(2);
    rows = assertRows(qr);
  }
  if (rows.length !== 1) {
    await send({ type: 'text', text: rows.length ? '設備編號不唯一，請洽管理員。' : '找不到此設備編號，請檢查後再試。' });
    return;
  }
  const equipment = rows[0] as {
    equipment_id: string; asset_code?: string | null; qr_code?: string | null;
    name: string; floor?: string | null; location?: string | null; status?: string | null;
  };
  const [pointResult, alertResult, repairResult] = await Promise.all([
    access.monitoring
      ? db.from('equipment_monitor_points')
        .select('point_name,last_value,unit,last_quality,last_seen_at,sampling_seconds,status')
        .eq('equipment_id', equipment.equipment_id)
        .order('status').order('point_name').limit(5)
      : Promise.resolve(null),
    access.monitoring
      ? db.from('equipment_monitor_events').select('title,severity,occurred_at')
        .eq('equipment_id', equipment.equipment_id).in('event_state', ['open', 'acknowledged'])
        .order('occurred_at', { ascending: false }).limit(3)
      : Promise.resolve(null),
    access.repairs
      ? db.from('repair_requests').select('req_no,fault_desc,status,created_at')
        .eq('equipment_id', equipment.equipment_id).order('created_at', { ascending: false }).limit(3)
      : Promise.resolve(null),
  ]);
  if (pointResult?.error) throw pointResult.error;
  if (alertResult?.error) throw alertResult.error;
  if (repairResult?.error) throw repairResult.error;
  const url = new URL('https://jnfakimo.github.io/Inspection/v2/systems/equipment/assets/');
  url.searchParams.set('asset', equipment.asset_code || equipment.qr_code || equipment.equipment_id);
  await send(equipmentFlexMessage({
    equipment, points: pointResult ? pointResult.data || [] : null,
    alerts: alertResult ? alertResult.data || [] : null,
    repairs: repairResult ? repairResult.data || [] : null,
    now, url: url.toString(),
  }));
}
