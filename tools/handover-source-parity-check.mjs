import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'tools/handover-release-manifest.json');
const args = process.argv.slice(2);
const valueAfter = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
const manifestArg = valueAfter('--manifest');
const manifest = JSON.parse(fs.readFileSync(manifestArg ? path.resolve(manifestArg) : manifestPath, 'utf8'));
const sourceRoot = path.resolve(valueAfter('--source-root') || root);
const releaseRoot = path.resolve(valueAfter('--release-root') || root);
const errors = [];
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const inside = (base, rel) => {
  const absolute = path.resolve(base, rel);
  const relative = path.relative(base, absolute);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative), `manifest path escapes root: ${rel}`);
  return absolute;
};

for (const entry of manifest.files) {
  for (const [label, base] of [['source', sourceRoot], ['release', releaseRoot]]) {
    const file = inside(base, entry.path);
    if (!fs.existsSync(file)) {
      errors.push(`${label}: missing ${entry.path}`);
      continue;
    }
    const actual = hashFile(file);
    if (actual !== entry.sha256) errors.push(`${label}: ${entry.path} expected ${entry.sha256}, got ${actual}`);
  }
}

if (errors.length) {
  console.error(`Handover source parity failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Handover source parity passed: ${manifest.files.length} release files match ${manifest.sourceSnapshot}.`);
}