import assert from 'node:assert/strict';
import test from 'node:test';
import { handleBusinessHandoverAction } from './business-handover.ts';

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  const ctx = {
    req: new Request('https://example.test'), body: { handover_date: '2026-09-15', shift_code: '01-09', operation: 'submit', receiver_id: '00000000-0000-0000-0000-000000000002', revision: 'a'.repeat(32), actor: 'spoofed' },
    can: () => true, canModule: () => true,
    userDb: { rpc: async (...args: unknown[]) => { calls.push(args); return { data: [], error: null }; } },
    reply: (_: unknown, body: unknown, status = 200) => ({ body, status }), ...overrides,
  };
  return { calls, ctx: ctx as never };
}
const run = async (action: string, overrides: Record<string, unknown> = {}) => {
  const f = fixture(overrides);
  return { ...f, result: await handleBusinessHandoverAction(action, f.ctx) as unknown as { status: number; body: Record<string, unknown> } };
};
test('其他 API 繼續分派；大系統與子系統任一拒絕時不碰資料庫', async () => {
  assert.equal((await run('other')).result, null);
  for (const overrides of [{ can: () => false }, { canModule: () => false }]) {
    const r = await run('business_handover_action', overrides);
    assert.equal(r.result.status, 403); assert.equal(r.calls.length, 0);
  }
});
test('日期、班別、動作、簽認版本與 UUID 必須有效', async () => {
  for (const body of [ { handover_date: '2026-02-30' }, { handover_date: '2026-09-15', operation: 'erase', shift_code: '01-09' },
    { handover_date: '2026-09-15', operation: 'submit', shift_code: '01-09', receiver_id: 'invalid', revision: 'a'.repeat(32) },
    { handover_date: '2026-09-15', operation: 'receive', shift_code: '01-09', revision: 'old' } ]) {
    const r = await run('business_handover_action', { body });
    assert.equal(r.result.status, 400); assert.equal(r.calls.length, 0);
  }
});
test('簽名身分與時間不接受前端代填，交由使用者權杖的交易式 RPC', async () => {
  const r = await run('business_handover_action');
  assert.equal(r.result.status, 200);
  assert.deepEqual(r.calls, [['business_handover_action', { p_action: 'submit', p_date: '2026-09-15', p_shift: '01-09', p_entry: null, p_receiver: '00000000-0000-0000-0000-000000000002', p_revision: 'a'.repeat(32) }]]);
});
test('資料库簽認失敗回報失敗，讀取錯誤亦不可降級空白成功', async () => {
  const userDb = { rpc: async () => ({ data: null, error: { code: '42501', message: '僅指定接班人本人可確認接班' } }) };
  const r = await run('business_handover_action', { userDb });
  assert.equal(r.result.status, 403); assert.equal(r.result.body.ok, false);
  await assert.rejects(run('business_handover_day', { userDb }));
});
