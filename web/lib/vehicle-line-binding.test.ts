import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestSequence } from './request-sequence.ts';
import {
  createVehicleLineActionLock,
  readVehicleLineBinding,
  startVehicleLineLink,
  unlinkVehicleLine,
  unlinkVehicleLineAfterConfirmation,
  vehicleLineUnavailableKind,
  type VehicleLineApi,
} from './vehicle-line-binding.ts';

const code = `LINK-${'A'.repeat(32)}`;
const expiry = '2026-10-08T10:00:00.000Z';

test('binding status returns only the current user state and never exposes a LINE ID', async () => {
  const calls: string[] = [];
  const api: VehicleLineApi = async (action) => {
    calls.push(action);
    return { linked: true, linked_at: '2026-10-08T09:00:00+00:00', pending_expires_at: expiry, line_user_id: 'U' + 'a'.repeat(32) };
  };
  assert.deepEqual(await readVehicleLineBinding(api), {
    linked: true, linked_at: '2026-10-08T09:00:00.000Z', pending_expires_at: null,
  });
  assert.deepEqual(calls, ['vehicle_line_link_status']);
});

test('starting a LINE link requires consent and sends no user supplied identity', async () => {
  const calls: Array<{ action: string; payload?: Record<string, unknown> }> = [];
  const api: VehicleLineApi = async (action, payload) => {
    calls.push({ action, payload });
    return { code, expires_at: expiry };
  };
  await assert.rejects(() => startVehicleLineLink(api, false), /line-consent-required/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await startVehicleLineLink(api, true), { code, expires_at: expiry });
  assert.deepEqual(calls, [{ action: 'vehicle_line_link_start', payload: { consent: true } }]);
});

test('unlink uses the signed-in account only and reports no-op honestly', async () => {
  const calls: Array<{ action: string; payload?: Record<string, unknown> }> = [];
  const api: VehicleLineApi = async (action, payload) => {
    calls.push({ action, payload });
    return { unlinked: false };
  };
  assert.equal(await unlinkVehicleLine(api), false);
  assert.deepEqual(calls, [{ action: 'vehicle_line_unlink', payload: undefined }]);
});

test('repeated clicks share one in-flight binding action', async () => {
  const lock = createVehicleLineActionLock();
  let calls = 0;
  let resolveRequest!: () => void;
  const request = new Promise<void>(resolve => { resolveRequest = resolve; });
  const run = async () => {
    const lease = lock.acquire();
    if (!lease) return false;
    calls += 1;
    try { await request; return true; }
    finally { lock.release(lease); }
  };

  const first = run();
  const second = run();
  assert.equal(calls, 1);
  assert.equal(await second, false);
  resolveRequest();
  assert.equal(await first, true);
  assert.notEqual(lock.acquire(), null);
});

test('canceling unlink confirmation makes no API request', async () => {
  let calls = 0;
  const api: VehicleLineApi = async () => { calls += 1; return { unlinked: true }; };
  const result = await unlinkVehicleLineAfterConfirmation(api, () => false);
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('out-of-order status responses cannot replace the latest binding state', async () => {
  const requests = createRequestSequence();
  let resolveOld!: (value: unknown) => void;
  let displayed: boolean | undefined;
  const old = new Promise<unknown>(resolve => { resolveOld = resolve; });
  const oldRequest = requests.begin();
  const oldCompletion = readVehicleLineBinding(async () => old).then(snapshot => {
    if (requests.isCurrent(oldRequest)) displayed = snapshot.linked;
  });

  const latestRequest = requests.begin();
  const latest = await readVehicleLineBinding(async () => ({ linked: true, linked_at: '2026-10-08T09:00:00Z' }));
  if (requests.isCurrent(latestRequest)) displayed = latest.linked;
  resolveOld({ linked: false });
  await oldCompletion;

  assert.equal(displayed, true);
});

test('missing schema is reported distinctly from inactive driver and other service errors', () => {
  assert.equal(vehicleLineUnavailableKind(new Error('LINE 綁定服務尚未就緒，請稍後再試。')), 'schema');
  assert.equal(vehicleLineUnavailableKind(new Error('目前不符合駕駛名冊資格')), 'driver');
  assert.equal(vehicleLineUnavailableKind(new Error('目前已綁定 LINE')), 'linked');
  assert.equal(vehicleLineUnavailableKind(new Error('網路中斷')), 'generic');
});

// 以 supabase/functions/app-api/handlers/vehicle.ts 實際回傳的訊息驗證，避免規則與伺服器文字脫節。
test('classifies the exact app-api messages', async () => {
  const { readFile } = await import('node:fs/promises');
  const handler = await readFile(new URL('../../supabase/functions/app-api/handlers/vehicle.ts', import.meta.url), 'utf8');
  const cases: Array<[string, ReturnType<typeof vehicleLineUnavailableKind>]> = [
    ['LINE 綁定服務尚未就緒，請稍後再試。', 'schema'],
    ['此帳號尚未列入有效駕駛名單。', 'driver'],
    ['此帳號目前不符合駕駛綁定資格。', 'driver'],
    ['此帳號已綁定 LINE；請先解除綁定，再開始新的綁定。', 'linked'],
  ];
  for (const [message, kind] of cases) {
    assert.ok(handler.includes(message), `伺服器已不再回傳「${message}」，請同步更新分類規則與此測試`);
    assert.equal(vehicleLineUnavailableKind(new Error(message)), kind, message);
  }
});

test('rejects a link code that does not match the server format', async () => {
  const api: VehicleLineApi = async () => ({ code: 'LINK-short', expires_at: expiry });
  await assert.rejects(() => startVehicleLineLink(api, true), /line-link-intent-invalid/);
});
