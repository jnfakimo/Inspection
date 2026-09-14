import assert from 'node:assert/strict';
import test from 'node:test';
import { handlePatrolShiftAction } from './patrol-shifts.ts';

const response = (value: Response | null) => value as unknown as { status: number; body: Record<string, any> };
const request = (overrides: Record<string, unknown> = {}) => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const userDb = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { data: name === 'apply_all_patrol_shift_templates_and_activate'
        ? { templates: 5, days: 2, rows: 10 }
        : name === 'set_patrol_shift_day_status'
          ? { duty_date: '2099-01-02', status: 'suspended' }
          : { count: 7, from_date: '2099-01-02', suspended_days: 3 }, error: null };
    },
  };
  return {
    calls,
    ctx: {
      req: new Request('https://example.test/app-api', { method: 'POST' }),
      body: { from_date: '2099-01-02', duty_shift_ids: ['11111111-1111-1111-1111-111111111111', 'invalid'] },
      profile: { user_id: '22222222-2222-2222-2222-222222222222' },
      admin: userDb,
      userDb,
      reply: (_req: Request, body: unknown, status = 200) => ({ status, body }) as unknown as Response,
      can: () => true,
      canModule: () => true,
      isAdmin: true,
      isSysadmin: true,
      ...overrides,
    } as never,
  };
};

test('不屬於巡檢排班的 action 交回主分派器', async () => {
  assert.equal(await handlePatrolShiftAction('profile', request().ctx), null);
});

test('批次清除只允許管理者與巡檢排班權限', async () => {
  assert.equal(response(await handlePatrolShiftAction('patrol_shift_delete_from_date', request({ isAdmin: false }).ctx)).status, 403);
  assert.equal(response(await handlePatrolShiftAction('patrol_shift_delete_from_date', request({ canModule: () => false }).ctx)).status, 403);
});

test('批次清除拒絕錯誤與過去日期', async () => {
  assert.equal(response(await handlePatrolShiftAction('patrol_shift_delete_from_date', request({ body: { from_date: '2099-99-99' } }).ctx)).status, 400);
  assert.equal(response(await handlePatrolShiftAction('patrol_shift_delete_from_date', request({ body: { from_date: '2000-01-01' } }).ctx)).status, 400);
});

test('批次清除只把有效識別碼交給交易式資料庫函式', async () => {
  const { ctx, calls } = request();
  const result = response(await handlePatrolShiftAction('patrol_shift_delete_from_date', ctx));
  assert.equal(result.status, 200);
  assert.equal(result.body.data.count, 7);
  assert.deepEqual(calls, [['reset_patrol_shifts_from_date', {
    p_from: '2099-01-02',
    p_duty_shift_ids: ['11111111-1111-1111-1111-111111111111'],
  }]]);
});

test('全部範本可一次套用到日期區間', async () => {
  const { ctx, calls } = request({ body: { from_date: '2099-01-02', to_date: '2099-01-03' } });
  const result = response(await handlePatrolShiftAction('patrol_shift_apply_all_templates', ctx));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { templates: 5, days: 2, rows: 10 });
  assert.deepEqual(calls, [['apply_all_patrol_shift_templates_and_activate', { p_from: '2099-01-02', p_to: '2099-01-03' }]]);
});

test('停用值班日必須填原因，恢復與停用都走交易式狀態函式', async () => {
  const missing = request({ body: { from_date: '2099-01-02', suspended: true, reason: '' } });
  assert.equal(response(await handlePatrolShiftAction('patrol_shift_set_day_status', missing.ctx)).status, 400);
  const { ctx, calls } = request({ body: { from_date: '2099-01-02', suspended: true, reason: '休場' } });
  assert.equal(response(await handlePatrolShiftAction('patrol_shift_set_day_status', ctx)).status, 200);
  assert.deepEqual(calls, [['set_patrol_shift_day_status', {
    p_duty_date: '2099-01-02', p_suspended: true, p_reason: '休場',
  }]]);
});
