// SYS-03 巡檢排班：批次清除所選值班日起的班別，保留歷史與範本。
import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';
import { writeAudit } from '../audit.ts';

export type PatrolShiftDeleteRow = {
  shift_id: string;
  shift_date: string;
  name: string;
  assigned_user_ids: unknown;
};

export function patrolShiftDeleteTargets(rows: PatrolShiftDeleteRow[], fromDate: string, dutyShiftIds: Set<string>) {
  return rows.filter(row => {
    if (String(row.name || '').startsWith('[已刪除]')) return false;
    if (row.shift_date > fromDate) return true;
    if (!/夜班|night/i.test(String(row.name || '').replace(/\s+/g, ''))) return true;
    // 新制夜班存於隔日：界線當天的夜班通常屬於前一值班日，必須保留。
    // 只有前端明確指出它出現在所選值班日畫面時，才一併清除（相容舊制資料）。
    return dutyShiftIds.has(row.shift_id);
  });
}

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
  const dutyShiftIds = new Set<string>((Array.isArray(body.duty_shift_ids) ? body.duty_shift_ids : [])
    .map((value: unknown) => text(value, 80))
    .filter((value: string) => /^[0-9a-f-]{36}$/i.test(value)));

  const rows: PatrolShiftDeleteRow[] = [];
  // PostgREST 預設最多回傳 1,000 筆；逐頁讀完，避免長期預排資料只清到第一頁。
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await userDb.from('patrol_shifts')
      .select('shift_id,shift_date,name,assigned_user_ids')
      .gte('shift_date', fromDate)
      .order('shift_date').order('shift_id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as PatrolShiftDeleteRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  const targets = patrolShiftDeleteTargets(rows, fromDate, dutyShiftIds);
  for (const before of targets) {
    const hiddenName = `[已刪除] ${before.name} ${crypto.randomUUID().slice(0, 8)}`;
    const { error } = await userDb.from('patrol_shifts')
      .update({ name: hiddenName, assigned_user_ids: [] })
      .eq('shift_id', before.shift_id);
    if (error) throw error;
    await writeAudit(userDb, profile.user_id, 'patrol_shifts', before.shift_id, 'update',
      { shift_date: before.shift_date, name: before.name, assigned_user_ids: before.assigned_user_ids },
      { shift_date: before.shift_date, name: hiddenName, assigned_user_ids: [], bulk_from_date: fromDate });
  }
  return reply(req, { ok: true, data: { count: targets.length, from_date: fromDate } });
}
