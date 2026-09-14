import assert from 'node:assert/strict';
import test from 'node:test';
import { patrolShiftDeleteTargets, type PatrolShiftDeleteRow } from './patrol-shifts.ts';

const row = (shift_id: string, shift_date: string, name: string): PatrolShiftDeleteRow => ({
  shift_id, shift_date, name, assigned_user_ids: [],
});

test('清除界線保留前一值班日存於當日的隔夜夜班', () => {
  const rows = [
    row('previous-night', '2099-01-02', '夜班'),
    row('same-day', '2099-01-02', '早班'),
    row('selected-night', '2099-01-03', '夜班'),
    row('future', '2099-01-04', '中班'),
  ];
  assert.deepEqual(
    patrolShiftDeleteTargets(rows, '2099-01-02', new Set(['selected-night'])).map(item => item.shift_id),
    ['same-day', 'selected-night', 'future'],
  );
});

test('舊制夜班若明確屬於所選值班日則清除，已軟刪除資料不重複處理', () => {
  const rows = [
    row('legacy-night', '2099-01-02', '夜班（隔夜）'),
    row('deleted', '2099-01-03', '[已刪除] 早班 abcdef12'),
  ];
  assert.deepEqual(
    patrolShiftDeleteTargets(rows, '2099-01-02', new Set(['legacy-night'])).map(item => item.shift_id),
    ['legacy-night'],
  );
});
