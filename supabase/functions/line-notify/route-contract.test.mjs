import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8');
const webhookSource = await readFile(new URL('../_shared/vehicle-line-webhook.ts', import.meta.url), 'utf8');

test('signed webhook dispatch happens before legacy JSON parsing and service-client creation', () => {
  const serve = source.indexOf('Deno.serve(async (req) => {');
  const signedDispatch = source.indexOf('if (req.headers.has("x-line-signature")) return await lineWebhook(req);', serve);
  const legacyClient = source.indexOf('const db = createServiceClient();', signedDispatch);
  const legacyParse = source.indexOf('const payload = JSON.parse(rawBody || "{}");', signedDispatch);
  assert.ok(serve >= 0 && signedDispatch > serve);
  assert.ok(legacyClient > signedDispatch);
  assert.ok(legacyParse > legacyClient);
});

test('new link path uses the existing shared group token, group setting, and message adapter', () => {
  assert.match(source, /select\("value"\)\.eq\("key", "line_channel_token"\)/);
  assert.match(source, /consume_line_group_register_code/);
  assert.match(source, /sendLineTextMessage/);
  assert.match(source, /global: \{ fetch: fetcher \}/);
  assert.match(webhookSource, /fetcher: deps\.fetcher/);
  assert.match(source, /consume_vehicle_line_link_intent/);
  assert.match(source, /complete_vehicle_line_account_link/);
});

test('webhook never writes the notification group directly', () => {
  assert.doesNotMatch(source, /key: "line_group_id"/);
  assert.doesNotMatch(source, /saveGroupId/);
  assert.doesNotMatch(webhookSource, /saveGroupId/);
  assert.match(webhookSource, /parseLineGroupRegisterCommand/);
});
