import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../mobile/vehicle-tracker/src/ble.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ os = 'ios', version = 30, state = 'PoweredOn', deny = false } = {}) {
  const calls = { stops: 0, removed: 0, permissions: [], filters: undefined };
  let scanListener, stateListener;
  const ble = {
    onStateChange(listener) { stateListener = listener; listener(state); return { remove() { calls.removed++; } }; },
    startDeviceScan(filters, options, listener) { calls.filters = filters; scanListener = listener; return Promise.resolve(); },
    stopDeviceScan() { calls.stops++; return Promise.resolve(); },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, setTimeout, clearTimeout,
    require(name) {
      if (name === 'react-native') return {
        Platform: { OS: os, Version: version },
        PermissionsAndroid: {
          PERMISSIONS: { ACCESS_FINE_LOCATION: 'location', BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect' },
          RESULTS: { GRANTED: 'granted' },
          async requestMultiple(list) { calls.permissions = list; return Object.fromEntries(list.map(p => [p, deny ? 'denied' : 'granted'])); },
        },
      };
      if (name === 'react-native-ble-plx') return {
        BleManager: function () { return ble; },
        State: Object.fromEntries(['PoweredOn', 'PoweredOff', 'Unauthorized', 'Unsupported', 'Unknown', 'Resetting'].map(s => [s, s])),
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { api: exports, calls, ble, emit: (...args) => scanListener(...args), state: s => stateListener(s) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const device = (id, rssi = -33) => ({ id, name: 'FT', rssi, serviceUUIDs: ['abcd'] });

test('only persisted exact platform identifier proves binding, never FT name/service', () => {
  const { api } = setup();
  const nearby = { id: 'ios-id', name: 'FT', serviceUuids: ['abcd'] };
  const registered = { advertised_name: 'FT', service_uuid: 'abcd' };
  assert.equal(api.matchesRegisteredDevice(nearby, registered), false);
  assert.equal(api.matchesRegisteredDevice(nearby, { ...registered, platform_identifiers: { ios: 'other' } }), false);
  assert.equal(api.matchesRegisteredDevice(nearby, { ...registered, platform_identifiers: { android: 'ios-id' } }), false);
  assert.equal(api.matchesRegisteredDevice(nearby, { ...registered, platform_identifiers: { ios: 'ios-id' } }), true);
});
test('scan remains pending, updates RSSI, sorts, returns all results and cleans up', async () => {
  const h = setup();
  let done = false;
  const pending = h.api.scanNearbyDevices(() => {}, null, 25).then(rows => { done = true; return rows; });
  await tick();
  assert.equal(done, false);
  assert.equal(h.calls.filters, null);
  h.emit(null, device('weak', -80)); h.emit(null, device('strong', -46)); h.emit(null, device('strong', -33));
  const rows = await pending;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'strong'); assert.equal(rows[0].rssi, -33);
  assert.equal(h.calls.stops, 1); assert.equal(h.calls.removed, 1);
});
test('cold iOS initialization waits for PoweredOn instead of falsely reporting disabled', async () => {
  const h = setup({ state: 'Unknown' });
  const pending = h.api.scanNearbyDevices(() => {}, null, 10);
  await tick(); assert.equal(h.calls.filters, undefined);
  h.state('Resetting'); h.state('PoweredOn');
  assert.equal((await pending).length, 0);
  assert.equal(h.calls.removed, 1);
});
test('callback scan errors reject in Traditional Chinese and release scanner', async () => {
  const h = setup();
  const pending = h.api.scanNearbyDevices(() => {}, null, 50);
  const rejected = assert.rejects(pending, /藍牙掃描失敗/);
  await tick(); h.emit({ message: 'native failure' }, null); await rejected;
  assert.equal((await h.api.scanNearbyDevices(() => {}, null, 5)).length, 0);
});
test('native start failure and denied bluetooth permission are visible', async () => {
  const h = setup(); h.ble.startDeviceScan = () => Promise.reject(new Error('native'));
  await assert.rejects(h.api.scanNearbyDevices(() => {}, null, 5), /無法啟動/);
  h.ble.startDeviceScan = () => { throw new Error('native synchronous failure'); };
  await assert.rejects(h.api.scanNearbyDevices(() => {}, null, 5), /無法啟動/);
  assert.equal(h.calls.stops, 2);
  await assert.rejects(setup({ state: 'Unauthorized' }).api.scanNearbyDevices(() => {}), /未獲得藍牙權限/);
});
test('parallel scans are rejected and cancellation settles the active scan', async () => {
  const h = setup();
  const pending = h.api.scanNearbyDevices(() => {}, null, 100);
  const rejected = assert.rejects(pending, /已取消/);
  await tick();
  await assert.rejects(h.api.scanNearbyDevices(() => {}), /正在進行/);
  h.api.stopBleManager(); await rejected;
  assert.equal(h.calls.stops, 1);
});
test('Android 30 requests location; Android 31 also requests BLE permissions', async () => {
  for (const version of [30, 31]) {
    const h = setup({ os: 'android', version });
    await h.api.scanNearbyDevices(() => {}, null, 5);
    assert.equal(h.calls.permissions.join(','), version === 30 ? 'location' : 'location,scan,connect');
  }
  await assert.rejects(setup({ os: 'android', deny: true }).api.scanNearbyDevices(() => {}), /允許本程式/);
});
test('foreground discovery is unfiltered, login diagnostics exist, no result truncation', () => {
  const app = readFileSync(new URL('../mobile/vehicle-tracker/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /免登入藍牙檢測/);
  assert.match(app, /await scanNearbyDevices\(setNearby\)/);
  assert.doesNotMatch(app, /nearby\.slice/);
  assert.match(app, /Date\.now\(\) - lastScanAt > 60_000/);
});
