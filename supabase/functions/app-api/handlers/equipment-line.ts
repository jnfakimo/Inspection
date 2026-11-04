import type { AppApiContext } from '../context.ts';
import { writeAudit } from '../audit.ts';
import { text } from '../validate.ts';
import { createVehicleLineLinkCode, sha256Hex } from '../../_shared/vehicle-line-link.ts';

const ACTIONS = new Set([
  'equipment_line_link_start', 'equipment_line_link_status', 'equipment_line_unlink',
  'equipment_line_subscriptions', 'equipment_line_subscribe', 'equipment_line_unsubscribe',
]);
const SERVICE_UNAVAILABLE = 'LINE 設備查詢服務尚未就緒，請稍後再試。';

function schemaMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01']
    .includes(String((error as { code?: unknown }).code || ''));
}

function outcome(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' ? row as Record<string, unknown> : null;
}

export async function handleEquipmentLineAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  if (!ACTIONS.has(action)) return null;
  const { req, body, profile, admin, userDb, reply, canModule } = ctx;
  const fail = (error: unknown) => {
    if (schemaMissing(error)) return reply(req, { ok: false, message: SERVICE_UNAVAILABLE }, 503);
    throw error;
  };

  if (action === 'equipment_line_link_start') {
    if (!canModule('equipment', 'assets')) {
      return reply(req, { ok: false, message: '目前沒有設備主檔權限。' }, 403);
    }
    if (body.consent !== true) {
      return reply(req, { ok: false, message: '請先同意 LINE 帳號綁定說明。' }, 400);
    }
    const code = createVehicleLineLinkCode();
    const now = new Date().toISOString();
    const { data, error } = await admin.rpc('create_inspection_line_link', {
      p_user_id: profile.user_id,
      p_code_hash: await sha256Hex(code),
      p_consented_at: now,
      p_now: now,
    });
    if (error) return fail(error);
    const row = outcome(data);
    if (row?.outcome === 'already_linked') {
      return reply(req, { ok: false, message: '此帳號已綁定 LINE；請先解除綁定。' }, 409);
    }
    if (row?.outcome === 'user_inactive') {
      return reply(req, { ok: false, message: '帳號未啟用。' }, 403);
    }
    if (row?.outcome !== 'created' || typeof row.expires_at !== 'string') {
      return reply(req, { ok: false, message: SERVICE_UNAVAILABLE }, 503);
    }
    await writeAudit(userDb, profile.user_id, 'inspection_line_link_requests', profile.user_id, 'insert', null, {
      state: 'pending', consented_at: now, expires_at: row.expires_at,
    });
    return reply(req, { ok: true, data: { code, expires_at: row.expires_at } });
  }

  if (action === 'equipment_line_link_status') {
    const [binding, pending] = await Promise.all([
      admin.from('inspection_line_bindings').select('state,linked_at')
        .eq('user_id', profile.user_id).maybeSingle(),
      admin.from('inspection_line_link_requests').select('expires_at')
        .eq('user_id', profile.user_id).in('state', ['pending', 'awaiting_line'])
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (binding.error) return fail(binding.error);
    if (pending.error) return fail(pending.error);
    const linked = binding.data?.state === 'linked';
    return reply(req, { ok: true, data: {
      linked,
      linked_at: linked ? binding.data?.linked_at || null : null,
      pending_expires_at: !linked && pending.data?.expires_at &&
        Date.parse(String(pending.data.expires_at)) > Date.now() ? pending.data.expires_at : null,
    } });
  }

  if (action === 'equipment_line_subscriptions') {
    const canView = canModule('equipment', 'assets') && canModule('equipment', 'monitoring');
    const { data: subscriptions, error } = await admin.from('inspection_line_equipment_subscriptions')
      .select('equipment_id').eq('user_id', profile.user_id).eq('active', true).limit(100);
    if (error) return fail(error);
    const ids = (subscriptions || []).map(row => row.equipment_id);
    if (!ids.length) return reply(req, { ok: true, data: [] });
    if (!canView) return reply(req, { ok: true, data: ids.map(equipment_id => ({
      equipment_id, asset_code: null, qr_code: null, name: '已無查閱權限',
    })) });
    const equipment = await admin.from('equipment')
      .select('equipment_id,asset_code,qr_code,name').in('equipment_id', ids).limit(100);
    if (equipment.error) throw equipment.error;
    return reply(req, { ok: true, data: equipment.data || [] });
  }

  if (action === 'equipment_line_subscribe') {
    if (!canModule('equipment', 'assets') || !canModule('equipment', 'monitoring')) {
      return reply(req, { ok: false, message: '目前沒有設備監控查閱權限。' }, 403);
    }
    const code = typeof body.code === 'string' && body.code.length <= 80 ? text(body.code, 80) : '';
    if (!code) return reply(req, { ok: false, message: '請輸入設備編號。' }, 400);
    const selected = 'equipment_id,asset_code,qr_code,status';
    const asset = await admin.from('equipment').select(selected).eq('asset_code', code).limit(2);
    if (asset.error) throw asset.error;
    let rows = asset.data || [];
    if (!rows.length) {
      const qr = await admin.from('equipment').select(selected).eq('qr_code', code).limit(2);
      if (qr.error) throw qr.error;
      rows = qr.data || [];
    }
    if (rows.length !== 1 || rows[0].status === 'retired') {
      return reply(req, { ok: false, message: '找不到可訂閱的設備編號。' }, 404);
    }
    const equipmentId = rows[0].equipment_id;
    const subscribed = await admin.rpc('subscribe_inspection_line_equipment', {
      p_user_id: profile.user_id, p_equipment_id: equipmentId,
    });
    if (subscribed.error) return fail(subscribed.error);
    if (subscribed.data === 'unlinked') {
      return reply(req, { ok: false, message: '請先完成本人 LINE 綁定。' }, 409);
    }
    if (subscribed.data === 'limit_reached') {
      return reply(req, { ok: false, message: '最多可訂閱 100 臺設備。' }, 409);
    }
    if (subscribed.data !== 'subscribed') {
      return reply(req, { ok: false, message: SERVICE_UNAVAILABLE }, 503);
    }
    await writeAudit(userDb, profile.user_id, 'inspection_line_equipment_subscriptions', String(equipmentId),
      'status_change', null, { active: true });
    return reply(req, { ok: true, data: { equipment_id: equipmentId } });
  }

  if (action === 'equipment_line_unsubscribe') {
    const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(equipmentId)) {
      return reply(req, { ok: false, message: '設備識別碼無效。' }, 400);
    }
    const unsubscribed = await admin.rpc('unsubscribe_inspection_line_equipment', {
      p_user_id: profile.user_id, p_equipment_id: equipmentId,
    });
    if (unsubscribed.error) return fail(unsubscribed.error);
    if (unsubscribed.data === true) {
      await writeAudit(userDb, profile.user_id, 'inspection_line_equipment_subscriptions', equipmentId,
        'status_change', null, { active: false });
    }
    return reply(req, { ok: true, data: { unsubscribed: unsubscribed.data === true } });
  }

  const { data, error } = await admin.rpc('unlink_inspection_line', { p_user_id: profile.user_id });
  if (error) return fail(error);
  if (data === true) {
    await writeAudit(userDb, profile.user_id, 'inspection_line_bindings', profile.user_id,
      'status_change', null, { state: 'unlinked' });
  }
  return reply(req, { ok: true, data: { unlinked: data === true } });
}
