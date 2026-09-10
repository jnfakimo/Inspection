export const MECHANICAL_SCHEDULE_CODES = [
  '01-09', '09-17', '17-01', 'weekly_off', 'rest_day', 'rotation_off',
  'annual_leave', 'official_leave', 'sick_leave', 'personal_leave',
] as const;

export type MechanicalScheduleCode = (typeof MECHANICAL_SCHEDULE_CODES)[number];

export type MechanicalScheduleRow = {
  user_id?: unknown;
  duty_date?: unknown;
  duty_code?: unknown;
  market_code?: unknown;
  is_active?: unknown;
};

export type MechanicalScheduleViolation = {
  severity: 'error' | 'warning';
  rule: 'daily_hours' | 'rest_interval' | 'weekly_hours' | 'consecutive_days' | 'weekly_rest' | 'incomplete_week';
  userId: string;
  date: string;
  message: string;
};

const DAY_MS = 86_400_000;
const WORK_CODES = new Set<MechanicalScheduleCode>(['01-09', '09-17', '17-01']);
const CODE_SET = new Set<string>(MECHANICAL_SCHEDULE_CODES);

export const MECHANICAL_SCHEDULE_LABELS: Record<MechanicalScheduleCode, string> = {
  '01-09': '早班 01:00-09:00',
  '09-17': '中班 09:00-17:00',
  '17-01': '晚班 17:00-翌日01:00',
  weekly_off: '例假',
  rest_day: '休息日',
  rotation_off: '輪休',
  annual_leave: '特休',
  official_leave: '公假',
  sick_leave: '病假',
  personal_leave: '事假',
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dayNumber(value: string) {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / DAY_MS);
}

