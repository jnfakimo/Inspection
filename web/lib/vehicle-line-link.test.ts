import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRemaining, vehicleLineLinkView } from './vehicle-line-link.ts';

const NOW = Date.parse('2026-10-16T02:00:00Z');

test('狀態尚未讀到時顯示讀取中', () => {
  assert.equal(vehicleLineLinkView(null, null, NOW).state, 'loading');
});

test('已綁定時顯示臺北時間的綁定時間', () => {
  const view = vehicleLineLinkView({ linked: true, linked_at: '2026-10-16T01:30:00Z', pending_expires_at: null }, null, NOW);
  assert.equal(view.state, 'linked');
  assert.match(view.detail, /2026\/10\/16 09:30/);
});

test('剛產生的代碼在效期內顯示倒數', () => {
  const view = vehicleLineLinkView(
    { linked: false, linked_at: null, pending_expires_at: '2026-10-16T02:10:00Z' },
    { value: 'LINK-abc', expiresAt: '2026-10-16T02:10:00Z' },
    NOW,
  );
  assert.equal(view.state, 'pending');
  assert.equal(view.remaining, '10 分 00 秒');
});

test('代碼過期後要求重新產生', () => {
  const view = vehicleLineLinkView(
    { linked: false, linked_at: null, pending_expires_at: null },
    { value: 'LINK-abc', expiresAt: '2026-10-16T01:59:59Z' },
    NOW,
  );
  assert.equal(view.state, 'expired');
});

test('重新整理後伺服器仍有等待中的綁定，但代碼不再顯示', () => {
  const view = vehicleLineLinkView({ linked: false, linked_at: null, pending_expires_at: '2026-10-16T02:05:00Z' }, null, NOW);
  assert.equal(view.state, 'expired');
  assert.match(view.detail, /不會重複顯示/);
});

test('沒有綁定也沒有等待中的代碼時顯示尚未綁定', () => {
  assert.equal(vehicleLineLinkView({ linked: false, linked_at: null, pending_expires_at: null }, null, NOW).state, 'unlinked');
});

test('倒數格式', () => {
  assert.equal(formatRemaining(59_100), '1 分 00 秒');
  assert.equal(formatRemaining(9_000), '9 秒');
  assert.equal(formatRemaining(-5), '0 秒');
});
