import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHandoverMarketAction } from './handover-market.ts';

function context(deptId: string, sysadmin = false) {
  return {
    req: new Request('https://local.invalid'), body: { team: 'business' },
    profile: { user_id: 'person', dept_id: deptId }, isSysadmin: sysadmin,
    can: () => true, canModule: () => true,
    admin: { rpc: async () => ({ data: deptId === 'team-one' ? ['market_1'] : [], error: null }) },
    reply: (_request: Request, value: unknown, status = 200) => Response.json(value, { status }),
  } as never;
}

test('market choices are limited by the actor department, with no free-text fallback', async () => {
  const result = await handleHandoverMarketAction('handover_market_context', context('team-one'));
  assert.deepEqual((await result!.json()).data.markets, ['market_1']);
  const outsider = await handleHandoverMarketAction('handover_market_context', context('unknown'));
  assert.deepEqual((await outsider!.json()).data.markets, []);
});

test('a system administrator can select either market', async () => {
  const result = await handleHandoverMarketAction('handover_market_context', context('unknown', true));
  assert.deepEqual((await result!.json()).data.markets, ['market_1', 'market_2']);
});
