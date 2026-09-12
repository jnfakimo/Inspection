import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTaipeiCheckinAt, patrolCheckinConfirmation } from './patrol-checkin.ts';

test('打卡時間固定顯示為臺北時區到秒', () => {
  assert.equal(formatTaipeiCheckinAt('2026-09-12T08:58:07.000Z'), '2026-09-12 16:58:07');
  assert.equal(formatTaipeiCheckinAt('2026-09-12T08:58:07.000Z', false), '16:58:07');
});

test('五分鐘內重複掃描顯示原打卡時間，不誤報打卡失敗', () => {
  assert.equal(
    patrolCheckinConfirmation('機車出入口巡邏點', {
      duplicate: true,
      event: { checkin_at: '2026-09-12T08:58:07.000Z' },
    }),
    '「機車出入口巡邏點」已於 2026-09-12 16:58:07 完成打卡，本次未重複建立紀錄',
  );
});
