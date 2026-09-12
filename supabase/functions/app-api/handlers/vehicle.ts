// SYS-07 公務車派車：車輛主檔、派車申請與派車名單。
// 自 index.ts 原樣搬出（app-api 依業務拆檔第一階段），業務邏輯與錯誤訊息未更動。
import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';
import { writeAudit } from '../audit.ts';

export const VEHICLE_ACTIONS = new Set(['save_official_vehicle', 'vehicle_create_request', 'vehicle_roster_update', 'vehicle_roster_remove_all']);

/** 處理公務車相關 action；不屬於本業務時回傳 null，由 index.ts 繼續往下分派。 */
export async function handleVehicleAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  const { req, body, profile, userDb, reply, can, canModule, isAdmin } = ctx;
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
