import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEquipmentLineAction } from './equipment-line.ts';

function context(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; value: unknown }> = [];
  const admin = {
    async rpc(name: string, args: unknown) {
      calls.push({ method: name, value: args });
      if (name === 'create_inspection_line_link') {
        return { data: [{ outcome: 'created', expires_at: '2026-11-04T08:10:00Z' }], error: null };
      }
      return { data: true, error: null };
    },
    from(table: string) {
      calls.push({ method: 'from', value: table });
      return {
        select(columns: string) {
          calls.push({ method: 'select', value: columns });
          return this;
        },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() {
          return { data: table === 'inspection_line_bindings'
            ? { state: 'linked', linked_at: '2026-11-04T08:00:00Z' } : null, error: null };
        },
      };
    },
  };
  const userDb = {
    from(table: string) {
      assert.equal(table, 'audit_logs');
      return { async insert(value: unknown) { calls.push({ method: 'audit', value }); return { error: null }; } };
    },
  };
  const ctx = {
    req: new Request('https://example.test/app-api'),
    body: { consent: true },
    profile: { user_id: 'user-1' },
    admin, userDb,
    reply: (_req: Request, body: unknown, status = 200) => Response.json(body, { status }),
    canModule: () => true,
    ...overrides,
  };
  return { ctx, calls };
}

test('link start requires equipment permission and explicit consent', async () => {
  const denied = context({ canModule: () => false });
  assert.equal((await handleEquipmentLineAction('equipment_line_link_start', denied.ctx as never))?.status, 403);
  assert.equal(denied.calls.length, 0);
  const absent = context({ body: { consent: false } });
  assert.equal((await handleEquipmentLineAction('equipment_line_link_start', absent.ctx as never))?.status, 400);
  assert.equal(absent.calls.length, 0);
});

test('authenticated link start stores only hash and returns one-time code to its caller', async () => {
  const { ctx, calls } = context();
  const response = await handleEquipmentLineAction('equipment_line_link_start', ctx as never);
  assert.equal(response?.status, 200);
  const data = await response?.json();
  assert.match(data.data.code, /^LINK-[A-Za-z0-9_-]{32}$/);
  const rpc = calls.find(call => call.method === 'create_inspection_line_link')?.value as Record<string, unknown>;
  assert.match(String(rpc.p_code_hash), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls).includes(data.data.code), false);
});

test('status and unlink never return the raw LINE identity', async () => {
  const { ctx, calls } = context();
  const status = await handleEquipmentLineAction('equipment_line_link_status', ctx as never);
  assert.deepEqual((await status?.json()).data, {
    linked: true, linked_at: '2026-11-04T08:00:00Z', pending_expires_at: null,
  });
  assert.equal(calls.some(call => String(call.value).includes('line_user_id')), false);
  const unlink = await handleEquipmentLineAction('equipment_line_unlink', ctx as never);
  assert.deepEqual((await unlink?.json()).data, { unlinked: true });
  assert.ok(calls.some(call => call.method === 'unlink_inspection_line'));
});

test('only a user with assets and monitoring access can subscribe', async () => {
  const denied = context({ canModule: (_system: string, module: string) => module !== 'monitoring' });
  const result = await handleEquipmentLineAction('equipment_line_subscribe', denied.ctx as never);
  assert.equal(result?.status, 403);
  assert.equal(denied.calls.length, 0);
});

test('subscription resolves one exact equipment code and records own user ID', async () => {
  const { ctx, calls } = context();
  const equipmentId = '123e4567-e89b-42d3-a456-426614174000';
  const admin = {
    from(table: string) {
      calls.push({ method: 'from', value: table });
      let code = '';
      return {
        select() { return this; },
        eq(column: string, value: string) {
          if (column === 'asset_code' || column === 'qr_code') code = value;
          return this;
        },
        async limit() {
          assert.equal(code, 'EQ-001');
          return { data: [{ equipment_id: equipmentId, status: 'active' }], error: null };
        },
      };
    },
    async rpc(name: string, args: unknown) {
      calls.push({ method: name, value: args });
      return { data: 'subscribed', error: null };
    },
  };
  const response = await handleEquipmentLineAction('equipment_line_subscribe',
    { ...ctx, admin, body: { code: 'EQ-001' } } as never);
  assert.equal(response?.status, 200);
  assert.deepEqual(calls.find(call => call.method === 'subscribe_inspection_line_equipment')?.value,
    { p_user_id: 'user-1', p_equipment_id: equipmentId });
  assert.ok(calls.some(call => call.method === 'audit'));
});

test('unsubscribe stays available after monitoring permission is withdrawn', async () => {
  const { ctx, calls } = context({
    body: { equipment_id: '123e4567-e89b-42d3-a456-426614174000' },
    canModule: () => false,
  });
  const response = await handleEquipmentLineAction('equipment_line_unsubscribe', ctx as never);
  assert.equal(response?.status, 200);
  assert.ok(calls.some(call => call.method === 'unsubscribe_inspection_line_equipment'));
});

test('revoked user can list own subscription IDs to cancel without reading equipment details', async () => {
  const { ctx, calls } = context({ canModule: () => false });
  const equipmentId = '123e4567-e89b-42d3-a456-426614174000';
  const admin = { from(table: string) {
    calls.push({ method: 'from', value: table });
    assert.equal(table, 'inspection_line_equipment_subscriptions');
    return {
      select() { return this; }, eq() { return this; },
      async limit() { return { data: [{ equipment_id: equipmentId }], error: null }; },
    };
  } };
  const response = await handleEquipmentLineAction('equipment_line_subscriptions',
    { ...ctx, admin } as never);
  assert.equal(response?.status, 200);
  assert.deepEqual((await response?.json()).data, [{
    equipment_id: equipmentId, asset_code: null, qr_code: null, name: '已無查閱權限',
  }]);
  assert.deepEqual(calls.filter(call => call.method === 'from').map(call => call.value),
    ['inspection_line_equipment_subscriptions']);
});
