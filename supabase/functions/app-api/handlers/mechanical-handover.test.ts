import assert from 'node:assert/strict';
import test from 'node:test';
import { handleMechanicalHandoverAction } from './mechanical-handover.ts';

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const ctx = {
    req: new Request('https://example.test'), body: { market_code: 'market_2', handover_date: '2026-09-15', shift_code: '01-09', operation: 'submit', receiver_id: '00000000-0000-0000-0000-000000000002', revision: 'a'.repeat(32), actor: 'spoofed' },
    can: () => true, canModule: () => true,
    profile: { user_id: '00000000-0000-0000-0000-000000000001' }, isSysadmin: false,
    admin: { rpc: async () => ({ data: ['market_2'], error: null }) },
    userDb: { rpc: async (...args: unknown[]) => { calls.push(args); return { data: [], error: null }; } },
    reply: (_: unknown, body: unknown, status = 200) => ({ body, status }), ...overrides,
  };
  return { calls, ctx: ctx as never };
}
const run = async (action: string, overrides: Record<string, unknown> = {}) => {
  const f = fixture(overrides);
  return { ...f, result: await handleMechanicalHandoverAction(action, f.ctx) as unknown as { status: number; body: Record<string, unknown> } };
};

test('只攔截機電交接 API，任一層權限拒絕時不查資料庫', async () => {
  assert.equal((await run('other')).result, null);
  for (const overrides of [{ can: () => false }, { canModule: () => false }]) {
    const r = await run('mechanical_handover_action', overrides);
    assert.equal(r.result.status, 403); assert.equal(r.calls.length, 0);
  }
});
test('日期、班別、動作、接班人及快照版本必須有效', async () => {
  for (const body of [{ market_code: 'market_2', handover_date: '2026-02-30' }, { market_code: 'market_2', handover_date: '2026-09-15', shift_code: 'bad', operation: 'submit', receiver_id: '00000000-0000-0000-0000-000000000002', revision: 'a'.repeat(32) },
    { market_code: 'market_2', handover_date: '2026-09-15', shift_code: '01-09', operation: 'submit', receiver_id: 'bad', revision: 'a'.repeat(32) },
    { market_code: 'market_2', handover_date: '2026-09-15', shift_code: '01-09', operation: 'receive', revision: 'old' }]) {
    const r = await run('mechanical_handover_action', { body });
    assert.equal(r.result.status, 400); assert.equal(r.calls.length, 0);
  }
});
test('簽認身分與時間只由交易式 RPC 取得', async () => {
  const r = await run('mechanical_handover_action');
  assert.equal(r.result.status, 200);
  assert.deepEqual(r.calls, [['mechanical_market_action', { p_market: 'market_2', p_action: 'submit', p_date: '2026-09-15', p_shift: '01-09', p_receiver: '00000000-0000-0000-0000-000000000002', p_revision: 'a'.repeat(32) }]]);
});
test('一般使用者不能偽造另一市場參數', async () => {
  const r = await run('mechanical_handover_action', { admin: { rpc: async () => ({ data: ['market_1'], error: null }) } });
  assert.equal(r.result.status, 403); assert.equal(r.calls.length, 0);
});
test('資料庫簽認失敗回報失敗，讀取錯誤不可降級成空白成功', async () => {
  const userDb = { rpc: async () => ({ data: null, error: { code: '42501', message: '僅指定接班人本人可確認接班' } }) };
  const r = await run('mechanical_handover_action', { userDb });
  assert.equal(r.result.status, 403); assert.equal(r.result.body.ok, false);
  await assert.rejects(run('mechanical_handover_day', { userDb }));
});
