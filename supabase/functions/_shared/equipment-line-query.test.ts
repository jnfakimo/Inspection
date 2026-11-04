import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentLineAccess, replyEquipmentLineQuery } from './equipment-line-query.ts';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeDb(tables: Tables, failTable?: string) {
  const reads: string[] = [];
  return {
    reads,
    async rpc(name: string) {
      assert.equal(name, 'enforce_request_rate_limit');
      return { data: tables.__rate_limited__ ? false : true, error: null };
    },
    from(table: string) {
      reads.push(table);
      const filters: Array<[string, unknown]> = [];
      const setFilters: Array<[string, unknown[]]> = [];
      let count = Infinity;
      const result = () => {
        if (table === failTable) return { data: null, error: new Error('read failed') };
        const rows = (tables[table] || []).filter(row => filters.every(([field, value]) => row[field] === value)
          && setFilters.every(([field, values]) => values.includes(row[field])));
        return { data: rows.slice(0, count), error: null };
      };
      const query = {
        select() { return query; },
        eq(field: string, value: unknown) { filters.push([field, value]); return query; },
        in(field: string, values: unknown[]) { setFilters.push([field, values]); return query; },
        order() { return query; },
        limit(value: number) { count = value; return query; },
        async maybeSingle() {
          const found = result();
          return { data: found.data?.[0] || null, error: found.error };
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
  };
}

const userId = 'user-1';
const lineUserId = `U${'a'.repeat(32)}`;
const now = new Date('2026-11-04T08:00:00Z');
const base: Tables = {
  inspection_line_bindings: [{ user_id: userId, line_user_id: lineUserId, state: 'linked' }],
  users: [{ user_id: userId, status: 'active', role: 'inspector', rbac_role: 'reporter' }],
  role_permissions: [{ role_id: 'reporter', perm: 'sys_equipment', allowed: true }],
  user_system_access: [],
  user_module_access: [],
  role_module_access: [],
  equipment: [{ equipment_id: 'eq-1', asset_code: 'REF-B1-001', qr_code: 'QR-1',
    name: '冷藏設備', status: 'active', floor: 'B1', location: '機房' }],
  equipment_monitor_points: [{ equipment_id: 'eq-1', point_name: '溫度', last_value: 3.2,
    unit: '°C', last_quality: 'good', last_seen_at: '2026-11-04T07:59:00Z',
    sampling_seconds: 60, status: 'active' }],
  equipment_monitor_events: [{ equipment_id: 'eq-1', title: '溫度偏高', severity: 'warning',
    occurred_at: '2026-11-04T07:58:00Z', event_state: 'open' }],
  repair_requests: [{ equipment_id: 'eq-1', req_no: 'WO-1028', fault_desc: '壓縮機異音',
    status: 'pending', created_at: '2026-11-04T07:00:00Z' }],
};

function copy(rows: Tables): Tables {
  return structuredClone(rows);
}

async function query(tables: Tables, failTable?: string) {
  const db = fakeDb(tables, failTable);
  let message: Record<string, unknown> = {};
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    message = JSON.parse(String(init?.body)).messages[0];
    return new Response(null, { status: 200 });
  };
  await replyEquipmentLineQuery({ db, lineUserId, code: 'REF-B1-001',
    replyToken: 'reply', token: 'token', now, fetcher });
  return { db, message };
}

test('unbound and deactivated accounts disclose no equipment data', async () => {
  const unbound = copy(base); unbound.inspection_line_bindings = [];
  const first = await query(unbound);
  assert.equal(first.message?.type, 'text');
  assert.equal(first.db.reads.includes('equipment'), false);

  const inactive = copy(base); inactive.users[0].status = 'inactive';
  const second = await query(inactive);
  assert.equal(second.message?.type, 'text');
  assert.equal(second.db.reads.includes('equipment'), false);
});

test('current module deny overrides system grant', async () => {
  const rows = copy(base);
  rows.user_module_access.push({ user_id: userId, system_key: 'equipment', module_key: 'assets', mode: 'deny' });
  const result = await query(rows);
  assert.equal(result.message?.type, 'text');
  assert.equal(result.db.reads.includes('equipment'), false);
});

test('system deny and role-template module deny both stop equipment lookup', async () => {
  const systemRows = copy(base);
  systemRows.user_system_access.push({ user_id: userId, system_key: 'equipment', mode: 'deny' });
  const system = await query(systemRows);
  assert.equal(system.message?.type, 'text');
  assert.equal(system.db.reads.includes('equipment'), false);

  const roleRows = copy(base);
  roleRows.role_module_access.push({ role_id: 'reporter', system_key: 'equipment', module_key: 'assets', mode: 'deny' });
  const module = await query(roleRows);
  assert.equal(module.message?.type, 'text');
  assert.equal(module.db.reads.includes('equipment'), false);
});

test('equipment-only access hides monitor and repair data', async () => {
  const rows = copy(base);
  rows.user_module_access.push({ user_id: userId, system_key: 'equipment', module_key: 'monitoring', mode: 'deny' });
  const result = await query(rows);
  assert.equal(result.message?.type, 'flex');
  const body = JSON.stringify(result.message);
  assert.match(body, /無監測資料查閱權限/);
  assert.match(body, /無報修查閱權限/);
  assert.equal(result.db.reads.includes('equipment_monitor_points'), false);
  assert.equal(result.db.reads.includes('equipment_monitor_events'), false);
  assert.equal(result.db.reads.includes('repair_requests'), false);
});

test('authorized user receives actual monitor and repair values in Flex reply', async () => {
  const rows = copy(base);
  rows.role_permissions.push({ role_id: 'reporter', perm: 'sys_workorder', allowed: true });
  rows.user_module_access.push({ user_id: userId, system_key: 'equipment', module_key: 'monitoring', mode: 'allow' });
  const result = await query(rows);
  const body = JSON.stringify(result.message);
  assert.match(body, /3\.2 °C/);
  assert.match(body, /WO-1028/);
  assert.match(body, /溫度偏高/);
  assert.match(body, /REF-B1-001/);
  assert.match(body, /https:\/\/jnfakimo\.github\.io/);
});

test('permission lookup failure fails closed', async () => {
  const db = fakeDb(copy(base), 'role_module_access');
  await assert.rejects(() => equipmentLineAccess(db, userId));
  assert.equal(db.reads.includes('equipment'), false);
});

test('rate limit stops queries before equipment and permission reads', async () => {
  const rows = copy(base);
  rows.__rate_limited__ = [{}];
  const result = await query(rows);
  assert.equal(result.message?.type, 'text');
  assert.equal(result.db.reads.includes('equipment'), false);
  assert.equal(result.db.reads.includes('role_permissions'), false);
});
