import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const systemHub = readFileSync(new URL('../app/systems/[system]/system-hub-client.tsx', import.meta.url), 'utf8');

test('workorder request card title is 報修', () => {
  const card = systemHub.match(/\{hasModuleAccess\(profile, 'workorder', 'requests'\)[\s\S]*?href="\/systems\/workorder\/requests\/"[\s\S]*?<\/Link>\}/)?.[0];
  assert.ok(card, 'workorder request card must remain available');
  assert.match(card, /<h3>報修<\/h3>/);
});