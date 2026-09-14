// SYS-03 巡檢排班：批次清除所選值班日起的班別，保留歷史與範本。
import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';

/** 處理巡檢排班批次動作；單筆班別與範本刪除仍由既有流程處理。 */
export async function handlePatrolShiftAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  if (action !== 'patrol_shift_delete_from_date') return null;
  const { req, body, profile, userDb, reply, can, canModule, isAdmin } = ctx;
  if (!can('guardpatrol') || !isAdmin) return reply(req, { ok: false, message: '只有巡邏系統管理者可以清除班別' }, 403);
  if (!canModule('guardpatrol', 'shifts')) return reply(req, { ok: false, message: '目前帳號未開放巡檢排班子系統' }, 403);

  const fromDate = text(body.from_date, 10);
  if (!validISODate(fromDate)) return reply(req, { ok: false, message: '起始值班日期格式無效' }, 400);
  const todayInTaipei = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  if (fromDate < todayInTaipei) return reply(req, { ok: false, message: '只能清除今天或未來的班別，過去班表必須保留' }, 400);
  const dutyShiftIds = (Array.isArray(body.duty_shift_ids) ? body.duty_shift_ids : [])
    .map((value: unknown) => text(value, 80))
    .filter((value: string) => /^[0-9a-f-]{36}$/i.test(value));

  // 清除與逐筆稽核都在資料庫函式的同一交易內；任何一筆失敗會整批回復。
  const { data, error } = await userDb.rpc('soft_delete_patrol_shifts_from_date', {
    p_from: fromDate,
    p_duty_shift_ids: dutyShiftIds,
  });
  if (error) throw error;
  return reply(req, { ok: true, data: { count: Number(data || 0), from_date: fromDate } });
}
