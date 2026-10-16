import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeVehicleLinePersonalAdminAction,
  VEHICLE_LINE_PERSONAL_ACTIONS,
  VEHICLE_LINE_TEST_MESSAGE,
  VEHICLE_LINE_TEST_RECIPIENT_USERNAME,
  type VehicleLinePersonalAdminDependencies,
} from './vehicle-line-personal.ts';

const actorId = '11111111-1111-4111-8111-111111111111';
const recipientId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';

function dependencies(overrides: Partial<VehicleLinePersonalAdminDependencies> = {}) {
  const calls: Record<string, unknown[]> = {
    reads: [], resolves: [], recipientReads: [], saves: [], created: [], worker: [], audits: [],
  };
  const value: VehicleLinePersonalAdminDependencies = {
    isAdmin: true,
    actorId,
    readPreferences: async () => {
      calls.reads.push(true);
      return { personal_enabled: false, assignment_enabled: false, assignment_revoked_enabled: false, test_enabled: false, test_recipient_user_id: recipientId };
    },
    resolveTestRecipient: async () => {
      calls.resolves.push(true);
      return { userId: recipientId, username: VEHICLE_LINE_TEST_RECIPIENT_USERNAME, name: '測試駕駛' };
    },
    readTestRecipient: async (userId) => {
      calls.recipientReads.push(userId);
      return { username: VEHICLE_LINE_TEST_RECIPIENT_USERNAME, name: '測試駕駛', active: true, driver_active: true, linked: true };
    },
    savePreferences: async (input) => { calls.saves.push(input); },
    createTestRun: async (id) => { calls.created.push(id); return runId; },
    runTestWorker: async (id) => { calls.worker.push(id); return true; },
    audit: async (id, changes) => { calls.audits.push({ id, changes }); },
    ...overrides,
  };
  return { value, calls };
}

const response = (value: Awaited<ReturnType<typeof executeVehicleLinePersonalAdminAction>>) =>
  value as { status: number; body: Record<string, any> };

test('only the three dedicated personal notification admin actions are routed', () => {
  assert.deepEqual([...VEHICLE_LINE_PERSONAL_ACTIONS].sort(), [
    'admin_get_vehicle_line_personal_settings',
    'admin_save_vehicle_line_personal_settings',
    'admin_test_vehicle_line_personal_notification',
  ]);
});

test('unauthorized callers cannot read, change, or test personal preferences', async () => {
  for (const action of VEHICLE_LINE_PERSONAL_ACTIONS) {
    const { value, calls } = dependencies({ isAdmin: false });
    const result = response(await executeVehicleLinePersonalAdminAction(action, { action }, value));
    assert.equal(result.status, 403);
    assert.equal(calls.reads.length + calls.resolves.length + calls.saves.length + calls.created.length, 0);
  }
});

test('read returns server-owned preferences and a verified recipient summary without LINE identity', async () => {
  const { value, calls } = dependencies();
  const result = response(await executeVehicleLinePersonalAdminAction('admin_get_vehicle_line_personal_settings', {
    action: 'admin_get_vehicle_line_personal_settings',
  }, value));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, {
    personal_enabled: false,
    assignment_enabled: false,
    assignment_revoked_enabled: false,
    test_enabled: false,
    test_recipient: {
      username: VEHICLE_LINE_TEST_RECIPIENT_USERNAME,
      name: '測試駕駛', active: true, driver_active: true, linked: true, ready: true,
    },
  });
  assert.equal(JSON.stringify(result.body).includes('line_user_id'), false);
  assert.deepEqual(calls.recipientReads, [recipientId]);
});

test('read resolves the verified 022443 recipient when no recipient ID has been configured yet', async () => {
  const { value, calls } = dependencies({ readPreferences: async () => null });
  const result = response(await executeVehicleLinePersonalAdminAction('admin_get_vehicle_line_personal_settings', {
    action: 'admin_get_vehicle_line_personal_settings',
  }, value));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, {
    personal_enabled: false,
    assignment_enabled: false,
    assignment_revoked_enabled: false,
    test_enabled: false,
    test_recipient: {
      username: VEHICLE_LINE_TEST_RECIPIENT_USERNAME,
      name: '測試駕駛', active: true, driver_active: true, linked: true, ready: true,
    },
  });
  assert.deepEqual(calls.resolves, [true]);
  assert.deepEqual(calls.recipientReads, [recipientId]);
  assert.equal(calls.saves.length, 0);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.worker.length, 0);
});

