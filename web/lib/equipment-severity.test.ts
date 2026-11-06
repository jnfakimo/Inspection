import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentSeverity } from './equipment-severity.ts';

test('known alert levels retain existing Chinese labels and status tones', () => {
  assert.deepEqual(equipmentSeverity('info'), { label: '一般', tone: 'pending' });
  assert.deepEqual(equipmentSeverity('warning'), { label: '警告', tone: 'in-progress' });
  assert.deepEqual(equipmentSeverity('critical'), { label: '嚴重', tone: 'cancelled' });
});

test('missing, malformed and future levels get a neutral Chinese fallback', () => {
  for (const value of [undefined, null, '', ' ', 'WARNING', 'future-severity', 0, 1, false, true, {}, [], ['warning']]) {
    assert.deepEqual(equipmentSeverity(value), { label: '未知', tone: 'pending' });
  }
});

test('prototype property names cannot become React children or CSS classes', () => {
  for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.deepEqual(equipmentSeverity(value), { label: '未知', tone: 'pending' });
  }
});

test('normalization does not coerce or mutate event values', () => {
  const value = Object.freeze({ toString() { throw new Error('must not coerce'); } });
  assert.equal(equipmentSeverity(value).label, '未知');
  const event = Object.freeze({ severity: 'future-severity' });
  equipmentSeverity(event.severity);
  assert.equal(event.severity, 'future-severity');
});
