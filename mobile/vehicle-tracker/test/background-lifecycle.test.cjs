const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', 'src', file);
  const compiled = new Module(filename, module);
  compiled.require = id => { if (!(id in mocks)) throw new Error(`unexpected dependency: ${id}`); return mocks[id]; };
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
  return compiled.exports;
}
const session = { sessionId: 'duty-a', vehicleId: 'vehicle-a', deviceId: 'device-a', driverId: 'driver-a', platformIdentifier: 'tag-a' };
function setup(overrides = {}) {
  let callback;
  const state = { running: true, points: [], uploads: 0, ble: 0 };
  const background = load('background-location.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-crypto': { randomUUID: () => 'synthetic-point' },
    'expo-task-manager': { defineTask(name, handler) { callback = handler; } },
    'expo-location': {
      Accuracy: { High: 4 }, ActivityType: { AutomotiveNavigation: 1 },
      async requestForegroundPermissionsAsync() { return { status: 'granted' }; },
      async requestBackgroundPermissionsAsync() { return { status: 'granted' }; },
      async hasStartedLocationUpdatesAsync() { return state.running; },
      async startLocationUpdatesAsync() { state.running = true; },
      async stopLocationUpdatesAsync() { state.running = false; },
      ...overrides.location,
    },
    './storage': {
      async readActiveSession() { return session; },
      async enqueueLocationPoints(points) { state.points.push(...points); },
      ...overrides.storage,
    },
    './sync': { async flushLocationQueue() { state.uploads++; if (overrides.flush) await overrides.flush(); } },
    './ble-monitor': { async monitorBlePresence() { state.ble++; } },
  });
  return { ...background, state, callback: () => callback({ data: { locations: [{ timestamp: Date.now(), coords: { latitude: 25, longitude: 121, speed: 0, heading: 0, accuracy: 5, altitude: 0 } }] } }) };
}
test('stop waits for accepted local writes before duty completion checks its queue', async () => {
  const entered = deferred(), write = deferred(); let persisted = false;
  const h = setup({ storage: { async enqueueLocationPoints() { entered.resolve(); await write.promise; persisted = true; } } });
  const callback = h.callback(); await entered.promise;
  let stopped = false; const stopping = h.stopBackgroundTracking().then(() => { stopped = true; });
  await turn(); const returnedBeforeWrite = stopped;
  write.resolve(); await Promise.all([callback, stopping]);
  assert.equal(persisted, true);
  assert.equal(returnedBeforeWrite, false);
  assert.equal(h.state.uploads, 0);
  assert.equal(h.state.ble, 0);
});
test('a session read delayed across stop cannot enqueue an old duty point', async () => {
  const read = deferred(), entered = deferred();
  const h = setup({ storage: { async readActiveSession() { entered.resolve(); return read.promise; } } });
  const callback = h.callback(); await entered.promise;
  const stopping = h.stopBackgroundTracking(); await turn(); read.resolve(session);
  await Promise.all([callback, stopping]);
  assert.equal(h.state.points.length, 0);
});
test('stop does not wait for network upload and its delayed result cannot start BLE', async () => {
  const entered = deferred(), network = deferred();
  const h = setup({ async flush() { entered.resolve(); await network.promise; } });
  const callback = h.callback(); await entered.promise;
  await h.stopBackgroundTracking();
  network.resolve(); await callback;
  assert.equal(h.state.points.length, 1);
  assert.equal(h.state.ble, 0);
});
test('late callbacks after stop are ignored and a new explicit start accepts locations', async () => {
  const h = setup(); await h.stopBackgroundTracking(); await h.callback();
  assert.equal(h.state.points.length, 0);
  await h.startBackgroundTracking(); await h.callback();
  assert.equal(h.state.points.length, 1);
});
test('native stop failure still invalidates callbacks', async () => {
  const h = setup({ location: { async stopLocationUpdatesAsync() { throw new Error('native failure'); } } });
  await assert.rejects(h.stopBackgroundTracking(), /native failure/);
  await h.callback(); assert.equal(h.state.points.length, 0);
});
test('failed local persistence prevents stop from reporting safe duty completion', async () => {
  const entered = deferred(), write = deferred();
  const h = setup({ storage: { async enqueueLocationPoints() { entered.resolve(); await write.promise; throw new Error('disk failure'); } } });
  const callback = h.callback(); const rejectedCallback = assert.rejects(callback, /disk failure/); await entered.promise;
  const stopping = h.stopBackgroundTracking().then(() => null, error => error);
  await turn(); write.resolve(); await rejectedCallback;
  assert.match(String(await stopping), /disk failure/);
});
for (const delay of ['scan', 'upload']) test(`cancelled BLE ${delay} cannot publish stale monitoring state`, async () => {
  const gate = deferred(), entered = deferred(); let current = true, writes = 0, events = 0;
  const monitor = load('ble-monitor.ts', {
    'react-native': { Platform: { OS: 'android' } },
    './ble': { async findRegisteredDevice() { if (delay === 'scan') { entered.resolve(); await gate.promise; } return null; } },
    './storage': { async readBleMonitorState() { return { lastCheckedAt: 0, presence: 'present' }; }, async writeBleMonitorState() { writes++; } },
    './supabase': { supabase: { from() { return { async insert() { events++; if (delay === 'upload') { entered.resolve(); await gate.promise; } return { error: null }; } }; } } },
  });
  const pending = monitor.monitorBlePresence(session, () => current); await entered.promise;
  current = false; gate.resolve(); await pending;
  assert.equal(writes, 0);
  assert.equal(events, delay === 'upload' ? 1 : 0);
});
test('end duty drains an in-flight location before flushing and closing the server session', async () => {
  const entered = deferred(), disk = deferred(), order = [];
  let queue = [];
  const h = setup({ storage: { async enqueueLocationPoints(points) { entered.resolve(); await disk.promise; queue.push(...points); order.push('persist'); } } });
  const callback = h.callback(); await entered.promise;
  const { completeTrackingDuty } = load('duty-completion.ts', {});
  const completion = completeTrackingDuty(session, {
    stopTracking: h.stopBackgroundTracking,
    async flushQueue() { order.push('flush'); assert.equal(queue.length, 1); queue = []; return 1; },
    async hasPendingPoints() { return queue.length > 0; },
    async endSession() { order.push('end'); },
    async clearSession() { order.push('clear'); },
  });
  await turn(); assert.deepEqual(order, []);
  disk.resolve(); await Promise.all([callback, completion]);
  assert.deepEqual(order, ['persist', 'flush', 'end', 'clear']);
});
test('permission response arriving after stop cannot restart native tracking', async () => {
  const entered = deferred(), permission = deferred();
  const h = setup({ location: { async requestForegroundPermissionsAsync() { entered.resolve(); await permission.promise; return { status: 'granted' }; } } });
  const starting = h.startBackgroundTracking(); await entered.promise;
  await h.stopBackgroundTracking(); permission.resolve(); await starting;
  assert.equal(h.state.running, false);
});
test('restarting tracking does not reactivate an earlier upload callback', async () => {
  const entered = deferred(), network = deferred();
  const h = setup({ async flush() { entered.resolve(); await network.promise; } });
  const old = h.callback(); await entered.promise;
  await h.stopBackgroundTracking(); await h.startBackgroundTracking();
  network.resolve(); await old;
  assert.equal(h.state.ble, 0);
  await h.callback(); assert.equal(h.state.ble, 1);
});
