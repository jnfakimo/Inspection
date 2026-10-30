import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scannerOutcome } from './scanner-outcome.mjs';

test('successful scan distinguishes candidates from actual coverage', () => {
  const result = scannerOutcome('Semgrep', { status: 0 }, 594);
  assert.equal(result.code, 0);
  assert.match(result.message, /候選檔案/);
  assert.match(result.message, /略過/);
});
test('findings and engine failures never report success', () => {
  for (const status of [1, 2, 7]) {
    const result = scannerOutcome('Semgrep', { status }, 594);
    assert.equal(result.code, status);
    assert.doesNotMatch(result.message, /執行成功|已掃描/);
  }
});
test('missing executable, signal and missing outcome fail closed', () => {
  for (const result of [undefined, {}, { status: null }, { status: 0, signal: 'SIGTERM' }, { error: new Error('ENOENT') }]) {
    assert.equal(scannerOutcome('Gitleaks', result, 1).code, 1);
  }
});
