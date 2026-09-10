export const MECHANICAL_SHIFTS = ['01-09', '09-17', '17-01'] as const;
export type MechanicalShiftCode = (typeof MECHANICAL_SHIFTS)[number];

export const UNFINISHED_MECHANICAL_RESULTS = new Set([
  '處理中', '待料', '待廠商', '交下班續辦', '無法處理',
]);

type HandoverRow = {
  entry_id?: unknown;
  carry_source_id?: unknown;
  work_date?: unknown;
  shift_code?: unknown;
  result?: unknown;
};

export function isUnfinishedMechanicalResult(result: unknown) {
  return UNFINISHED_MECHANICAL_RESULTS.has(String(result || ''));
}

export function shiftSlot(date: string, shiftCode: string) {
  const day = Math.floor(new Date(`${date}T12:00:00+08:00`).getTime() / 86_400_000);
  const shift = MECHANICAL_SHIFTS.indexOf(shiftCode as MechanicalShiftCode);
  return shift < 0 || !Number.isFinite(day) ? Number.NaN : day * MECHANICAL_SHIFTS.length + shift;
}

export function currentMechanicalShift(now = new Date()) {
  const taipei = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce<Record<string, string>>((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = part.value;
    return parts;
  }, {});
  const hour = Number(taipei.hour);
  let workDate = `${taipei.year}-${taipei.month}-${taipei.day}`;
  let shiftCode: MechanicalShiftCode = hour >= 9 && hour < 17 ? '09-17' : hour >= 17 || hour < 1 ? '17-01' : '01-09';
  if (hour < 1) {
    const prior = new Date(`${workDate}T12:00:00+08:00`);
    prior.setDate(prior.getDate() - 1);
    workDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(prior);
  }
  return { workDate, shiftCode };
}

export function taipeiISODate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function mechanicalApprovalOpensOn(workDate: string) {
  const value = new Date(`${workDate}T12:00:00+08:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || Number.isNaN(value.getTime())) return '';
  value.setDate(value.getDate() + 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

export function canApproveMechanicalDay(workDate: string, now = new Date()) {
  const opensOn = mechanicalApprovalOpensOn(workDate);
  return Boolean(opensOn) && taipeiISODate(now) >= opensOn;
}

export function outstandingMechanicalEntries(rows: HandoverRow[]) {
  const continued = new Set(rows.map(row => String(row.carry_source_id || '')).filter(Boolean));
  return rows.filter(row => {
    const id = String(row.entry_id || '');
    return id && !continued.has(id) && isUnfinishedMechanicalResult(row.result);
  });
}

export function carryTargetShift(source: HandoverRow, selectedDate: string, now = new Date()) {
  const sourceSlot = shiftSlot(String(source.work_date || ''), String(source.shift_code || ''));
  if (!Number.isFinite(sourceSlot)) return null;
  const active = currentMechanicalShift(now);
  const activeIndex = selectedDate === active.workDate ? MECHANICAL_SHIFTS.indexOf(active.shiftCode) : 0;
  for (let index = Math.max(0, activeIndex); index < MECHANICAL_SHIFTS.length; index += 1) {
    const code = MECHANICAL_SHIFTS[index];
    if (shiftSlot(selectedDate, code) > sourceSlot) return code;
  }
  return null;
}
