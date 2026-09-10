export const MECHANICAL_SCHEDULE_DUTY_CODES = [
  '01-09', '09-17', '17-01', 'weekly_off', 'rest_day', 'rotation_off',
  'annual_leave', 'official_leave', 'sick_leave', 'personal_leave',
] as const;

type DutyCode = (typeof MECHANICAL_SCHEDULE_DUTY_CODES)[number];
export type MechanicalScheduleInput = {
  user_id: string;
  duty_date: string;
  duty_code: string;
  market_code: string;
  is_active?: boolean;
};
export type MechanicalScheduleError = { rule: string; user_id: string; duty_date: string; message: string };

const DAY = 86_400_000;
const WORK = new Set(['01-09', '09-17', '17-01']);
const CODES = new Set<string>(MECHANICAL_SCHEDULE_DUTY_CODES);
const dayNo = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const iso = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);
const monday = (day: number) => day - ((new Date(day * DAY).getUTCDay() + 6) % 7);

function interval(date: string, code: string) {
  const day = dayNo(date) * DAY;
  if (code === '01-09') return { start: day + 3_600_000, end: day + 9 * 3_600_000 };
  if (code === '09-17') return { start: day + 9 * 3_600_000, end: day + 17 * 3_600_000 };
  return { start: day + 17 * 3_600_000, end: day + 25 * 3_600_000 };
}

export function validateMechanicalScheduleRows(rows: MechanicalScheduleInput[], focusStart: string, focusEnd: string) {
  const normalized = rows.filter(row => row.is_active !== false && row.user_id && /^\d{4}-\d{2}-\d{2}$/.test(row.duty_date) && CODES.has(row.duty_code));
  const errors: MechanicalScheduleError[] = [];
  const keys = new Set<string>();
  const add = (error: MechanicalScheduleError) => {
    const key = `${error.rule}|${error.user_id}|${error.duty_date}|${error.message}`;
    if (!keys.has(key)) { keys.add(key); errors.push(error); }
  };
  const userDate = new Map<string, MechanicalScheduleInput[]>();
  normalized.forEach(row => {
    const key = `${row.user_id}|${row.duty_date}`;
    const current = userDate.get(key) || [];
    current.push(row); userDate.set(key, current);
  });

  for (const [key, values] of userDate) {
    const [userId, date] = key.split('|');
    const workCount = values.filter(value => WORK.has(value.duty_code)).length;
    if (workCount > 1) add({ rule: 'daily_hours', user_id: userId, duty_date: date, message: `同日排了 ${workCount} 個班次（${workCount * 8} 小時），超過每日 8 小時或跨市場重複排班。` });
  }

  const workByUser = new Map<string, MechanicalScheduleInput[]>();
  normalized.filter(row => WORK.has(row.duty_code)).forEach(row => {
    const current = workByUser.get(row.user_id) || [];
    current.push(row); workByUser.set(row.user_id, current);
  });
  for (const [userId, workRows] of workByUser) {
    const timed = workRows.map(row => ({ ...row, ...interval(row.duty_date, row.duty_code) })).sort((a, b) => a.start - b.start || a.end - b.end);
    for (let index = 1; index < timed.length; index += 1) {
      const hours = (timed[index].start - timed[index - 1].end) / 3_600_000;
      if (hours < 11) add({ rule: 'rest_interval', user_id: userId, duty_date: timed[index].duty_date, message: `班次間僅休息 ${Math.max(0, hours).toFixed(0)} 小時，未達連續 11 小時。` });
    }
    const weekHours = new Map<number, number>();
    timed.forEach(row => {
      const start = monday(dayNo(row.duty_date));
      weekHours.set(start, (weekHours.get(start) || 0) + 8);
    });
    weekHours.forEach((hours, start) => {
      if (hours > 40) add({ rule: 'weekly_hours', user_id: userId, duty_date: iso(start), message: `本週排班 ${hours} 小時，超過一般工時每週 40 小時。` });
    });
    const dates = [...new Set(workRows.map(row => dayNo(row.duty_date)))].sort((a, b) => a - b);
    let first = 0;
    for (let index = 1; index <= dates.length; index += 1) {
      if (index < dates.length && dates[index] === dates[index - 1] + 1) continue;
      const length = index - first;
      if (length > 6) add({ rule: 'consecutive_days', user_id: userId, duty_date: iso(dates[first + 6]), message: `連續工作 ${length} 日，超過 6 日上限。` });
      first = index;
    }
    const workDaySet = new Set(dates);
    for (const currentDay of dates) {
      const sevenDayWorkCount = Array.from({ length: 7 }, (_, index) => currentDay - 6 + index)
        .filter(day => workDaySet.has(day)).length;
      const currentDate = iso(currentDay);
      if (sevenDayWorkCount > 5 && currentDate >= focusStart && currentDate <= focusEnd) {
        add({ rule: 'weekly_rest', user_id: userId, duty_date: currentDate, message: `截至本日的連續 7 日內已工作 ${sevenDayWorkCount} 日，未保留例假與休息日共 2 日。` });
      }
    }
  }
  return errors.sort((a, b) => a.duty_date.localeCompare(b.duty_date) || a.user_id.localeCompare(b.user_id));
}
