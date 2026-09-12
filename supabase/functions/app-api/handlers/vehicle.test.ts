// handlers/vehicle.ts 的單元測試：以假的資料庫連線與請求內容驗證權限、輸入檢查與寫入流程。
// 拆檔後業務程式不再依賴 index.ts 的閉包，才有辦法這樣單獨測。
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleVehicleAction } from './vehicle.ts';

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Result = { data?: unknown; error?: { message: string } | null };

// 可串接的假 Supabase：每個 from() 記錄呼叫鏈，await 時交給 respond 決定回傳。
function fakeDb(respond: (call: Call) => Result = () => ({ data: null, error: null })) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = new Proxy({}, {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) =>
            Promise.resolve(respond(call)).then(resolve, reject);
        }
        return (...args: unknown[]) => { call.ops.push([prop, args]); return chain; };
      },
    });
    return chain;
  };
  return { from, calls };
}

function context(overrides: Record<string, unknown> = {}) {
  const db = (overrides.userDb as ReturnType<typeof fakeDb>) || fakeDb();
  return {
    db,
    ctx: {
      req: new Request('https://example.test/app-api', { method: 'POST' }),
      body: {},
      profile: { user_id: '11111111-1111-1111-1111-111111111111', name: '測試者', department: '總務課' },
      admin: fakeDb(),
      userDb: db,
      reply: (_req: Request, body: unknown, status = 200) => ({ status, body }) as unknown as Response,
      can: () => true,
      canModule: () => true,
      isAdmin: false,
      isSysadmin: false,
      ...overrides,
    } as never,
  };
}

const response = (value: Response | null) => value as unknown as { status: number; body: Record<string, unknown> };
const validRequest = {
  trip_date: '2099-01-02', planned_departure_time: '09:00', planned_return_time: '11:30',
  origin_location: '第一果菜市場', destination_location: '市政府', trip_purpose: '洽公', passenger_count: 3,
};

test('不屬於公務車的 action 回傳 null，交還 index.ts 繼續分派', async () => {
  const { ctx } = context();
  assert.equal(await handleVehicleAction('workorder_list', ctx), null);
});

test('派車申請：沒有大系統權限時拒絕', async () => {
  const { ctx } = context({ can: () => false, body: validRequest });
  const result = response(await handleVehicleAction('vehicle_create_request', ctx));
  assert.equal(result.status, 403);
});

test('派車申請：沒有子系統權限時拒絕', async () => {
  const { ctx } = context({ canModule: () => false, body: validRequest });
  assert.equal(response(await handleVehicleAction('vehicle_create_request', ctx)).status, 403);
});

test('派車申請：日期、時間、必填與人數驗證', async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ trip_date: '2099-13-40' }, '用車日期'],
    [{ planned_return_time: '08:00' }, '回程晚於出發'],
    [{ destination_location: '' }, '必填'],
    [{ passenger_count: 0 }, '搭乘人數'],
  ];
  for (const [patch, message] of cases) {
    const { ctx, db } = context({ body: { ...validRequest, ...patch } });
    const result = response(await handleVehicleAction('vehicle_create_request', ctx));
    assert.equal(result.status, 400, message);
    assert.match(String(result.body.message), new RegExp(message));
    assert.equal(db.calls.length, 0, '驗證失敗不得寫入資料庫');
  }
});

test('派車申請：成功時寫入申請與稽核紀錄', async () => {
  const db = fakeDb(call => call.table === 'vehicle_dispatch_requests'
    ? { data: { request_id: 'req-1' }, error: null } : { error: null });
  const { ctx } = context({ userDb: db, body: validRequest });
  const result = response(await handleVehicleAction('vehicle_create_request', ctx));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { request_id: 'req-1' });
  const insert = db.calls[0].ops.find(([op]) => op === 'insert')?.[1][0] as Record<string, unknown>;
  assert.equal(insert.applicant_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(insert.status, 'pending_approval');
  assert.ok(db.calls.some(call => call.table === 'audit_logs'), '必須寫入稽核紀錄');
});

test('派車申請：時段重疊回 409，其他資料庫錯誤往外拋', async () => {
  const overlap = fakeDb(() => ({ data: null, error: { message: 'conflicting key value violates exclusion constraint' } }));
  assert.equal(response(await handleVehicleAction('vehicle_create_request', context({ userDb: overlap, body: validRequest }).ctx)).status, 409);
  const broken = fakeDb(() => ({ data: null, error: { message: 'connection reset' } }));
  await assert.rejects(handleVehicleAction('vehicle_create_request', context({ userDb: broken, body: validRequest }).ctx));
});

test('派車名單：非管理者拒絕、名單類型與人員識別碼需有效', async () => {
  assert.equal(response(await handleVehicleAction('vehicle_roster_update', context({ body: { table: 'vehicle_dispatch_drivers' } }).ctx)).status, 403);
  assert.equal(response(await handleVehicleAction('vehicle_roster_update', context({ isAdmin: true, body: { table: 'users' } }).ctx)).status, 400);
  assert.equal(response(await handleVehicleAction('vehicle_roster_update', context({ isAdmin: true, body: { table: 'vehicle_dispatch_drivers', user_id: 'x' } }).ctx)).status, 400);
});

test('派車名單：新增人員時記錄指派者並寫稽核', async () => {
  const db = fakeDb(call => call.ops.some(([op]) => op === 'upsert')
    ? { data: { user_id: '22222222-2222-2222-2222-222222222222' }, error: null }
    : { data: null, error: null });
  const { ctx } = context({ userDb: db, isAdmin: true, body: { table: 'vehicle_dispatch_managers', user_id: '22222222-2222-2222-2222-222222222222', active: true } });
  assert.equal(response(await handleVehicleAction('vehicle_roster_update', ctx)).status, 200);
  const upsert = db.calls.flatMap(call => call.ops).find(([op]) => op === 'upsert')?.[1][0] as Record<string, unknown>;
  assert.equal(upsert.assigned_by, '11111111-1111-1111-1111-111111111111');
  assert.equal(upsert.active, true);
  assert.ok(db.calls.some(call => call.table === 'audit_logs'));
});

test('全部停用名單：沒有啟用中人員時不寫入', async () => {
  const db = fakeDb(() => ({ data: [], error: null }));
  const result = response(await handleVehicleAction('vehicle_roster_remove_all', context({ userDb: db, isAdmin: true, body: { table: 'vehicle_dispatch_drivers' } }).ctx));
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 0);
  assert.equal(db.calls.filter(call => call.ops.some(([op]) => op === 'update')).length, 0);
});

test('車輛主檔：非派車管理者拒絕；座位數無效回 400；新增成功回傳 created', async () => {
  const notManager = fakeDb(() => ({ data: null, error: null }));
  assert.equal(response(await handleVehicleAction('save_official_vehicle', context({ userDb: notManager, body: { plate_no: 'ABC-1234', seats: 5, current_odometer: 10 } }).ctx)).status, 403);
  assert.equal(response(await handleVehicleAction('save_official_vehicle', context({ isAdmin: true, body: { plate_no: 'ABC-1234', seats: 0, current_odometer: 10 } }).ctx)).status, 400);
  const created = fakeDb(() => ({ data: { vehicle_id: 'v-1' }, error: null }));
  const result = response(await handleVehicleAction('save_official_vehicle', context({ userDb: created, isAdmin: true, body: { plate_no: 'ABC-1234', seats: 5, current_odometer: 10 } }).ctx));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { vehicle_id: 'v-1', created: true });
});
