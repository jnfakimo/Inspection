import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeHandoverMarket, canUseHandoverMarket, staffMarketFromOrganization } from './handover-market.ts';

const departments = [
  { dept_id: 'a', code: 'MKT1', status: 'active' }, { dept_id: 'b', code: 'MKT2', status: 'active' },
  { dept_id: 'c', code: 'MKT1-ADMIN', parent_id: 'a', status: 'active' },
  { dept_id: 'd', code: 'MKT2-ADMIN', parent_id: 'b', status: 'active' },
  { dept_id: 'e', code: 'MKT1-GUARD', parent_id: 'a', status: 'active' },
  { dept_id: 'f', code: 'MKT2-GUARD', parent_id: 'b', status: 'active' },
];

test('team and market must both match the organizational hierarchy', () => {
  assert.equal(staffMarketFromOrganization('c', departments, 'business'), 'market_1');
  assert.equal(staffMarketFromOrganization('d', departments, 'business'), 'market_2');
  assert.equal(staffMarketFromOrganization('e', departments, 'guard'), 'market_1');
  assert.equal(staffMarketFromOrganization('f', departments, 'guard'), 'market_2');
  assert.equal(staffMarketFromOrganization('f', departments, 'business'), null);
});

test('cross-market and unknown market requests fail closed', () => {
  assert.equal(canUseHandoverMarket('market_1', 'market_1', false), true);
  assert.equal(canUseHandoverMarket('market_2', 'market_1', false), false);
  assert.equal(canUseHandoverMarket('market_2', null, false), false);
  assert.equal(canUseHandoverMarket('unknown', null, true), false);
});

test('server-side authorization rejects a forged market choice and accepts supervised markets', async () => {
  const client = { rpc: async () => ({ data: ['market_1'], error: null }) };
  assert.equal(await authorizeHandoverMarket(client, 'actor', 'guard', 'market_1', false), 'market_1');
  assert.equal(await authorizeHandoverMarket(client, 'actor', 'guard', 'market_2', false), null);
  assert.equal(await authorizeHandoverMarket(client, 'actor', 'guard', 'market_2', true), 'market_2');
  const supervisor = { rpc: async () => ({ data: ['market_1', 'market_2'], error: null }) };
  assert.equal(await authorizeHandoverMarket(supervisor, 'boss', 'business', 'market_2', false), 'market_2');
});
