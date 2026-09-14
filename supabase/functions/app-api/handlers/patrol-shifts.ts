// SYS-03 巡檢排班：批次清除所選值班日起的班別，保留歷史與範本。
import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';

/** 處理巡檢排班批次動作；單筆班別與範本刪除仍由既有流程處理。 */
export async function handlePatrolShiftAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  if (!['patrol_shift_delete_from_date', 'patrol_shift_apply_all_templates', 'patrol_shift_set_day_status'].includes(action)) return null;
  const { req, body, profile, userDb, reply, can, canModule, isAdmin } = ctx;
  if (!can('guardpatrol') || !isAdmin) return reply(req, { ok: false, message: '只有巡邏系統管理者可以清除班別' }, 403);
  if (!canModule('guardpatrol', 'shifts')) return reply(req, { ok: false, message: '目前帳號未開放巡檢排班子系統' }, 403);

  const fromDate = text(body.from_date, 10);
  if (!validISODate(fromDate)) return reply(req, { ok: false, message: '起始值班日期格式無效' }, 400);
  const todayInTaipei = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  if (fromDate < todayInTaipei) return reply(req, { ok: false, message: '只能從今天或未來日期調整班別，過去班表必須保留' }, 400);

  if (action === 'patrol_shift_apply_all_templates') {
    const toDate = text(body.to_date, 10);
    if (!validISODate(toDate)) return reply(req, { ok: false, message: '結束值班日期格式無效' }, 400);
    if (toDate < fromDate) return reply(req, { ok: false, message: '迄日不可早於起日' }, 400);
    const { data, error } = await userDb.rpc('apply_all_patrol_shift_templates_and_activate', {
      p_from: fromDate,
      p_to: toDate,
    });
    if (error) throw error;
    return reply(req, { ok: true, data: data || { templates: 0, days: 0, rows: 0 } });
  }

  if (action === 'patrol_shift_set_day_status') {
    const suspended = body.suspended === true;
    const reason = text(body.reason, 500);
    if (suspended && !reason) return reply(req, { ok: false, message: '停用當日班表時必須填寫原因' }, 400);
    const { data, error } = await userDb.rpc('set_patrol_shift_day_status', {
      p_duty_date: fromDate,
      p_suspended: suspended,
      p_reason: reason || null,
    });
    if (error) throw error;
    return reply(req, { ok: true, data });
  }

  const dutyShiftIds = (Array.isArray(body.duty_shift_ids) ? body.duty_shift_ids : [])
    .map((value: unknown) => text(value, 80))
    .filter((value: string) => /^[0-9a-f-]{36}$/i.test(value));

  // 清除與逐筆稽核都在資料庫函式的同一交易內；任何一筆失敗會整批回復。
  const { data, error } = await userDb.rpc('reset_patrol_shifts_from_date', {
    p_from: fromDate,
    p_duty_shift_ids: dutyShiftIds,
  });
  if (error) throw error;
  return reply(req, { ok: true, data: data || { count: 0, from_date: fromDate, suspended_days: 0 } });
}
