import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRepairCost, repairCostCents, repairCostTotal } from './mechanical-cost.ts';

test('維修費用能區分未填與零元', () => {
  assert.equal(repairCostCents(null), null);
  assert.equal(repairCostCents(''), null);
  assert.equal(repairCostCents('0'), 0);
  assert.equal(formatRepairCost(0), 'NT$ 0');
});

test('維修費用只接受非負且最多兩位小數', () => {
  assert.equal(repairCostCents('12.34'), 1234);
  assert.equal(repairCostCents('999999999.99'), 99_999_999_999);
  assert.equal(repairCostCents('-1'), undefined);
  assert.equal(repairCostCents('1.234'), undefined);
  assert.equal(repairCostCents('1000000000'), undefined);
});

test('日合計使用整數分避免浮點誤差', () => {
  assert.equal(repairCostTotal([{ repair_cost: '0.1' }, { repair_cost: '0.2' }, { repair_cost: null }]), 30);
  assert.equal(formatRepairCost(30), 'NT$ 0.30');
});
