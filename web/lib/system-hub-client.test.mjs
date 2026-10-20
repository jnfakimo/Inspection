import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/systems/[system]/system-hub-client.tsx', import.meta.url), 'utf8');

test('handover root renders all eight permission-filtered subsystem cards', () => {
  const keys = ['records', 'mechanical', 'business', 'fruit', 'guard', 'open-items', 'equipment', 'mechanical-schedule'];
  assert.match(source, /system\.key === 'handover' \|\| system\.key === 'guardpatrol'/);
  assert.match(source, /const handover = system\.key === 'handover';/);
  for (const key of keys) assert.match(source, new RegExp("\\['" + key + "',"));
  assert.match(source, /hasModuleAccess\(profile, system\.key, key\)/);
  assert.match(source, /system\.key === 'handover' && key === 'guard' && hasModuleAccess\(profile, 'handover', 'guard-approve'\)/);
  assert.match(source, /cards\.filter\(\(\[key\]\) => canSeeModule\(key\)\)/);
  assert.doesNotMatch(source, /HandoverModules system=/);
});