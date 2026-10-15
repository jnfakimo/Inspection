import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./handover-source-parity-check.mjs', import.meta.url));
const digest = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase();

test('release source parity passes matching files and rejects missing or divergent files', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'handover-parity-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, 'source');
  const release = path.join(temp, 'release');
  fs.mkdirSync(path.join(source, 'web'), { recursive: true });
  fs.mkdirSync(path.join(release, 'web'), { recursive: true });
  const rel = 'web/mechanical-handover.tsx';
  const payload = 'source snapshot';
  fs.writeFileSync(path.join(source, rel), payload);
  fs.writeFileSync(path.join(release, rel), payload);
  const manifest = path.join(temp, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ sourceSnapshot: 'fixture', files: [{ path: rel, sha256: digest(payload) }] }));
  const run = () => spawnSync(process.execPath, [checker, '--manifest', manifest, '--source-root', source, '--release-root', release], { encoding: 'utf8' });

  const matching = run();
  assert.equal(matching.status, 0, matching.stderr || matching.stdout);
  assert.match(matching.stdout, /parity passed/);

  fs.writeFileSync(path.join(release, rel), 'divergent source');
  const divergent = run();
  assert.equal(divergent.status, 1);
  assert.match(divergent.stderr, /expected/);

  fs.rmSync(path.join(release, rel));
  const missing = run();
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing/);
});