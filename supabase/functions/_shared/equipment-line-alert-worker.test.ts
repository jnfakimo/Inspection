import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEquipmentLineAlertWorkerHandler, type AlertClaim, type AlertStore,
} from './equipment-line-alert-worker.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';
const lineId = `U${'a'.repeat(32)}`;
const message = '⚠️ 中央巡檢設備異常\n設備：A\n請登入系統查看：https://jnfakimo.github.io/Inspection/v2/systems/equipment/monitoring/';
const instant = new Date('2026-11-04T10:00:00Z');
const claim: AlertClaim = { outbox_id: id, lease_token: id };

function fixture(overrides: Partial<AlertStore> = {}, sendResult = { ok: true, status: 200 }) {
  const calls: Array<{ resolution: string; nextAttemptAt: string | null }> = [];
  const store: AlertStore = {
    async loadToken() { return 'test-token'; },
    async claim() { return [claim]; },
    async prepare() {
      return { outcome: 'ready', line_user_id: lineId, message_text: message,
        attempts: 1, first_attempt_at: instant.toISOString() };
    },
    async finish(_job, resolution, _status, nextAttemptAt) {
      calls.push({ resolution, nextAttemptAt });
      return resolution === 'retry' ? 'pending' : resolution;
    },
    ...overrides,
  };
  let sends = 0;
  const handler = createEquipmentLineAlertWorkerHandler({
    cronSecret: () => 'cron-secret', createStore: () => store, now: () => instant,
    async sendMessage(input) {
      sends++;
      assert.equal(input.recipient, lineId);
      assert.equal(input.retryKey, id);
      assert.equal(input.text, message);
      return sendResult;
    },
  });
  const request = (secret = 'cron-secret', body = '{}') => new Request('https://example.test/worker', {
    method: 'POST', headers: { 'x-cron-secret': secret }, body,
  });
  return { handler, request, calls, sends: () => sends };
}

test('worker rejects unauthenticated and malformed calls before store access', async () => {
  const f = fixture({ async claim() { throw new Error('must not read'); } });
  assert.equal((await f.handler(f.request('wrong'))).status, 401);
  assert.equal((await f.handler(f.request('cron-secret', '{'))).status, 400);
  assert.equal((await f.handler(f.request('cron-secret', '{"mode":"test"}'))).status, 400);
  assert.equal(f.sends(), 0);
});

test('ready alert sends once with immutable retry key and marks sent', async () => {
  const f = fixture();
  const response = await f.handler(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [{ resolution: 'sent', nextAttemptAt: null }]);
  assert.equal(f.sends(), 1);
});

test('revoked subscription suppresses alert and sends nothing', async () => {
  const f = fixture({ async prepare() { return { outcome: 'suppressed' }; } });
  assert.equal((await f.handler(f.request())).status, 200);
  assert.deepEqual(f.calls, [{ resolution: 'cancelled', nextAttemptAt: null }]);
  assert.equal(f.sends(), 0);
});

test('invalid destination or body is dead lettered without LINE call', async () => {
  const f = fixture({ async prepare() {
    return { outcome: 'ready', line_user_id: 'bad', message_text: message,
      attempts: 1, first_attempt_at: instant.toISOString() };
  } });
  assert.equal((await f.handler(f.request())).status, 200);
  assert.deepEqual(f.calls, [{ resolution: 'dead_letter', nextAttemptAt: null }]);
  assert.equal(f.sends(), 0);
});

test('missing server token fails closed before claiming', async () => {
  let claimed = false;
  const f = fixture({ async loadToken() { return null; }, async claim() { claimed = true; return []; } });
  assert.equal((await f.handler(f.request())).status, 503);
  assert.equal(claimed, false);
});

test('LINE server failure schedules one retry with same outbox identity', async () => {
  const f = fixture({}, { ok: false, status: 503 });
  assert.equal((await f.handler(f.request())).status, 200);
  assert.equal(f.sends(), 1);
  assert.equal(f.calls[0].resolution, 'retry');
  assert.ok(Date.parse(f.calls[0].nextAttemptAt || '') > instant.getTime());
});
