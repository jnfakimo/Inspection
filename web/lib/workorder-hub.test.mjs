import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hub = readFileSync(new URL('../app/systems/[system]/system-hub-client.tsx', import.meta.url), 'utf8');
const modules = readFileSync(new URL('./modules.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../app/systems/[system]/[module]/workspace-router.tsx', import.meta.url), 'utf8');

test('workorder hub exposes all six registered modules in order with individual access checks', () => {
  const keys = ['requests', 'dispatch', 'orders', 'attachments', 'analytics', 'repairmap3d'];
  const positions = keys.map((key, index) => {
    assert.match(modules, new RegExp("m\\('" + key + "',"), key + ' should be registered');
    const card = new RegExp(`hasModuleAccess\\(profile, 'workorder', '${key}'\\) && <Link className=\"maintenance-card [^\"]+\" href=\"/systems/workorder/${key}/\"><span className=\"maintenance-badge\">MAIN-0${index + 1}</span>`);
    assert.match(hub, card, key + ' should have an individually gated card');
    return hub.search(card);
  });
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'cards should follow the registry order');
});

test('attachments and analytics have dispatch routes and the standard module access gate', () => {
  assert.match(router, /module\.key === 'attachments' \|\| module\.key === 'analytics'/);
  assert.match(router, /hasModuleAccess\(profile, system\.key, module\.key\)/);
});