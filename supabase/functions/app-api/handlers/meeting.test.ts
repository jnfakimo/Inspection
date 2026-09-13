// handlers/meeting.ts 的單元測試：以假的資料庫連線驗證會議報到的時段與狀態檢查、會議室主檔維護。
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { handleMeetingAction } from './meeting.ts';

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Result = { data?: unknown; error?: { message: string } | null };

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

const has = (call: Call, op: string) => call.ops.some(([name]) => name === op);

function context(overrides: Record<string, unknown> = {}) {
  return {
    req: new Request('https://example.test/app-api', { method: 'POST' }),
    body: {},
    profile: { user_id: '11111111-1111-1111-1111-111111111111' },
    admin: fakeDb(),
    userDb: fakeDb(),
    reply: (_req: Request, body: unknown, status = 200) => ({ status, body }) as unknown as Response,
    can: () => true,
    canModule: () => true,
    isAdmin: false,
    isSysadmin: false,
    ...overrides,
  } as never;
}

const result = (value: Response | null) => value as unknown as { status: number; body: Record<string, unknown> };
const BOOKING = '22222222-2222-2222-2222-222222222222';
const ROOM = '33333333-3333-3333-3333-333333333333';
// 預約時段 2026-09-14 10:00–12:00（台北時間）
const booking = { booking_id: BOOKING, status: 'booked', booking_date: '2026-09-14', start_time: '10:00:00', end_time: '12:00:00' };

test('不屬於會議室的 action 回傳 null', async () => {
  assert.equal(await handleMeetingAction('vehicle_create_request', context()), null);
});

test('會議報到：權限、識別碼、找不到預約與狀態不可報到', async () => {
  assert.equal(result(await handleMeetingAction('meeting_check_in', context({ can: () => false, body: { booking_id: BOOKING } }))).status, 403);
  assert.equal(result(await handleMeetingAction('meeting_check_in', context({ canModule: () => false, body: { booking_id: BOOKING } }))).status, 403);
  assert.equal(result(await handleMeetingAction('meeting_check_in', context({ body: { booking_id: 'bad' } }))).status, 400);
  const missing = fakeDb(() => ({ data: null, error: null }));
  assert.equal(result(await handleMeetingAction('meeting_check_in', context({ userDb: missing, body: { booking_id: BOOKING } }))).status, 404);
  const cancelled = fakeDb(() => ({ data: { ...booking, status: 'cancelled' }, error: null }));
  assert.equal(result(await handleMeetingAction('meeting_check_in', context({ userDb: cancelled, body: { booking_id: BOOKING } }))).status, 409);
});

test('會議報到：不在會議時段內拒絕，時段內成功並寫稽核', async () => {
  const outside = fakeDb(() => ({ data: booking, error: null }));
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-14T09:30:00+08:00') });
  try {
    const early = result(await handleMeetingAction('meeting_check_in', context({ userDb: outside, body: { booking_id: BOOKING } })));
    assert.equal(early.status, 409);
    assert.match(String(early.body.message), /不在會議時段/);
    assert.equal(outside.calls.filter(call => has(call, 'update')).length, 0, '時段外不得更新');
  } finally {
    mock.timers.reset();
  }

  const db = fakeDb(call => has(call, 'update') ? { data: { booking_id: BOOKING }, error: null }
    : call.table === 'audit_logs' ? { error: null } : { data: booking, error: null });
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-14T10:30:00+08:00') });
  try {
    const ok = result(await handleMeetingAction('meeting_check_in', context({ userDb: db, body: { booking_id: BOOKING } })));
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.data, { booking_id: BOOKING, status: 'checked_in' });
    const update = db.calls.find(call => has(call, 'update'))!;
    assert.ok(update.ops.some(([op, args]) => op === 'eq' && args[0] === 'status' && args[1] === 'booked'), '更新必須帶狀態條件避免重複報到');
    assert.ok(db.calls.some(call => call.table === 'audit_logs'));
  } finally {
    mock.timers.reset();
  }
});

test('會議報到：兩個分頁同時報到時第二次回 409', async () => {
  const raced = fakeDb(call => has(call, 'update') ? { data: null, error: null } : { data: booking, error: null });
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-14T10:30:00+08:00') });
  try {
    assert.equal(result(await handleMeetingAction('meeting_check_in', context({ userDb: raced, body: { booking_id: BOOKING } }))).status, 409);
  } finally {
    mock.timers.reset();
  }
});

test('會議室主檔：非管理者拒絕、名稱必填、容量需為非負整數', async () => {
  assert.equal(result(await handleMeetingAction('meeting_save_room', context({ body: { name: 'A 會議室' } }))).status, 403);
  assert.equal(result(await handleMeetingAction('meeting_save_room', context({ isAdmin: true, body: { name: '' } }))).status, 400);
  assert.equal(result(await handleMeetingAction('meeting_save_room', context({ isAdmin: true, body: { name: 'A', capacity: -1 } }))).status, 400);
  assert.equal(result(await handleMeetingAction('meeting_save_room', context({ isAdmin: true, body: { name: 'A', capacity: 2.5 } }))).status, 400);
});

test('會議室主檔：新增寫入建立者與稽核；更新找不到回 404、成功回 created=false', async () => {
  const created = fakeDb(call => has(call, 'insert') && call.table === 'meeting_rooms'
    ? { data: { room_id: ROOM }, error: null } : { error: null });
  const add = result(await handleMeetingAction('meeting_save_room', context({ userDb: created, isAdmin: true, body: { name: 'A 會議室', capacity: '12', floor: '2F' } })));
  assert.equal(add.status, 200);
  assert.deepEqual(add.body.data, { room_id: ROOM, created: true });
  const insert = created.calls.find(call => call.table === 'meeting_rooms' && has(call, 'insert'))!.ops.find(([op]) => op === 'insert')![1][0] as Record<string, unknown>;
  assert.equal(insert.created_by, '11111111-1111-1111-1111-111111111111');
  assert.equal(insert.capacity, 12);
  assert.ok(created.calls.some(call => call.table === 'audit_logs'));

  const missing = fakeDb(() => ({ data: null, error: null }));
  assert.equal(result(await handleMeetingAction('meeting_save_room', context({ userDb: missing, isAdmin: true, body: { name: 'A', room_id: ROOM } }))).status, 404);

  const existing = fakeDb(call => has(call, 'maybeSingle') ? { data: { room_id: ROOM, name: '舊名' }, error: null } : { error: null });
  const edit = result(await handleMeetingAction('meeting_save_room', context({ userDb: existing, isAdmin: true, body: { name: '新名', room_id: ROOM } })));
  assert.equal(edit.status, 200);
  assert.deepEqual(edit.body.data, { room_id: ROOM, created: false });
});
