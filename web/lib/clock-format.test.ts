import assert from 'node:assert/strict';
import test from 'node:test';
import { dateTimeTo12, formatClock12, hhmmTo12 } from './clock-format.ts';

test('上下午 12 小時制：午夜、上午、正午、下午的轉換', () => {
  assert.equal(hhmmTo12('00:00'), '上午 12:00');
  assert.equal(hhmmTo12('00:30'), '上午 12:30');
  assert.equal(hhmmTo12('09:30'), '上午 9:30');
  assert.equal(hhmmTo12('11:59'), '上午 11:59');
  assert.equal(hhmmTo12('12:00'), '下午 12:00');
  assert.equal(hhmmTo12('12:30'), '下午 12:30');
  assert.equal(hhmmTo12('13:00'), '下午 1:00');
  assert.equal(hhmmTo12('23:30'), '下午 11:30');
});

test('資料庫 time 欄位的 HH:mm:ss 也能轉換，秒數保留', () => {
  assert.equal(hhmmTo12('15:00:00'), '下午 3:00:00');
  assert.equal(formatClock12(10, '5'), '上午 10:05');
});

test('日期時間字串只轉時間部分，日期不動', () => {
  assert.equal(dateTimeTo12('2026-10-28 10:11:41'), '2026-10-28 上午 10:11:41');
  assert.equal(dateTimeTo12('2026-10-28 14:05'), '2026-10-28 下午 2:05');
  assert.equal(dateTimeTo12('2026-10-28T00:15'), '2026-10-28 上午 12:15');
});

test('格式不符與空值原樣回傳，不丟例外', () => {
  assert.equal(hhmmTo12('—'), '—');
  assert.equal(hhmmTo12(''), '');
  assert.equal(dateTimeTo12('—'), '—');
});
