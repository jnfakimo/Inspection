import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMechanicalPrintFit } from './mechanical-print-fit.ts';

test('short reports stay at natural size', () => {
  assert.deepEqual(calculateMechanicalPrintFit(1200, 900), { mode: 'fit', scale: 1 });
});

test('single-page reports scale down only to the 0.82 floor', () => {
  assert.deepEqual(calculateMechanicalPrintFit(900, 1000), { mode: 'fit', scale: 0.9 });
  assert.deepEqual(calculateMechanicalPrintFit(820, 1000), { mode: 'fit', scale: 0.82 });
});

test('reports below the readability floor switch to multi-page at natural size', () => {
  assert.deepEqual(calculateMechanicalPrintFit(819, 1000), { mode: 'multipage', scale: 1 });
  assert.deepEqual(calculateMechanicalPrintFit(100, 5000), { mode: 'multipage', scale: 1 });
});

test('missing or invalid measurements preserve the natural-size fallback', () => {
  assert.deepEqual(calculateMechanicalPrintFit(0, 900), { mode: 'fit', scale: 1 });
  assert.deepEqual(calculateMechanicalPrintFit(900, 0), { mode: 'fit', scale: 1 });
  assert.deepEqual(calculateMechanicalPrintFit(Number.NaN, 900), { mode: 'fit', scale: 1 });
});