function isoDate(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function mondayFor(day: number) {
  const weekDay = new Date(day * DAY_MS).getUTCDay();
  return day - ((weekDay + 6) % 7);
}

function interval(row: { duty_date: string; duty_code: MechanicalScheduleCode }) {
  const day = dayNumber(row.duty_date) * DAY_MS;
  if (row.duty_code === '01-09') return { start: day + 1 * 3_600_000, end: day + 9 * 3_600_000 };
  if (row.duty_code === '09-17') return { start: day + 9 * 3_600_000, end: day + 17 * 3_600_000 };
  return { start: day + 17 * 3_600_000, end: day + 25 * 3_600_000 };
}

export function shiftScheduleMonth(month: string, offset: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function scheduleMonthDates(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const year = Number(match[1]), monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return [];
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
}

export function scheduleCalendarDates(month: string) {
  const dates = scheduleMonthDates(month);
  if (!dates.length) return [];
  const firstDay = dayNumber(dates[0]);
  const sunday = firstDay - new Date(firstDay * DAY_MS).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => isoDate(sunday + index));
}

export function scheduleDateOffset(value: string, offset: number) {
  return isoDate(dayNumber(value) + offset);
}

export function copyPreviousMonthDraft(
  rows: MechanicalScheduleRow[],
  targetMonth: string,
  marketCode: string,
  allowedUserIds: Iterable<unknown>,
) {
  const sourceMonth = shiftScheduleMonth(targetMonth, -1);
  const targetDates = new Set(scheduleMonthDates(targetMonth));
  const allowedUsers = new Set(Array.from(allowedUserIds, value => String(value)));
  const draft: Record<string, string> = {};
  rows.forEach(row => {
    const userId = String(row.user_id || '');
    const sourceDate = String(row.duty_date || '');
    const dutyCode = String(row.duty_code || '');
    if (!userId || !allowedUsers.has(userId) || row.is_active === false || String(row.market_code || '') !== marketCode
      || !sourceDate.startsWith(`${sourceMonth}-`) || !isMechanicalWorkCode(dutyCode)) return;
    const targetDate = `${targetMonth}-${sourceDate.slice(-2)}`;
    if (targetDates.has(targetDate)) draft[`${userId}|${targetDate}`] = dutyCode;
  });
  return draft;
}

export function isMechanicalWorkCode(value: unknown): value is '01-09' | '09-17' | '17-01' {
  return WORK_CODES.has(String(value) as MechanicalScheduleCode);
}

export function validateMechanicalSchedule(rows: MechanicalScheduleRow[], focus?: { start: string; end: string }) {
  const normalized = rows.flatMap(row => {
    const userId = String(row.user_id || '');
    const dutyDate = String(row.duty_date || '');
    const dutyCode = String(row.duty_code || '');
    if (!userId || !validDate(dutyDate) || !CODE_SET.has(dutyCode) || row.is_active === false) return [];
    return [{ user_id: userId, duty_date: dutyDate, duty_code: dutyCode as MechanicalScheduleCode, market_code: String(row.market_code || '') }];
  });
  const violations: MechanicalScheduleViolation[] = [];
  const seen = new Set<string>();
  const add = (violation: MechanicalScheduleViolation) => {
    const key = `${violation.severity}|${violation.rule}|${violation.userId}|${violation.date}|${violation.message}`;
    if (!seen.has(key)) { seen.add(key); violations.push(violation); }
  };
  const userDate = new Map<string, typeof normalized>();
  normalized.forEach(row => {
    const key = `${row.user_id}|${row.duty_date}`;
    const current = userDate.get(key) || [];
    current.push(row); userDate.set(key, current);
  });

  for (const [key, dayRows] of userDate) {
    const [userId, date] = key.split('|');
    const work = dayRows.filter(row => isMechanicalWorkCode(row.duty_code));
    if (work.length > 1) add({ severity: 'error', rule: 'daily_hours', userId, date, message: `同日排了 ${work.length} 個班次（${work.length * 8} 小時），超過每日正常工時 8 小時，或跨一市、二市重複排班。` });
  }

  const byUserWork = new Map<string, Array<(typeof normalized)[number]>>();
  normalized.filter(row => isMechanicalWorkCode(row.duty_code)).forEach(row => {
    const current = byUserWork.get(row.user_id) || [];
    current.push(row); byUserWork.set(row.user_id, current);
  });

  for (const [userId, workRows] of byUserWork) {
    const timed = workRows.map(row => ({ ...row, ...interval(row) })).sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < timed.length; index += 1) {
      const restHours = (timed[index].start - timed[index - 1].end) / 3_600_000;
      if (restHours < 11) add({ severity: 'error', rule: 'rest_interval', userId, date: timed[index].duty_date, message: `前一班結束至本班開始僅休息 ${Math.max(0, restHours).toFixed(0)} 小時，未達連續 11 小時。` });
    }

    const byWeek = new Map<number, number>();
    timed.forEach(row => {
      const monday = mondayFor(dayNumber(row.duty_date));
      byWeek.set(monday, (byWeek.get(monday) || 0) + 8);
    });
    for (const [monday, hours] of byWeek) {
      if (hours > 40) add({ severity: 'error', rule: 'weekly_hours', userId, date: isoDate(monday), message: `本週已排 ${hours} 小時，超過一般工時每週 40 小時。` });
    }

    const workDays = [...new Set(workRows.map(row => dayNumber(row.duty_date)))].sort((a, b) => a - b);
    let streakStart = 0;
    for (let index = 1; index <= workDays.length; index += 1) {
      if (index < workDays.length && workDays[index] === workDays[index - 1] + 1) continue;
      const length = index - streakStart;
      if (length > 6) add({ severity: 'error', rule: 'consecutive_days', userId, date: isoDate(workDays[streakStart + 6]), message: `連續工作 ${length} 日，超過 6 日上限。` });
      streakStart = index;
    }

    const workDaySet = new Set(workDays);
    for (const currentDay of workDays) {
      const sevenDayWorkCount = Array.from({ length: 7 }, (_, index) => currentDay - 6 + index)
        .filter(day => workDaySet.has(day)).length;
      const currentDate = isoDate(currentDay);
      if (sevenDayWorkCount > 5 && (!focus || (currentDate >= focus.start && currentDate <= focus.end))) {
        add({ severity: 'error', rule: 'weekly_rest', userId, date: currentDate, message: `截至本日的連續 7 日內已工作 ${sevenDayWorkCount} 日，未保留例假與休息日共 2 日。` });
      }
    }
  }

  return violations.sort((a, b) => a.severity.localeCompare(b.severity) || a.date.localeCompare(b.date) || a.userId.localeCompare(b.userId));
}
