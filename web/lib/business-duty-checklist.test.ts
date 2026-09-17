import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDutyChecklist, serializeDutyChecklist, DEFAULT_BUSINESS_DUTY_CHECKLIST, type DutyItem } from './business-duty-checklist.ts';

const defaults: DutyItem[] = [{ id: 'duty-1', timeSlot: '01-09', timeSlotLabel: '01:00 ～ 09:00', shiftGroup: '01-09', title: '既有點檢' }];

test('舊版點檢結果仍可讀取且不改寫原項目', () => {
  const data = parseDutyChecklist({ 'duty-1': { status: 'completed' } }, defaults);
  assert.equal(data.items[0].title, '既有點檢');
  assert.equal(data.checks['duty-1'].status, 'completed');
});

test('每日新增與軟刪除項目往返保留稽核資訊', () => {
  const custom: DutyItem = { id: 'custom-123', timeSlot: '01-09', timeSlotLabel: '01:00 ～ 09:00', shiftGroup: '01-09', title: '新增點檢', createdAt: '2026-09-17T01:00:00Z', createdBy: '甲' };
  const data = {
    items: [{ ...defaults[0], deletedAt: '2026-09-17T02:00:00Z', deletedBy: '乙' }, custom],
    checks: { 'custom-123': { status: 'completed' as const, updatedAt: '2026-09-17T03:00:00Z', updatedBy: '甲' } },
  };
  const restored = parseDutyChecklist(JSON.parse(serializeDutyChecklist(data, defaults)), defaults);
  assert.equal(restored.items[0].deletedBy, '乙');
  assert.equal(restored.items[1].title, '新增點檢');
  assert.equal(restored.checks['custom-123'].status, 'completed');
});

test('完整 27 項預設清單正確載入', () => {
  assert.equal(DEFAULT_BUSINESS_DUTY_CHECKLIST.length, 27);
  const data = parseDutyChecklist({});
  assert.equal(data.items.length, 27);
  assert.equal(data.items[0].timeSlot, '00-08');
});

test('修改項目文字與排序在序列化與反序列化後完整保留', () => {
  const modified = DEFAULT_BUSINESS_DUTY_CHECKLIST.map((item, idx) => idx === 0 ? { ...item, title: '修改後的第一項點檢內容' } : item);
  // swap 0 and 1
  const swapped = [modified[1], modified[0], ...modified.slice(2)];
  const serialized = serializeDutyChecklist({ items: swapped, checks: { [swapped[0].id]: { status: 'completed' } } });
  const restored = parseDutyChecklist(JSON.parse(serialized));
  assert.equal(restored.items[0].id, swapped[0].id);
  assert.equal(restored.items[1].title, '修改後的第一項點檢內容');
  assert.equal(restored.checks[swapped[0].id]?.status, 'completed');
});

