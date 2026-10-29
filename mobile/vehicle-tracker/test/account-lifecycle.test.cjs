const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/account-lifecycle.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createAccountLifecycle } = compiled.exports;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(overrides = {}) {
  const state = { stored: { driverId: 'driver-a', sessionId: 'duty-a' }, published: null, starts: 0, stops: 0, warnings: [] };
  const deps = {
    async readAccount() { return { profile: { user_id: 'driver-a' } }; },
    async readSession() { return state.stored; },
    async isSessionActive() { return true; },
    async writeSession(session) { state.stored = session; },
    async startTracking() { state.starts++; },
    async stopTracking() { state.stops++; },
    publish(account, session) { state.published = { account, session }; },
    clearAccount() { state.published = null; },
    warn(message) { state.warnings.push(message); },
    ...overrides,
  };
  return { state, deps, lifecycle: createAccountLifecycle(deps) };
}
test('only the same driver can resume a stored duty', async () => {
  const own = setup(); await own.lifecycle.refresh();
  assert.equal(own.state.starts, 1);
  assert.equal(own.state.published.session.sessionId, 'duty-a');
  const other = setup({ async readAccount() { return { profile: { user_id: 'driver-b' } }; } });
  await other.lifecycle.refresh();
  assert.equal(other.state.starts, 0); assert.equal(other.state.stops, 1);
  assert.equal(other.state.stored, null); assert.equal(other.state.published.session, null);
});
test('sign-out clears visible account immediately and discards local tracking', async () => {
  const h = setup(); await h.lifecycle.refresh();
  const clearing = h.lifecycle.clear();
  assert.equal(h.state.published, null);
  await clearing;
  assert.equal(h.state.stored, null); assert.equal(h.state.stops, 1);
});
test('a delayed account response cannot restore the signed-out screen', async () => {
  const response = deferred(); const h = setup({ readAccount: () => response.promise });
  const loading = h.lifecycle.refresh();
  await h.lifecycle.clear(); response.resolve({ profile: { user_id: 'driver-a' } }); await loading;
  assert.equal(h.state.published, null); assert.equal(h.state.starts, 0);
});
test('native start already in flight must finish before sign-out stops it', async () => {
  const entered = deferred(), release = deferred(); const calls = [];
  const h = setup({ async startTracking() { calls.push('start'); entered.resolve(); await release.promise; calls.push('started'); }, async stopTracking() { calls.push('stop'); } });
  const loading = h.lifecycle.refresh(); await entered.promise;
  const clearing = h.lifecycle.clear(); release.resolve(); await Promise.all([loading, clearing]);
  assert.deepEqual(calls, ['start', 'started', 'stop']);
  assert.equal(h.state.stored, null); assert.equal(h.state.published, null);
});
test('native stop failure still removes local duty and a later refresh retries cleanup', async () => {
  let fail = true; let stops = 0;
  const h = setup({ async stopTracking() { stops++; if (fail) throw new Error('native unavailable'); } });
  await assert.rejects(h.lifecycle.clear(), /native unavailable/);
  assert.equal(h.state.stored, null);
  fail = false; await h.lifecycle.refresh();
  assert.equal(stops, 2); assert.equal(h.state.starts, 0); assert.equal(h.state.published.session, null);
});
test('newer account refresh wins over an older response', async () => {
  const first = deferred(); let calls = 0;
  const h = setup({ readAccount() { return ++calls === 1 ? first.promise : Promise.resolve({ profile: { user_id: 'driver-b' } }); } });
  const older = h.lifecycle.refresh(); await h.lifecycle.refresh();
  first.resolve({ profile: { user_id: 'driver-a' } }); await older;
  assert.equal(h.state.published.account.profile.user_id, 'driver-b'); assert.equal(h.state.starts, 0);
});
test('unmount invalidates pending work without deleting an ongoing duty', async () => {
  const response = deferred(); const h = setup({ readAccount: () => response.promise });
  const loading = h.lifecycle.refresh(); h.lifecycle.cancelPending();
  response.resolve({ profile: { user_id: 'driver-a' } }); await loading;
  assert.equal(h.state.published, null); assert.equal(h.state.stored.sessionId, 'duty-a'); assert.equal(h.state.starts, 0);
});
test('temporary account read failure does not discard offline duty data', async () => {
  const h = setup({ async readAccount() { throw new Error('offline'); } });
  await assert.rejects(h.lifecycle.refresh(), /offline/);
  assert.equal(h.state.stored.sessionId, 'duty-a'); assert.equal(h.state.published, null);
});