test('read keeps the binding requirement in the recipient readiness result', async () => {
  const { value } = dependencies({
    readPreferences: async () => null,
    readTestRecipient: async () => ({
      username: VEHICLE_LINE_TEST_RECIPIENT_USERNAME,
      name: '測試駕駛',
      active: true,
      driver_active: true,
      linked: false,
    }),
  });
  const result = response(await executeVehicleLinePersonalAdminAction('admin_get_vehicle_line_personal_settings', {
    action: 'admin_get_vehicle_line_personal_settings',
  }, value));

  assert.equal(result.status, 200);
  assert.equal(result.body.data.test_recipient.linked, false);
  assert.equal(result.body.data.test_recipient.ready, false);
  assert.equal(result.body.data.test_enabled, false);
});

test('read does not normalize away the leading zero in the verified username', async () => {
  const { value, calls } = dependencies({
    readPreferences: async () => null,
    resolveTestRecipient: async () => ({ userId: recipientId, username: '22443', name: '測試駕駛' }),
  });
  const result = response(await executeVehicleLinePersonalAdminAction('admin_get_vehicle_line_personal_settings', {
    action: 'admin_get_vehicle_line_personal_settings',
  }, value));

  assert.equal(result.status, 200);
  assert.equal(result.body.data.test_recipient, null);
  assert.deepEqual(calls.recipientReads, []);
});

test('save resolves the only test profile on the server and never trusts a caller-supplied recipient', async () => {
  const { value, calls } = dependencies();
  const body = {
    action: 'admin_save_vehicle_line_personal_settings',
    personal_enabled: true,
    assignment_enabled: true,
    assignment_revoked_enabled: false,
    test_enabled: true,
    test_recipient_user_id: '99999999-9999-4999-8999-999999999999',
  };
  const rejected = response(await executeVehicleLinePersonalAdminAction(body.action, body, value));
  assert.equal(rejected.status, 400);
  assert.equal(calls.saves.length, 0);

  const safeBody = { ...body };
  delete (safeBody as Record<string, unknown>).test_recipient_user_id;
  const saved = response(await executeVehicleLinePersonalAdminAction(body.action, safeBody, value));
  assert.equal(saved.status, 200);
  assert.deepEqual(calls.saves[0], {
    personal_enabled: true,
    assignment_enabled: true,
    assignment_revoked_enabled: false,
    test_enabled: true,
    test_recipient_user_id: recipientId,
    updatedBy: actorId,
  });
  assert.deepEqual(calls.resolves, [true]);
});

test('test mode requires the verified 022443 profile and does not accept a target or message', async () => {
  let recipientFound = false;
  const { value, calls } = dependencies({ resolveTestRecipient: async () => {
    recipientFound = true;
    return null;
  } });
  const body = {
    action: 'admin_save_vehicle_line_personal_settings',
    personal_enabled: true, assignment_enabled: true, assignment_revoked_enabled: true, test_enabled: true,
  };
  const save = response(await executeVehicleLinePersonalAdminAction(body.action, body, value));
  assert.equal(save.status, 400);
  assert.equal(recipientFound, true);
  assert.equal(calls.saves.length, 0);

  const testAction = 'admin_test_vehicle_line_personal_notification';
  const forged = response(await executeVehicleLinePersonalAdminAction(testAction, {
    action: testAction, recipient_user_id: recipientId, text: VEHICLE_LINE_TEST_MESSAGE,
  }, value));
  assert.equal(forged.status, 400);
  assert.equal(calls.created.length, 0);
  assert.equal(calls.worker.length, 0);
});

test('personal test creates one server-side synthetic run and calls worker only with its id', async () => {
  const { value, calls } = dependencies();
  const action = 'admin_test_vehicle_line_personal_notification';
  const result = response(await executeVehicleLinePersonalAdminAction(action, { action }, value));
  assert.equal(result.status, 200);
  assert.deepEqual(calls.created, [actorId]);
  assert.deepEqual(calls.worker, [runId]);
  assert.equal(calls.audits.length, 1);
  assert.equal(JSON.stringify(calls).includes('recipient_user_id'), false);
});
