import assert from 'node:assert/strict';
import test from 'node:test';
import { createVehicleLineWebhookHandler, parseEquipmentQuery, type VehicleLineWebhookStore } from './vehicle-line-webhook.ts';

const lineUserId = `U${'a'.repeat(32)}`;
const botUserId = `U${'b'.repeat(32)}`;
const nonce = 'N'.repeat(32);

function handler(overrides: Partial<VehicleLineWebhookStore>, calls: string[]) {
  const store: VehicleLineWebhookStore = {
    ensureLinkSchema: async () => { calls.push('vehicle-schema'); },
    ensureEquipmentSchema: async () => { calls.push('equipment-schema'); },
    loadChannelAccessToken: async () => 'token',
    saveGroupId: async () => { calls.push('group'); },
    consumeLinkIntent: async () => { calls.push('vehicle-consume'); return { outcome: 'invalid_or_expired' }; },
    completeAccountLink: async () => { calls.push('vehicle-complete'); return 'invalid_or_expired'; },
    ...overrides,
  };
  return createVehicleLineWebhookHandler({
    channelSecret: () => 'secret',
    createStore: () => { calls.push('store'); return store; },
    fetcher: async (url) => {
      if (String(url).endsWith('/bot/info')) return Response.json({ userId: botUserId });
      if (String(url).endsWith('/linkToken')) return Response.json({ linkToken: 'syntheticLinkToken000001' });
      throw new Error('unexpected LINE call');
    },
    verifySignature: async () => true,
    createNonce: () => nonce,
    sendMessage: async () => ({ ok: true, status: 200 }),
  });
}

function request(events: unknown[]) {
  return new Request('https://example.test/line-notify', {
    method: 'POST',
    headers: { 'x-line-signature': 'synthetic' },
    body: JSON.stringify({ destination: botUserId, events }),
  });
}

test('設備 command is exact and bounded', () => {
  assert.equal(parseEquipmentQuery('設備 REF-B1-001'), 'REF-B1-001');
  assert.equal(parseEquipmentQuery('設備：REF-B1-001'), 'REF-B1-001');
  assert.equal(parseEquipmentQuery('設備'), null);
  assert.equal(parseEquipmentQuery('設備 ' + 'X'.repeat(81)), null);
});

test('signed direct equipment message calls the equipment responder', async () => {
  const calls: string[] = [];
  const process = handler({
    replyEquipmentQuery: async ({ lineUserId: id, code, replyToken }) => {
      assert.deepEqual([id, code, replyToken], [lineUserId, 'REF-B1-001', 'reply']);
      calls.push('equipment-reply');
    },
  }, calls);
  const response = await process(request([{
    type: 'message', source: { type: 'user', userId: lineUserId },
    message: { type: 'text', text: '設備 REF-B1-001' }, replyToken: 'reply',
  }]));
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['store', 'vehicle-schema', 'equipment-schema', 'equipment-reply']);
});

test('equipment command in a group never queries private equipment', async () => {
  const calls: string[] = [];
  const process = handler({ replyEquipmentQuery: async () => { calls.push('equipment-reply'); } }, calls);
  const response = await process(request([{
    type: 'message', source: { type: 'group', groupId: 'group', userId: lineUserId },
    message: { type: 'text', text: '設備 REF-B1-001' }, replyToken: 'reply',
  }]));
  assert.equal(response.status, 200);
  assert.equal(calls.includes('equipment-reply'), false);
});

test('equipment link code and account-link callback do not enter vehicle binding', async () => {
  const calls: string[] = [];
  const process = handler({
    consumeEquipmentLinkIntent: async () => { calls.push('equipment-consume'); return 'ready'; },
    completeEquipmentAccountLink: async () => { calls.push('equipment-complete'); return 'linked'; },
  }, calls);
  const code = `LINK-${'C'.repeat(32)}`;
  assert.equal((await process(request([{
    type: 'message', source: { type: 'user', userId: lineUserId },
    message: { type: 'text', text: code },
  }]))).status, 200);
  assert.equal((await process(request([{
    type: 'accountLink', source: { type: 'user', userId: lineUserId },
    link: { nonce, result: 'ok' },
  }]))).status, 200);
  assert.ok(calls.includes('equipment-consume'));
  assert.ok(calls.includes('equipment-complete'));
  assert.equal(calls.includes('vehicle-consume'), false);
  assert.equal(calls.includes('vehicle-complete'), false);
});

test('missing equipment migration leaves existing vehicle link handling available', async () => {
  const calls: string[] = [];
  const process = handler({
    ensureEquipmentSchema: async () => { throw { code: '42P01' }; },
    consumeEquipmentLinkIntent: async () => { throw new Error('equipment RPC must not run'); },
  }, calls);
  const code = `LINK-${'C'.repeat(32)}`;
  const response = await process(request([{
    type: 'message', source: { type: 'user', userId: lineUserId },
    message: { type: 'text', text: code },
  }]));
  assert.equal(response.status, 200);
  assert.ok(calls.includes('vehicle-consume'));
  assert.equal(calls.includes('equipment-consume'), false);
});
