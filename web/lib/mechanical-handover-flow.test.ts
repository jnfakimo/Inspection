import test from 'node:test';
import assert from 'node:assert/strict';
import { carryTargetShift, currentMechanicalShift, outstandingMechanicalEntries, shiftSlot } from './mechanical-handover-flow.ts';

test('recognizes Taipei business shift including midnight carry', () => {
  assert.deepEqual(currentMechanicalShift(new Date('2026-09-10T03:52:00Z')), { workDate: '2026-09-10', shiftCode: '09-17' });
  assert.deepEqual(currentMechanicalShift(new Date('2026-09-09T16:30:00Z')), { workDate: '2026-09-09', shiftCode: '17-01' });
});

test('keeps only unresolved lineage leaves', () => {
  const rows = [
    { entry_id: 'a', result: '待料' },
    { entry_id: 'b', carry_source_id: 'a', result: '處理中' },
    { entry_id: 'c', result: '已完成' },
  ];
  assert.deepEqual(outstandingMechanicalEntries(rows).map(row => row.entry_id), ['b']);
});

test('places overdue work in the active shift and future work in its next shift', () => {
  const atNoon = new Date('2026-09-10T03:52:00Z');
  assert.equal(carryTargetShift({ work_date: '2026-09-09', shift_code: '17-01' }, '2026-09-10', atNoon), '09-17');
  assert.equal(carryTargetShift({ work_date: '2026-09-10', shift_code: '09-17' }, '2026-09-10', atNoon), '17-01');
  assert.ok(shiftSlot('2026-09-10', '01-09') < shiftSlot('2026-09-10', '09-17'));
});
