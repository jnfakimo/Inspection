// SYS-07 公務車派車：車輛主檔、派車申請與派車名單。
// 自 index.ts 原樣搬出（app-api 依業務拆檔第一階段），業務邏輯與錯誤訊息未更動。
import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';
import { writeAudit } from '../audit.ts';
import { createVehicleLineLinkCode, sha256Hex } from '../../_shared/vehicle-line-link.ts';

export const VEHICLE_ACTIONS = new Set([
  'save_official_vehicle', 'vehicle_create_request', 'vehicle_roster_update', 'vehicle_roster_remove_all',
  'vehicle_line_link_start', 'vehicle_line_link_status', 'vehicle_line_unlink',
]);

const LINK_SERVICE_UNAVAILABLE = 'LINE 綁定服務尚未就緒，請稍後再試。';

function isLinkSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code || '');
  return ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01'].includes(code);
}

function rpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' ? row as Record<string, unknown> : null;
}

function isoTimestamp(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

/** 處理公務車相關 action；不屬於本業務時回傳 null，由 index.ts 繼續往下分派。 */
export async function handleVehicleAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  const { req, body, profile, admin, userDb, reply, can, canModule, isAdmin } = ctx;

  if (action === 'vehicle_line_link_start') {
    if (!can('vehicle')) return reply(req, { ok: false, message: '目前沒有公務車系統權限。' }, 403);
    if (body.consent !== true) return reply(req, { ok: false, message: '請先同意 LINE 帳號綁定說明。' }, 400);

    const { data: driver, error: driverError } = await userDb.from('vehicle_dispatch_drivers')
      .select('user_id').eq('user_id', profile.user_id).eq('active', true).maybeSingle();
    if (driverError) {
      if (isLinkSchemaUnavailable(driverError)) return reply(req, { ok: false, message: LINK_SERVICE_UNAVAILABLE }, 503);
      throw driverError;
    }
    if (!driver) return reply(req, { ok: false, message: '此帳號尚未列入有效駕駛名單。' }, 403);

    const now = new Date().toISOString();
    const code = createVehicleLineLinkCode();
    const codeHash = await sha256Hex(code);
    const { data, error } = await admin.rpc('create_vehicle_line_link_intent', {
      p_user_id: profile.user_id,
      p_code_hash: codeHash,
      p_consented_at: now,
      p_now: now,
    });
    if (error) {
      if (isLinkSchemaUnavailable(error)) return reply(req, { ok: false, message: LINK_SERVICE_UNAVAILABLE }, 503);
      throw error;
    }
    const result = rpcRow(data);
    const expiresAt = isoTimestamp(result?.expires_at);
    if (result?.outcome === 'created' && expiresAt) {
      await writeAudit(userDb, profile.user_id, 'vehicle_line_link_intents', profile.user_id, 'insert', null, {
        state: 'pending', consented_at: now, expires_at: expiresAt,
      });
      return reply(req, { ok: true, data: { code, expires_at: expiresAt } });
    }
    if (result?.outcome === 'already_linked') {
      return reply(req, { ok: false, message: '此帳號已綁定 LINE；請先解除綁定，再開始新的綁定。' }, 409);
    }
    if (result?.outcome === 'driver_inactive' || result?.outcome === 'user_inactive') {
      return reply(req, { ok: false, message: '此帳號目前不符合駕駛綁定資格。' }, 403);
    }
    if (result?.outcome === 'invalid_request') return reply(req, { ok: false, message: '綁定資料無效，請重新操作。' }, 400);
    return reply(req, { ok: false, message: LINK_SERVICE_UNAVAILABLE }, 503);
  }

  if (action === 'vehicle_line_link_status') {
    const { data: binding, error: bindingError } = await admin.from('vehicle_driver_line_bindings')
      .select('state,linked_at').eq('user_id', profile.user_id).maybeSingle();
    if (bindingError) {
      if (isLinkSchemaUnavailable(bindingError)) return reply(req, { ok: false, message: LINK_SERVICE_UNAVAILABLE }, 503);
      throw bindingError;
    }
    const { data: pending, error: intentError } = await admin.from('vehicle_line_link_intents')
      .select('expires_at').eq('user_id', profile.user_id).eq('state', 'pending')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (intentError) {
      if (isLinkSchemaUnavailable(intentError)) return reply(req, { ok: false, message: LINK_SERVICE_UNAVAILABLE }, 503);
      throw intentError;
    }
    const linked = binding?.state === 'linked';
    const pendingExpiry = isoTimestamp(pending?.expires_at);
    const expiry = pendingExpiry && Date.parse(pendingExpiry) > Date.now() ? pendingExpiry : null;
    const linkedAt = linked ? isoTimestamp(binding?.linked_at) : null;
    return reply(req, { ok: true, data: {
      linked,
      linked_at: linkedAt,
      pending_expires_at: linked ? null : expiry,
    } });
  }

  if (action === 'vehicle_line_unlink') {
    // Unlink is always available to the active session owner, including after driver access is removed.
    const { data, error } = await admin.rpc('unlink_vehicle_line_account', { p_user_id: profile.user_id });
    if (error) {
      if (isLinkSchemaUnavailable(error)) return reply(req, { ok: false, message: LINK_SERVICE_UNAVAILABLE }, 503);
      throw error;
    }
    const unlinked = data === true;
    if (unlinked) {
      await writeAudit(userDb, profile.user_id, 'vehicle_driver_line_bindings', profile.user_id, 'status_change', null, {
        state: 'unlinked',
      });
    }
    return reply(req, { ok: true, data: { unlinked } });
  }

  if (action === 'save_official_vehicle') {
    if (!can('vehicle')) return reply(req, { ok: false, message: '目前角色沒有車輛主檔權限' }, 403);
    if (!canModule('vehicle', 'vehicles')) return reply(req, { ok: false, message: '目前帳號未開放公務車輛子系統' }, 403);
    const isFleetManager = isAdmin || (await userDb.from('vehicle_dispatch_managers').select('user_id').eq('user_id', profile.user_id).eq('active', true).maybeSingle()).data;
    if (!isFleetManager) return reply(req, { ok: false, message: '只有派車管理者可以維護車輛主檔' }, 403);
    const vehicleId = text(body.vehicle_id, 80);
    const plateNo = text(body.plate_no, 40);
    const seats = Number(body.seats);
    const odometer = Number(body.current_odometer);
    if (!plateNo || !Number.isInteger(seats) || seats < 1 || seats > 100 || !Number.isFinite(odometer) || odometer < 0 || odometer > 999999999) {
      return reply(req, { ok: false, message: '車號、座位數或里程資料無效' }, 400);
    }
    const payload = {
      plate_no: plateNo, vehicle_name: text(body.vehicle_name, 120) || null,
      brand: text(body.brand, 120) || null, model: text(body.model, 120) || null,
      seats, current_odometer: odometer, status: body.status === 'inactive' ? 'inactive' : 'active',
      note: text(body.note, 1000) || null,
    };
    if (vehicleId) {
      if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return reply(req, { ok: false, message: '車輛識別碼無效' }, 400);
      const { data, error } = await userDb.from('official_vehicles').update(payload).eq('vehicle_id', vehicleId).select('vehicle_id').maybeSingle();
      if (error) throw error;
      if (!data) return reply(req, { ok: false, message: '找不到車輛' }, 404);
      return reply(req, { ok: true, data: { vehicle_id: vehicleId, created: false } });
    }
    const { data, error } = await userDb.from('official_vehicles').insert({ ...payload, created_by: profile.user_id }).select('vehicle_id').single();
    if (error) throw error;
    return reply(req, { ok: true, data: { vehicle_id: data.vehicle_id, created: true } });
  }

  if (action === 'vehicle_create_request') {
    if (!can('vehicle')) return reply(req, { ok: false, message: '目前角色沒有派車系統權限' }, 403);
    if (!canModule('vehicle', 'requests')) return reply(req, { ok: false, message: '目前帳號未開放派車申請子系統' }, 403);
    const tripDate = text(body.trip_date, 10);
    const departure = text(body.planned_departure_time, 5), returnTime = text(body.planned_return_time, 5);
    const origin = text(body.origin_location, 200), destination = text(body.destination_location, 200);
    const purpose = text(body.trip_purpose, 500);
    const passengerCount = Number(body.passenger_count);
    const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!validISODate(tripDate)) return reply(req, { ok: false, message: '用車日期格式無效' }, 400);
    if (!timePattern.test(departure) || !timePattern.test(returnTime) || returnTime <= departure) return reply(req, { ok: false, message: '起訖時間必須有效且回程晚於出發' }, 400);
    if (!origin || !destination || !purpose) return reply(req, { ok: false, message: '出發地、目的地與用途皆為必填' }, 400);
    if (!Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 99) return reply(req, { ok: false, message: '搭乘人數必須為 1–99 的整數' }, 400);
    const payload = {
      applicant_id: profile.user_id, applicant_name: text(profile.name, 160) || text(profile.username, 160),
      applicant_department: text(profile.department, 200) || null,
      trip_date: tripDate, planned_departure_time: departure, planned_return_time: returnTime,
      origin_location: origin, destination_location: destination, trip_purpose: purpose,
      passenger_count: passengerCount, applicant_phone: text(body.applicant_phone, 50) || null,
      applicant_note: text(body.applicant_note, 500) || null, status: 'pending_approval',
    };
    const { data, error } = await userDb.from('vehicle_dispatch_requests').insert(payload).select('request_id').single();
    if (error) {
      const raw = String(error.message || '');
      if (/exclusion constraint|23P01|overlap/i.test(raw)) return reply(req, { ok: false, message: '該時段已有其他派車申請，請改選其他時段' }, 409);
      if (/預計出發時間已經過去|past/i.test(raw)) return reply(req, { ok: false, message: '預計出發時間已經過去，請選擇目前時間之後的時段' }, 400);
      throw error;
    }
    await writeAudit(userDb, profile.user_id, 'vehicle_dispatch_requests', data.request_id, 'insert', null, payload);
    return reply(req, { ok: true, data });
  }

  if (action === 'vehicle_roster_update') {
    if (!can('vehicle') || !isAdmin) return reply(req, { ok: false, message: '只有管理者可以維護派車名單' }, 403);
    const rosterTable = text(body.table, 60);
    if (rosterTable !== 'vehicle_dispatch_drivers' && rosterTable !== 'vehicle_dispatch_managers') return reply(req, { ok: false, message: '名單類型無效' }, 400);
    const rosterModule = rosterTable === 'vehicle_dispatch_drivers' ? 'drivers' : 'managers';
    if (!canModule('vehicle', rosterModule)) return reply(req, { ok: false, message: '目前帳號未開放此派車名單子系統' }, 403);
    const targetUser = text(body.user_id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(targetUser)) return reply(req, { ok: false, message: '人員識別碼無效' }, 400);
    const remove = body.remove === true;
    const active = remove ? false : body.active === true;
    const { data: before, error: readError } = await userDb.from(rosterTable).select('user_id,active,assigned_by').eq('user_id', targetUser).maybeSingle();
    if (readError) throw readError;
    if (remove && !before) return reply(req, { ok: false, message: '找不到指定的名單人員' }, 404);
    const payload: Record<string, unknown> = { user_id: targetUser, active, updated_at: new Date().toISOString() };
    if (!before) payload.assigned_by = profile.user_id;
    const { data, error } = await userDb.from(rosterTable).upsert(payload, { onConflict: 'user_id' }).select('user_id').single();
    if (error) throw error;
    await writeAudit(userDb, profile.user_id, rosterTable, targetUser, before ? 'status_change' : 'insert', before || null, { active, removed: remove });
    return reply(req, { ok: true, data });
  }

  if (action === 'vehicle_roster_remove_all') {
    if (!can('vehicle') || !isAdmin) return reply(req, { ok: false, message: '只有管理者可以維護派車名單' }, 403);
    const rosterTable = text(body.table, 60);
    if (rosterTable !== 'vehicle_dispatch_drivers' && rosterTable !== 'vehicle_dispatch_managers') return reply(req, { ok: false, message: '名單類型無效' }, 400);
    const rosterModule = rosterTable === 'vehicle_dispatch_drivers' ? 'drivers' : 'managers';
    if (!canModule('vehicle', rosterModule)) return reply(req, { ok: false, message: '目前帳號未開放此派車名單子系統' }, 403);
    const { data: before, error: readError } = await userDb.from(rosterTable)
      .select('user_id,active,assigned_by').eq('active', true);
    if (readError) throw readError;
    if (!before?.length) return reply(req, { ok: true, data: [], count: 0 });
    const updatedAt = new Date().toISOString();
    const { data, error } = await userDb.from(rosterTable).update({ active: false, updated_at: updatedAt })
      .eq('active', true).select('user_id');
    if (error) throw error;
    await Promise.all((before as Array<Record<string, unknown>>).map(row => writeAudit(
      userDb, profile.user_id, rosterTable, String(row.user_id), 'status_change', row,
      { active: false, removed: true },
    )));
    return reply(req, { ok: true, data: data || [], count: data?.length || 0 });
  }
  return null;
}
