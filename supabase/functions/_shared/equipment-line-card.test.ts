import assert from 'node:assert/strict';
import test from 'node:test';
import { equipmentFlexMessage, monitorPointText, sendEquipmentLineReply } from './equipment-line-card.ts';

const now = new Date('2026-11-04T08:00:00.000Z');

test('fresh good point shows the real value and timestamp', () => {
  const text = monitorPointText({
    point_name: '冷藏室溫度', last_value: 3.2, unit: '°C',
    last_quality: 'good', last_seen_at: '2026-11-04T07:59:00.000Z',
    sampling_seconds: 60, status: 'active',
  }, now);
  assert.match(text, /3\.2 °C/);
  assert.match(text, /2026/);
});

test('old, missing, paused, or bad-quality values never appear as current', () => {
  const base = { point_name: '溫度', last_value: 999, unit: '°C', sampling_seconds: 60, status: 'active' };
  assert.doesNotMatch(monitorPointText({ ...base, last_quality: 'good',
    last_seen_at: '2026-11-04T07:40:00Z' }, now), /999/);
  assert.doesNotMatch(monitorPointText({ ...base, last_quality: 'good',
    last_seen_at: null }, now), /999/);
  assert.doesNotMatch(monitorPointText({ ...base, last_quality: 'bad',
    last_seen_at: '2026-11-04T07:59:00Z' }, now), /999/);
  assert.doesNotMatch(monitorPointText({ ...base, status: 'paused', last_quality: 'good',
    last_seen_at: '2026-11-04T07:59:00Z' }, now), /999/);
});

test('Flex card labels unconnected and unauthorized data, with bounded database text', () => {
  const message = equipmentFlexMessage({
    equipment: { equipment_id: 'id', asset_code: 'REF-B1-001', name: '冷藏設備', status: 'active' },
    points: [], repairs: null, now,
    url: 'https://jnfakimo.github.io/Inspection/v2/systems/equipment/assets/?asset=REF-B1-001',
  });
  assert.equal(message.type, 'flex');
  assert.match(message.altText, /冷藏設備/);
  const body = JSON.stringify(message);
  assert.match(body, /未接入監測點位/);
  assert.match(body, /無報修查閱權限/);
  assert.match(body, /開啟中央巡檢系統/);
});

test('LINE reply uses one reply token and a Flex payload', async () => {
  let request: RequestInit = {};
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    request = init || {};
    return new Response(null, { status: 200 });
  };
  await sendEquipmentLineReply({ token: 'token', replyToken: 'reply', message: { type: 'flex' }, fetcher });
  const body = JSON.parse(String(request.body));
  assert.deepEqual(body, { replyToken: 'reply', messages: [{ type: 'flex' }] });
});
