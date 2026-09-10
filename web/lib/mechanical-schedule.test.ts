import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleCalendarDates, validateMechanicalSchedule } from './mechanical-schedule.ts';

const id = '00000000-0000-4000-8000-000000000001';
const row = (date: string, code: string, market = 'market_1') => ({ user_id: id, duty_date: date, duty_code: code, market_code: market });

test('blocks adjacent shifts with less than eleven hours of rest', () => {
  const violations = validateMechanicalSchedule([row('2026-09-01', '09-17'), row('2026-09-02', '01-09')]);
  assert.ok(violations.some(item => item.rule === 'rest_interval'));
});

test('blocks a worker assigned to both markets on the same day', () => {
  const violations = validateMechanicalSchedule([row('2026-09-01', '01-09'), row('2026-09-01', '09-17', 'market_2')]);
  assert.ok(violations.some(item => item.rule === 'daily_hours'));
});

test('blocks more than forty hours and more than six consecutive work days', () => {
  const rows = Array.from({ length: 7 }, (_, index) => row(`2026-09-${String(index + 7).padStart(2, '0')}`, '09-17'));
  const violations = validateMechanicalSchedule(rows);
  assert.ok(violations.some(item => item.rule === 'weekly_hours'));
  assert.ok(violations.some(item => item.rule === 'consecutive_days'));
});

test('blocks six work days in a rolling seven-day window', () => {
  const rows = Array.from({ length: 6 }, (_, index) => row(`2026-09-${String(index + 7).padStart(2, '0')}`, '09-17'));
  const violations = validateMechanicalSchedule(rows, { start: '2026-09-07', end: '2026-09-13' });
  assert.ok(violations.some(item => item.rule === 'weekly_rest'));
});

test('accepts five irregular work days with two unscheduled rest days', () => {
  const rows = [
    row('2026-09-07', '01-09'), row('2026-09-08', '09-17'), row('2026-09-10', '17-01'),
    row('2026-09-12', '09-17'), row('2026-09-13', '17-01'),
  ];
  const violations = validateMechanicalSchedule(rows, { start: '2026-09-07', end: '2026-09-13' });
  assert.deepEqual(violations, []);
});

test('perpetual calendar always spans six complete weeks and leap day', () => {
  const dates = scheduleCalendarDates('2028-02');
  assert.equal(dates.length, 42);
  assert.equal(dates[0], '2028-01-30');
  assert.ok(dates.includes('2028-02-29'));
  assert.equal(dates.at(-1), '2028-03-11');
});
