import test from 'node:test';
import assert from 'node:assert/strict';
import { appendMechanicalWorkDetails, canApproveMechanicalDay, carryTargetShift, currentMechanicalShift, mechanicalApprovalOpensOn, mechanicalWorkDetails, outstandingMechanicalEntries, shiftSlot } from './mechanical-handover-flow.ts';

test('combines the selected category and common item into an editable work description', () => {
  assert.equal(mechanicalWorkDetails('冷凍冷藏設備', 'B1F 冷藏主機巡檢、運轉壓力溫度紀錄'), '冷凍冷藏設備 B1F 冷藏主機巡檢、運轉壓力溫度紀錄');
  assert.equal(mechanicalWorkDetails('', '臨時交辦事項'), '臨時交辦事項');
});

test('keeps one work record and appends later selections on new detail lines', () => {
  const first = '冷凍冷藏設備 B1F 冷藏主機巡檢';
  const second = '供配電設備 B2F 配電室巡查';
  assert.equal(appendMechanicalWorkDetails('', '', first), first);
  assert.equal(appendMechanicalWorkDetails(first, first, second), second, 'changing the first selection before Enter replaces its suggestion');
  assert.equal(appendMechanicalWorkDetails(`${first}\n`, first, second), `${first}\n${second}`, 'Enter preserves the first line and appends the next item');
  assert.equal(appendMechanicalWorkDetails(`${first}\n人工補充`, first, second), `${first}\n人工補充\n${second}`);
});

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