test('a server-ended duty after a lost completion response is not restarted', async () => {
  const h = setup({ async isSessionActive(session) { assert.equal(session.sessionId, 'duty-a'); return false; } });
  await h.lifecycle.refresh();
  assert.equal(h.state.starts, 0);
  assert.equal(h.state.stops, 1);
  assert.equal(h.state.stored, null);
  assert.equal(h.state.published.session, null);
  assert.match(h.state.warnings[0], /勤務已結束或已無法使用/);
});

test('completion pending survives restart without resuming even when server is still active', async () => {
  const h = setup(); h.state.stored.completionPending = true;
  await h.lifecycle.refresh();
  assert.equal(h.state.starts, 0); assert.equal(h.state.stops, 1);
  assert.equal(h.state.stored.completionPending, true);
  assert.match(h.state.warnings[0], /請再次按結束勤務/);
});

test('completion intent is serialized with sign-out and cannot restore a signed-out duty', async () => {
  const entered = deferred(), release = deferred();
  const h = setup({ async writeSession(session) { if (session?.completionPending) { entered.resolve(); await release.promise; } h.state.stored = session; } });
  const mark = h.lifecycle.markCompleting(h.state.stored, h.lifecycle.capture());
  await entered.promise; const clearing = h.lifecycle.clear(); release.resolve();
  assert.equal(await mark, false); await clearing;
  assert.equal(h.state.stored, null);
});

test('failed server duty lookup pauses tracking and preserves the local duty for retry', async () => {
  let fail = true;
  const h = setup({ async isSessionActive() { if (fail) throw new Error('lookup unavailable'); return true; } });
  await assert.rejects(h.lifecycle.refresh(), /lookup unavailable/);
  assert.equal(h.state.stored.sessionId, 'duty-a');
  assert.equal(h.state.starts, 0); assert.equal(h.state.stops, 1);
  fail = false; await h.lifecycle.refresh();
  assert.equal(h.state.starts, 1);
  assert.equal(h.state.published.session.sessionId, 'duty-a');
});

test('late server duty lookup cannot clear or restart a newer signed-in duty', async () => {
  const entered = deferred(), response = deferred(); let lookups = 0;
  const h = setup({ async isSessionActive() { if (++lookups === 1) { entered.resolve(); return response.promise; } return true; } });
  const older = h.lifecycle.refresh(); await entered.promise;
  h.state.stored = { driverId: 'driver-a', sessionId: 'new-duty' };
  await h.lifecycle.refresh(); response.resolve(false); await older;
  assert.equal(h.state.starts, 1); assert.equal(h.state.stops, 0);
  assert.equal(h.state.stored.sessionId, 'new-duty');
  assert.equal(h.state.published.session.sessionId, 'new-duty');
});

test('a duty creation response received after sign-out cannot persist or start tracking', async () => {
  const h = setup(); const isCurrent = h.lifecycle.capture();
  await h.lifecycle.clear();
  assert.equal(await h.lifecycle.activate({ driverId: 'driver-a', sessionId: 'late-duty' }, isCurrent), false);
  assert.equal(h.state.stored, null); assert.equal(h.state.starts, 0);
});
test('sign-out during a manual duty start leaves native tracking stopped and no local duty', async () => {
  const entered = deferred(), release = deferred(); const calls = [];
  const h = setup({ async startTracking() { calls.push('start'); entered.resolve(); await release.promise; calls.push('started'); }, async stopTracking() { calls.push('stop'); } });
  const activating = h.lifecycle.activate({ driverId: 'driver-a', sessionId: 'new-duty' }, h.lifecycle.capture());
  await entered.promise; const clearing = h.lifecycle.clear(); release.resolve();
  assert.equal(await activating, false); await clearing;
  assert.equal(calls.at(-1), 'stop'); assert.equal(h.state.stored, null);
});
