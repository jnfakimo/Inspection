const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.require = id => {
    if (!(id in mocks)) throw new Error(`unexpected dependency: ${id}`);
    return mocks[id];
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return compiled.exports;
}
const point = (id, driver = 'driver-a') => ({ client_event_id: id, session_id: 'session-a', recorded_by: driver });
function scenario(initial) {
  let queue = initial;
  const state = { auth: 'auth-a', authError: null, profileError: null, calls: [], hold: null, afterUpload: null };
  const client = {
    auth: {
      async getUser() { return { data: { user: state.auth ? { id: state.auth } : null }, error: state.authError }; },
      async getSession() { return { data: { session: state.auth ? { user: { id: state.auth } } : null }, error: null }; },
    },
    from(table) {
      if (table === 'vehicle_tracking_sessions') {
        const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ data: [{ session_id: 'session-a' }], error: state.sessionError }).then(resolve); } };
        return q;
      }
      if (table === 'users') {
        const q = { select() { return q; }, eq() { return q; }, async single() {
          return { data: { user_id: state.auth === 'auth-a' ? 'driver-a' : 'driver-b' }, error: state.profileError };
        } };
        return q;
      }
      assert.equal(table, 'vehicle_location_points');
      return { async upsert(batch) {
        state.calls.push(batch);
        if (state.hold) await state.hold;
        if (batch.some(p => p.recorded_by !== (state.auth === 'auth-a' ? 'driver-a' : 'driver-b')))
          return { error: new Error('RLS rejects entire mixed-owner batch') };
        if (batch.some(p => p.session_id !== 'session-a')) return { error: new Error('RLS rejects closed duties') };
        if (state.afterUpload) await state.afterUpload();
        return { error: null };
      } };
    },
  };
  const sync = load('src/sync.ts', {
    './supabase': { supabase: client },
    './storage': {
      async readLocationQueue() { return [...queue]; },
      async removeQueuedLocationPoints(ids) { queue = queue.filter(p => !ids.includes(p.client_event_id)); },
    },
  });
  return { ...sync, state, queue: () => queue };
}
test('mixed-owner offline points do not block the authenticated driver or delete other drivers data', async () => {
  const s = scenario([point('foreign', 'driver-b'), point('own')]);
  assert.equal(await s.flushLocationQueue(), 1);
  assert.deepEqual(s.queue(), [point('foreign', 'driver-b')]);
  s.state.auth = 'auth-b';
  assert.equal(await s.flushLocationQueue(), 1);
  assert.deepEqual(s.queue(), []);
});
test('missing login and failed identity lookup preserve all points without any upload', async () => {
  for (const fault of [{ auth: null }, { authError: new Error('offline') }, { profileError: new Error('unavailable') }, { sessionError: new Error('unavailable') }]) {
    const s = scenario([point('own')]); Object.assign(s.state, fault);
    await assert.rejects(s.flushLocationQueue());
    assert.equal(s.state.calls.length, 0);
    assert.equal(s.queue().length, 1);
  }
});
test('closed historical duty points are retained without blocking another active duty', async () => {
  const historical = { ...point('old'), session_id: 'closed-session' };
  const s = scenario([historical, point('current')]);
  assert.equal(await s.flushLocationQueue(), 1);
  assert.deepEqual(s.queue(), [historical]);
});
test('account switch between batches prevents the old queue being sent under the new login', async () => {
  const s = scenario(Array.from({ length: 101 }, (_, i) => point(String(i))));
  s.state.afterUpload = async () => { s.state.auth = 'auth-b'; };
  await assert.rejects(s.flushLocationQueue(), /帳號已變更/);
  assert.equal(s.state.calls.length, 1);
  assert.deepEqual(s.queue(), [point('100')]);
});
test('concurrent manual and background flush share one upload and a failure can retry', async () => {
  const s = scenario([point('own')]); let release;
  s.state.hold = new Promise(resolve => { release = resolve; });
  const first = s.flushLocationQueue(); const second = s.flushLocationQueue();
  assert.equal(first, second);
  release(); assert.equal(await first, 1); assert.equal(await second, 1);
  assert.equal(s.state.calls.length, 1);
  const failed = scenario([point('retry')]); failed.state.authError = new Error('offline');
  await assert.rejects(failed.flushLocationQueue()); failed.state.authError = null;
  assert.equal(await failed.flushLocationQueue(), 1);
});
const { completeTrackingDuty } = load('src/duty-completion.ts', {});
test('failed upload and late queued points never close the server duty or clear local session', async () => {
  for (const late of [false, true]) {
    const calls = [];
    await assert.rejects(completeTrackingDuty({ sessionId: 's' }, {
      async stopTracking() { calls.push('stop'); },
      async flushQueue() { if (!late) throw new Error('offline'); return 1; },
      async hasPendingPoints() { return late; },
      async endSession() { calls.push('end'); },
      async clearSession() { calls.push('clear'); },
    }), /勤務尚未結束/);
    assert.deepEqual(calls, ['stop']);
  }
});
test('duty completes only after successful upload; server failure preserves local session for retry', async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const operation = completeTrackingDuty({ sessionId: 's' }, {
      async stopTracking() { calls.push('stop'); },
      async flushQueue() { calls.push('flush'); return 1; },
      async hasPendingPoints(id) { assert.equal(id, 's'); return false; },
      async endSession(id) { assert.equal(id, 's'); calls.push('end'); if (fail) throw new Error('offline'); },
      async clearSession() { calls.push('clear'); },
    });
    if (fail) await assert.rejects(operation); else await operation;
    assert.deepEqual(calls, fail ? ['stop', 'flush', 'end'] : ['stop', 'flush', 'end', 'clear']);
  }
});
