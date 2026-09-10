import test from 'node:test';
import assert from 'node:assert/strict';
import { canApproveMechanicalDay, carryTargetShift, currentMechanicalShift, mechanicalApprovalOpensOn, outstandingMechanicalEntries, shiftSlot } from './mechanical-handover-flow.ts';

test('recognizes Taipei business shift including midnight carry', () => {
  assert.deepEqual(currentMechanicalShift(new Date('2026-09-10T03:52:00Z')), { workDate: '2026-09-10', shiftCode: '09-17' });
  assert.deepEqual(currentMechanicalShift(new Date('2026-09-09T16:30:00Z')), { workDate: '2026-09-09', shiftCode: '17-01' });
});

test('keeps only unresolved lineage leaves', () => {
  const rows = [
    { entry_id: 'a', result: '待料' },
    { entry_id: 'b', carry_source_id: 'a', result: '處理中' },
    { entry_id: 'c', result: '已完成' },
    { entry_id: 'd', result: '待廠商', is_deleted: true },
  ];
  assert.deepEqual(outstandingMechanicalEntries(rows).map(row => row.entry_id), ['b']);
});

test('allows a source to return to the queue when its continuation was soft-deleted', () => {
  const rows = [
    { entry_id: 'source', result: '待料' },
    { entry_id: 'deleted-child', carry_source_id: 'source', result: '處理中', is_deleted: true },
  ];
  assert.deepEqual(outstandingMechanicalEntries(rows).map(row => row.entry_id), ['source']);
});

test('places overdue work in the active shift and future work in its next shift', () => {
  const atNoon = new Date('2026-09-10T03:52:00Z');
  assert.equal(carryTargetShift({ work_date: '2026-09-09', shift_code: '17-01' }, '2026-09-10', atNoon), '09-17');
  assert.equal(carryTargetShift({ work_date: '2026-09-10', shift_code: '09-17' }, '2026-09-10', atNoon), '17-01');
  assert.ok(shiftSlot('2026-09-10', '01-09') < shiftSlot('2026-09-10', '09-17'));
});

test('daily approval opens only on the following Taipei calendar day', () => {
  assert.equal(mechanicalApprovalOpensOn('2026-09-10'), '2026-09-11');
  assert.equal(canApproveMechanicalDay('2026-09-10', new Date('2026-09-10T15:59:59Z')), false);
  assert.equal(canApproveMechanicalDay('2026-09-10', new Date('2026-09-10T16:00:00Z')), true);
  assert.equal(canApproveMechanicalDay('not-a-date', new Date('2026-09-11T00:00:00Z')), false);
});
