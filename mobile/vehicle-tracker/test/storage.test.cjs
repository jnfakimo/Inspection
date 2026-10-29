const assert = require('node:assert/strict');
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const disk = new Map();
const keychain = new Map();
const asyncStorage = {
  async getItem(key) { return disk.get(key) ?? null; },
  async setItem(key, value) { disk.set(key, value); },
  async removeItem(key) { disk.delete(key); },
  async multiRemove(keys) { keys.forEach(key => disk.delete(key)); },
  async getAllKeys() { return [...disk.keys()]; },
};
const secureStore = {
  async getItemAsync(key) { return keychain.get(key) ?? null; },
  async setItemAsync(key, value) { keychain.set(key, value); },
};
class EncryptionKey {
  constructor(bytes) { this.bytes = bytes; }
  static async generate() { return new EncryptionKey(randomBytes(32)); }
  static async import(value) { return new EncryptionKey(Buffer.from(value, 'base64')); }
  async encoded() { return this.bytes.toString('base64'); }
}
class SealedData {
  constructor(iv, ciphertext, tag) { Object.assign(this, { nonce: iv, body: ciphertext, authTag: tag }); }
  static fromParts(iv, body, tag) {
    // Match Android's actual ByteArray/Int bridge, not its broader TypeScript declaration.
    assert.ok(tag instanceof Uint8Array, 'Android requires the separate GCM tag as bytes');
    return new SealedData(Buffer.from(iv, 'base64'), Buffer.from(body, 'base64'), Buffer.from(tag, 'base64'));
  }
  static fromCombined(bytes, { ivLength, tagLength }) {
    assert.ok(bytes instanceof Uint8Array, 'Android combined payload must be bytes');
    return new SealedData(Buffer.from(bytes.slice(0, ivLength)), Buffer.from(bytes.slice(ivLength, -tagLength)), Buffer.from(bytes.slice(-tagLength)));
  }
  async iv() { return this.nonce.toString('base64'); }
  async ciphertext(options) { return options?.encoding === 'base64' ? this.body.toString('base64') : Uint8Array.from(this.body); }
  async tag() { return this.authTag.toString('base64'); }
}
const cryptoMock = {
  AESEncryptionKey: EncryptionKey,
  AESSealedData: SealedData,
  randomUUID,
  async aesEncryptAsync(bytes, key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
    return new SealedData(iv, Buffer.concat([cipher.update(bytes), cipher.final()]), cipher.getAuthTag());
  },
  async aesDecryptAsync(sealed, key) {
    const decipher = createDecipheriv('aes-256-gcm', key.bytes, sealed.nonce);
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.body), decipher.final()]);
  },
};
function loadTs(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const source = readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = id => id in mocks ? mocks[id] : originalRequire(id);
  compiled._compile(output, filename);
  return compiled.exports;
}
const encryptedStorage = loadTs('src/encrypted-storage.ts', {
  './native-storage-lock': { withStorageCoordinator: operation => operation(false) },
  '@react-native-async-storage/async-storage': asyncStorage,
  'expo-crypto': cryptoMock,
  'expo-secure-store': secureStore,
}).encryptedStorage;
const storage = loadTs('src/storage.ts', {
  '@react-native-async-storage/async-storage': asyncStorage,
  './encrypted-storage': { encryptedStorage },
});

// Each load has its own JS locks and key cache, but shares the persisted adapter.
function independentEncryptedStore(adapter = asyncStorage, coordinator = operation => operation(false)) {
  return loadTs('src/encrypted-storage.ts', {
    './native-storage-lock': { withStorageCoordinator: coordinator },
    '@react-native-async-storage/async-storage': adapter,
    'expo-crypto': cryptoMock,
    'expo-secure-store': secureStore,
  }).encryptedStorage;
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function serialCoordinator() {
  let tail = Promise.resolve();
  return operation => {
    const current = tail.then(() => operation(true));
    tail = current.catch(() => undefined);
    return current;
  };
}
const orphanName = key => `encrypted_v1:${key}:chunk:${randomUUID()}:0`;

test('coordinated collection removes only owned unreferenced chunks and preserves committed ciphertext', async () => {
  disk.clear();
  const store = independentEncryptedStore(asyncStorage, serialCoordinator());
  const key = 'gc-owned';
  await store.setItem(key, '完整內容'.repeat(60_000));
  const live = JSON.parse(disk.get('encrypted_v1:' + key)).chunks;
  const orphan = orphanName(key);
  const foreign = orphanName('other-account');
  const malformed = `encrypted_v1:${key}:chunk:not-a-generation:0`;
  disk.set(orphan, 'abandoned ciphertext'); disk.set(foreign, 'foreign ciphertext'); disk.set(malformed, 'unknown');
  assert.equal(await store.getItem(key), '完整內容'.repeat(60_000));
  assert.equal(disk.has(orphan), false);
  for (const name of [...live, foreign, malformed]) assert.ok(disk.has(name));
});

test('coordinated collector waits for a paused writer from another module before scanning', async () => {
  disk.clear();
  const coordinate = serialCoordinator(), entered = deferred(), resume = deferred();
  let paused = false, scans = 0;
  const writer = independentEncryptedStore({ ...asyncStorage, async setItem(name, value) {
    await asyncStorage.setItem(name, value);
    if (!paused && name.includes(':chunk:')) { paused = true; entered.resolve(); await resume.promise; }
  } }, coordinate);
  const reader = independentEncryptedStore({ ...asyncStorage, async getAllKeys() {
    scans++; return asyncStorage.getAllKeys();
  } }, coordinate);
  const writing = writer.setItem('gc-paused', '完整新值'.repeat(60_000));
  await entered.promise;
  const reading = reader.getItem('gc-paused');
  try { await new Promise(resolve => setImmediate(resolve)); assert.equal(scans, 0); }
  finally { resume.resolve(); }
  await writing;
  assert.equal(await reading, '完整新值'.repeat(60_000));
  assert.equal(scans, 1);
});

test('coordinated reads and logout recover orphan fragments even without a current index', async () => {
  disk.clear();
  const store = independentEncryptedStore(asyncStorage, serialCoordinator());
  const orphan = orphanName('gc-empty'); disk.set(orphan, 'ciphertext');
  assert.equal(await store.getItem('gc-empty'), null); assert.equal(disk.has(orphan), false);
  await store.setItem('gc-empty', '舊'.repeat(60_000));
  disk.set(orphan, 'ciphertext');
  await store.removeItem('gc-empty');
  assert.equal([...disk.keys()].filter(name => name.startsWith('encrypted_v1:gc-empty')).length, 0);
});

test('invalid manifest or failed authentication never triggers orphan collection', async () => {
  disk.clear();
  const store = independentEncryptedStore(asyncStorage, serialCoordinator());
  const key = 'gc-invalid', indexKey = 'encrypted_v1:' + key, orphan = orphanName(key);
  disk.set(indexKey, '{"chunks":["foreign-key"]}'); disk.set(orphan, 'ciphertext');
  await assert.rejects(store.getItem(key)); assert.ok(disk.has(orphan));
  disk.delete(indexKey); await store.setItem(key, 'valid');
  disk.set(orphan, 'ciphertext');
  const record = JSON.parse(disk.get(indexKey).slice('encrypted_v1:'.length));
  record.tag = randomBytes(16).toString('base64'); disk.set(indexKey, 'encrypted_v1:' + JSON.stringify(record));
  await assert.rejects(store.getItem(key)); assert.ok(disk.has(orphan));
});

test('interrupted cleanup is idempotent and does not remove live chunks', async () => {
  disk.clear();
  const key = 'gc-cleanup-error';
  const normal = independentEncryptedStore(asyncStorage, serialCoordinator());
  await normal.setItem(key, '資料'.repeat(60_000));
  const a = orphanName(key), b = orphanName(key); disk.set(a, 'a'); disk.set(b, 'b');
  const failing = independentEncryptedStore({ ...asyncStorage, async multiRemove(names) {
    disk.delete(names[0]); throw new Error('isolated cleanup interrupted');
  } }, serialCoordinator());
  await assert.rejects(failing.getItem(key), /cleanup interrupted/);
  assert.equal(await normal.getItem(key), '資料'.repeat(60_000));
  assert.equal(disk.has(a), false); assert.equal(disk.has(b), false);
});

test('platforms without verified native coordination preserve orphan chunks', async () => {
  disk.clear();
  const key = 'gc-unsupported', orphan = orphanName(key);
  await encryptedStorage.setItem(key, '可讀'); disk.set(orphan, 'ciphertext');
  assert.equal(await encryptedStorage.getItem(key), '可讀'); assert.ok(disk.has(orphan));
});

test('native coordinator fails closed on missing module and always releases after operation failure', async () => {
  const missing = loadTs('src/native-storage-lock.ts', {
    expo: { requireOptionalNativeModule: () => null }, 'react-native': { Platform: { OS: 'android' } },
  });
  let called = false;
  await assert.rejects(missing.withStorageCoordinator(async () => { called = true; }), /原生儲存協調/);
  assert.equal(called, false);
  let released = 0, acquired = 0;
  const native = loadTs('src/native-storage-lock.ts', {
    expo: { requireOptionalNativeModule: () => ({ protocolVersion: 1, async acquire() { return String(++acquired); }, release() { released++; } }) },
    'react-native': { Platform: { OS: 'android' } },
  });
  await assert.rejects(native.withStorageCoordinator(async canCollect => { assert.equal(canCollect, true); throw new Error('injected'); }), /injected/);
  assert.equal(await native.withStorageCoordinator(async () => 7), 7);
  assert.equal(acquired, 2); assert.equal(released, 2);
});

test('native lock acquisition failure never enters storage; iOS never opts into collection', async () => {
  let entered = false;
  const busy = loadTs('src/native-storage-lock.ts', {
    expo: { requireOptionalNativeModule: () => ({ protocolVersion: 1, async acquire() { throw new Error('busy'); }, release() { throw new Error('not acquired'); } }) },
    'react-native': { Platform: { OS: 'android' } },
  });
  await assert.rejects(busy.withStorageCoordinator(async () => { entered = true; }), /busy/);
  assert.equal(entered, false);
  const ios = loadTs('src/native-storage-lock.ts', {
    expo: { requireOptionalNativeModule: () => null }, 'react-native': { Platform: { OS: 'ios' } },
  });
  assert.equal(await ios.withStorageCoordinator(async canCollect => canCollect), false);
});

test('independent cold key caches share one persisted encryption key under the coordinator', async () => {
  const saved = [...keychain]; disk.clear(); keychain.clear();
  try {
    const coordinate = serialCoordinator();
    const first = independentEncryptedStore(asyncStorage, coordinate), second = independentEncryptedStore(asyncStorage, coordinate);
    await Promise.all([first.setItem('gc-key-a', '甲'), second.setItem('gc-key-b', '乙')]);
    const fresh = independentEncryptedStore(asyncStorage, coordinate);
    assert.equal(await fresh.getItem('gc-key-a'), '甲');
    assert.equal(await fresh.getItem('gc-key-b'), '乙');
    assert.equal(keychain.size, 1);
  } finally { disk.clear(); keychain.clear(); for (const [name, value] of saved) keychain.set(name, value); }
});

test('independent reader retries when committed replacement removes its previously observed chunks', async () => {
  disk.clear();
  const key = 'gc-reader-replacement';
  await encryptedStorage.setItem(key, '舊'.repeat(60_000));
  const entered = deferred(), resume = deferred();
  let paused = false;
  const reader = independentEncryptedStore({ ...asyncStorage, async getItem(name) {
    if (!paused && name.includes(':chunk:')) {
      paused = true; entered.resolve(); await resume.promise;
    }
    return asyncStorage.getItem(name);
  } });
  const reading = reader.getItem(key);
  try {
    await entered.promise;
    await encryptedStorage.setItem(key, '完整新資料');
  } finally { resume.resolve(); }
  assert.equal(await reading, '完整新資料');
});

test('independent reader observes removal instead of reporting stale missing chunks', async () => {
  disk.clear();
  const key = 'gc-reader-logout';
  await encryptedStorage.setItem(key, '舊'.repeat(60_000));
  const entered = deferred(), resume = deferred();
  let paused = false;
  const reader = independentEncryptedStore({ ...asyncStorage, async getItem(name) {
    if (!paused && name.includes(':chunk:')) {
      paused = true; entered.resolve(); await resume.promise;
    }
    return asyncStorage.getItem(name);
  } });
  const reading = reader.getItem(key);
  try {
    await entered.promise;
    await encryptedStorage.removeItem(key);
  } finally { resume.resolve(); }
  assert.equal(await reading, null);
});

for (const replacement of ['chunked', 'tampered', 'invalid-index']) {
  test(`independent reader authenticates and validates replacement after retry: ${replacement}`, async () => {
    disk.clear();
    const key = 'gc-retry-validation', indexKey = 'encrypted_v1:' + key;
    await encryptedStorage.setItem(key, '舊'.repeat(60_000));
    const entered = deferred(), resume = deferred();
    let paused = false;
    const reader = independentEncryptedStore({ ...asyncStorage, async getItem(name) {
      if (!paused && name.includes(':chunk:')) {
        paused = true; entered.resolve(); await resume.promise;
      }
      return asyncStorage.getItem(name);
    } });
    const reading = reader.getItem(key);
    const checked = replacement === 'chunked'
      ? reading.then(value => assert.equal(value, '新'.repeat(60_000)))
      : assert.rejects(reading);
    try {
      await entered.promise;
      await encryptedStorage.setItem(key, replacement === 'chunked' ? '新'.repeat(60_000) : '新值');
      if (replacement === 'tampered') {
        const record = JSON.parse(disk.get(indexKey).slice('encrypted_v1:'.length));
        record.tag = randomBytes(16).toString('base64');
        disk.set(indexKey, 'encrypted_v1:' + JSON.stringify(record));
      }
      if (replacement === 'invalid-index') disk.set(indexKey, '{"chunks":["other-account-record"]}');
      disk.set('other-account-record', '不可刪除');
    } finally { resume.resolve(); }
    await checked;
    assert.equal(disk.get('other-account-record'), '不可刪除');
  });
}

test('missing chunks under an unchanged index remain an error and preserve legacy data', async () => {
  disk.clear();
  const key = 'gc-unchanged-corruption';
  await encryptedStorage.setItem(key, '舊'.repeat(60_000));
  const manifest = JSON.parse(disk.get('encrypted_v1:' + key));
  disk.delete(manifest.chunks[0]);
  disk.set(key, '不可悄悄回退的舊明文');
  await assert.rejects(independentEncryptedStore().getItem(key), /加密資料不完整/);
  assert.equal(disk.get(key), '不可悄悄回退的舊明文');
});

test('index recheck storage failure propagates without deleting any further data', async () => {
  disk.clear();
  const key = 'gc-recheck-error', indexKey = 'encrypted_v1:' + key;
  await encryptedStorage.setItem(key, '舊'.repeat(60_000));
  disk.delete(JSON.parse(disk.get(indexKey)).chunks[0]);
  const before = [...disk];
  let reads = 0;
  const reader = independentEncryptedStore({ ...asyncStorage, async getItem(name) {
    if (name === indexKey && ++reads === 2) throw new Error('isolated storage unavailable');
    return asyncStorage.getItem(name);
  } });
  await assert.rejects(reader.getItem(key), /isolated storage unavailable/);
  assert.deepEqual([...disk], before);
});

test('continuously changing missing generations have bounded retries', async () => {
  disk.clear();
  const key = 'gc-churn', indexKey = 'encrypted_v1:' + key;
  let indexReads = 0;
  const reader = independentEncryptedStore({ ...asyncStorage, async getItem(name) {
    if (name === indexKey) return JSON.stringify({ chunks: [indexKey + ':chunk:' + (++indexReads) + ':0'] });
    return null;
  } });
  await assert.rejects(reader.getItem(key), /讀取期間持續變更/);
  assert.equal(indexReads, 6, 'three attempts, each with an index read and recheck');
  assert.equal(disk.size, 0);
});

// Deliberately unsafe collectors below exist ONLY as counterexamples in this test.
// Absence from an index (even twice or for a long time) is not deletion authority.
for (const policy of ['snapshot', 'double-check', 'age-threshold', 'preserve']) {
  test(`orphan cleanup safety: ${policy} while another runtime has an unpublished chunk`, async () => {
    disk.clear();
    const key = 'gc-in-flight', indexKey = 'encrypted_v1:' + key;
    await encryptedStorage.setItem(key, '舊值'); // Seed keychain before concurrent access.
    const entered = deferred(), resume = deferred();
    let paused = false, clock = 0, chunkWrittenAt;
    const writer = independentEncryptedStore({ ...asyncStorage, async setItem(name, value) {
      await asyncStorage.setItem(name, value);
      if (!paused && name.startsWith(indexKey + ':chunk:')) {
        paused = true; chunkWrittenAt = clock; entered.resolve(); await resume.promise;
      }
    } });
    const writing = writer.setItem(key, '完整新資料'.repeat(60_000));
    try {
      await entered.promise;
      const index = await asyncStorage.getItem(indexKey);
      const candidates = [...disk.keys()].filter(name => name.startsWith(indexKey + ':chunk:'));
      assert.equal(candidates.length, 1);
      if (policy === 'double-check') assert.equal(await asyncStorage.getItem(indexKey), index);
      if (policy === 'age-threshold') {
        clock += 366 * 24 * 60 * 60 * 1000;
        assert.ok(clock - chunkWrittenAt > 30 * 24 * 60 * 60 * 1000);
      }
      if (policy !== 'preserve') await asyncStorage.multiRemove(candidates);
    } finally { resume.resolve(); }
    await writing;
    if (policy === 'preserve') assert.equal(await independentEncryptedStore().getItem(key), '完整新資料'.repeat(60_000));
    else await assert.rejects(independentEncryptedStore().getItem(key), /加密資料不完整/);
  });
}

test('index recheck immediately before sweep still races with publication in another runtime', async () => {
  disk.clear();
  const key = 'gc-publication-race', indexKey = 'encrypted_v1:' + key;
  await encryptedStorage.setItem(key, '舊值');
  const ready = deferred(), publish = deferred();
  const writer = independentEncryptedStore({ ...asyncStorage, async setItem(name, value) {
    if (name === indexKey) { ready.resolve(); await publish.promise; }
    return asyncStorage.setItem(name, value);
  } });
  const writing = writer.setItem(key, '新'.repeat(60_000));
  let candidates;
  try {
    await ready.promise;
    const index = await asyncStorage.getItem(indexKey);
    candidates = [...disk.keys()].filter(name => name.startsWith(indexKey + ':chunk:'));
    assert.ok(candidates.length > 1);
    assert.equal(await asyncStorage.getItem(indexKey), index);
  } finally { publish.resolve(); }
  await writing; // Publication happens in the gap after the check, before removal.
  await asyncStorage.multiRemove(candidates);
  await assert.rejects(independentEncryptedStore().getItem(key), /加密資料不完整/);
});

test('legacy auth and location data migrate only after encrypted write', async () => {
  disk.clear();
  await asyncStorage.setItem('sb-session', '{"access_token":"secret-token","label":"臺北農產"}');
  assert.match(await encryptedStorage.getItem('sb-session'), /secret-token/);
  assert.match(await encryptedStorage.getItem('sb-session'), /臺北農產/);
  assert.equal(disk.has('sb-session'), false);
  const ciphertext = disk.get('encrypted_v1:sb-session');
  assert.ok(ciphertext && !ciphertext.includes('secret-token'));
  assert.ok(keychain.get('vehicle_tracker_storage_key_v1'));
  assert.match(await encryptedStorage.getItem('sb-session'), /secret-token/);
});

test('tampered ciphertext fails closed', async () => {
  await encryptedStorage.setItem('tamper', 'sensitive');
  const key = 'encrypted_v1:tamper';
  const record = JSON.parse(disk.get(key).slice('encrypted_v1:'.length));
  record.tag = randomBytes(16).toString('base64');
  disk.set(key, 'encrypted_v1:' + JSON.stringify(record));
  await assert.rejects(encryptedStorage.getItem('tamper'));
});

test('Android legacy numeric ciphertext stays readable and new writes use Base64 strings', async () => {
  await encryptedStorage.setItem('android-legacy', '既有原生密文');
  const key = 'encrypted_v1:android-legacy';
  const record = JSON.parse(disk.get(key).slice('encrypted_v1:'.length));
  assert.equal(typeof record.ciphertext, 'string');
  record.ciphertext = JSON.parse(JSON.stringify(Uint8Array.from(Buffer.from(record.ciphertext, 'base64'))));
  disk.set(key, 'encrypted_v1:' + JSON.stringify(record));
  assert.equal(await encryptedStorage.getItem('android-legacy'), '既有原生密文');
  delete record.ciphertext['0'];
  disk.set(key, 'encrypted_v1:' + JSON.stringify(record));
  await assert.rejects(encryptedStorage.getItem('android-legacy'), /格式不正確/);
});

test('reading committed ciphertext resumes interrupted legacy cleanup only after successful decryption', async () => {
  await encryptedStorage.setItem('interrupted-migration', 'encrypted value');
  disk.set('interrupted-migration', 'leftover plaintext');
  assert.equal(await encryptedStorage.getItem('interrupted-migration'), 'encrypted value');
  assert.equal(disk.has('interrupted-migration'), false);
  disk.set('interrupted-migration', 'preserve until ciphertext validated');
  disk.set('encrypted_v1:interrupted-migration', 'encrypted_v1:broken');
  await assert.rejects(encryptedStorage.getItem('interrupted-migration'));
  assert.equal(disk.get('interrupted-migration'), 'preserve until ciphertext validated');
});

test('large encrypted queue uses atomic chunks and keeps the last valid index on write failure', async () => {
  await encryptedStorage.setItem('large', '甲'.repeat(100_000));
  assert.equal((await encryptedStorage.getItem('large')).length, 100_000);
  const originalIndex = disk.get('encrypted_v1:large');
  assert.ok(JSON.parse(originalIndex).chunks.length > 1);
  const originalSetItem = asyncStorage.setItem;
  asyncStorage.setItem = async (key, value) => {
    if (key.includes(':chunk:')) throw new Error('disk full');
    return originalSetItem(key, value);
  };
  try {
    await assert.rejects(encryptedStorage.setItem('large', '乙'.repeat(100_000)), /disk full/);
  } finally { asyncStorage.setItem = originalSetItem; }
  assert.equal(disk.get('encrypted_v1:large'), originalIndex);
  assert.equal(await encryptedStorage.getItem('large'), '甲'.repeat(100_000));
  await encryptedStorage.setItem('large', 'small');
  assert.equal(await encryptedStorage.getItem('large'), 'small');
  for (const key of JSON.parse(originalIndex).chunks) assert.equal(disk.has(key), false);
});

test('queue encrypts GPS data, expires old points and preserves concurrent additions', async () => {
  disk.clear();
  const fresh = () => ({ client_event_id: randomBytes(8).toString('hex'), recorded_at: new Date().toISOString(), latitude: 25.1 });
  const old = { ...fresh(), recorded_at: new Date(Date.now() - 8 * 86400_000).toISOString() };
  await Promise.all([storage.enqueueLocationPoints([old, fresh()]), storage.enqueueLocationPoints([fresh()])]);
  const points = await storage.readLocationQueue();
  assert.equal(points.length, 2);
  const encrypted = disk.get('encrypted_v1:vehicle_tracking_location_queue_v1');
  assert.ok(encrypted && !encrypted.includes('25.1'));
  await storage.removeQueuedLocationPoints([points[0].client_event_id]);
  assert.equal((await storage.readLocationQueue()).length, 1);
});

test('partial chunk and index write failures leave no new orphan chunks', async () => {
  for (const failure of ['second-chunk', 'index']) {
    disk.clear();
    await encryptedStorage.setItem('atomic', 'old session');
    const before = new Map(disk);
    const original = asyncStorage.setItem;
    let chunks = 0;
    asyncStorage.setItem = async (key, value) => {
      if (key.includes(':chunk:') && ++chunks === 2 && failure === 'second-chunk') throw new Error('disk full');
      if (key === 'encrypted_v1:atomic' && failure === 'index') throw new Error('index unavailable');
      return original(key, value);
    };
    try { await assert.rejects(encryptedStorage.setItem('atomic', '甲'.repeat(100_000))); }
    finally { asyncStorage.setItem = original; }
    assert.deepEqual(disk, before, failure);
    assert.equal(await encryptedStorage.getItem('atomic'), 'old session');
  }
});

test('logout removes corrupt auth index and legacy value without following foreign chunk references', async () => {
  disk.clear();
  for (const corrupt of ['{broken', JSON.stringify({ chunks: ['unrelated-secret'] })]) {
    disk.set('encrypted_v1:logout', corrupt);
    disk.set('logout', 'legacy session');
    disk.set('unrelated-secret', 'keep');
    await encryptedStorage.removeItem('logout');
    assert.equal(disk.has('encrypted_v1:logout'), false);
    assert.equal(disk.has('logout'), false);
    assert.equal(disk.get('unrelated-secret'), 'keep');
  }
});

test('an index error reported after commit never deletes the now-published chunks', async () => {
  disk.clear();
  await encryptedStorage.setItem('ambiguous', 'old');
  const original = asyncStorage.setItem;
  asyncStorage.setItem = async (key, value) => {
    await original(key, value);
    if (key === 'encrypted_v1:ambiguous') throw new Error('native acknowledgement lost');
  };
  try { await assert.rejects(encryptedStorage.setItem('ambiguous', '甲'.repeat(100_000)), /acknowledgement/); }
  finally { asyncStorage.setItem = original; }
  assert.equal(await encryptedStorage.getItem('ambiguous'), '甲'.repeat(100_000));
  await encryptedStorage.removeItem('ambiguous');
  assert.equal(disk.size, 0);
});

test('logout waits for an earlier in-flight write and does not resurrect the session', async () => {
  disk.clear();
  const original = asyncStorage.setItem;
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  asyncStorage.setItem = async (key, value) => {
    if (key === 'encrypted_v1:race') { entered(); await gate; }
    return original(key, value);
  };
  try {
    const writing = encryptedStorage.setItem('race', 'session');
    await started;
    const removing = encryptedStorage.removeItem('race');
    // Let an unlocked removal finish while the write is suspended.
    await new Promise(resolve => setImmediate(resolve));
    release();
    await Promise.all([writing, removing]);
    assert.equal(await encryptedStorage.getItem('race'), null);
  } finally { release(); asyncStorage.setItem = original; }
});

test('temporary keychain failure can retry and a lost key never returns ciphertext as plaintext', async () => {
  disk.clear();
  await encryptedStorage.setItem('key-loss', 'private location');
  const before = disk.get('encrypted_v1:key-loss');
  let unavailable = true;
  const fresh = () => loadTs('src/encrypted-storage.ts', {
    './native-storage-lock': { withStorageCoordinator: operation => operation(false) },
    '@react-native-async-storage/async-storage': asyncStorage,
    'expo-crypto': cryptoMock,
    'expo-secure-store': {
      ...secureStore,
      async getItemAsync(key) {
        if (unavailable) throw new Error('keychain locked');
        return secureStore.getItemAsync(key);
      },
    },
  }).encryptedStorage;
  const restarted = fresh();
  await assert.rejects(restarted.getItem('key-loss'), /keychain locked/);
  assert.equal(disk.get('encrypted_v1:key-loss'), before);
  unavailable = false;
  assert.equal(await restarted.getItem('key-loss'), 'private location');
  const savedKeys = new Map(keychain);
  keychain.clear();
  try {
    await assert.rejects(fresh().getItem('key-loss'));
    assert.equal(disk.get('encrypted_v1:key-loss'), before);
  } finally {
    keychain.clear();
    for (const [key, value] of savedKeys) keychain.set(key, value);
  }
});

test('offline retry keeps unacknowledged points and points queued during upload', async () => {
  disk.clear();
  const point = id => ({ client_event_id: id, session_id: 's', recorded_by: 'driver', recorded_at: new Date().toISOString(), latitude: 25.1 });
  await storage.enqueueLocationPoints(Array.from({ length: 101 }, (_, i) => point(`point-${i}`)));
  let calls = 0;
  let fail = true;
  const accepted = new Set();
  const sync = loadTs('src/sync.ts', {
    './storage': storage,
    './supabase': { supabase: {
      auth: {
        async getUser() { return { data: { user: { id: 'auth-driver' } }, error: null }; },
        async getSession() { return { data: { session: { user: { id: 'auth-driver' } } }, error: null }; },
      },
      from(table) {
      if (table === 'vehicle_tracking_sessions') {
        const query = { select() { return query; }, eq() { return query; }, then(resolve) { return Promise.resolve({ data: [{ session_id: 's' }], error: null }).then(resolve); } };
        return query;
      }
      if (table === 'users') {
        const query = { select() { return query; }, eq() { return query; }, async single() { return { data: { user_id: 'driver' }, error: null }; } };
        return query;
      }
      assert.equal(table, 'vehicle_location_points');
      return { async upsert(batch, options) {
        assert.deepEqual(options, { onConflict: 'client_event_id', ignoreDuplicates: true });
        calls++;
        if (calls === 1) await storage.enqueueLocationPoints([point('during-upload')]);
        if (calls === 2 && fail) return { error: { message: 'offline' } };
        batch.forEach(row => accepted.add(row.client_event_id));
        return { error: null };
      } };
    } } },
  });
  await assert.rejects(sync.flushLocationQueue(), /已保留/);
  assert.deepEqual((await storage.readLocationQueue()).map(p => p.client_event_id), ['point-100', 'during-upload']);
  fail = false;
  assert.equal(await sync.flushLocationQueue(), 2);
  assert.equal(accepted.size, 102);
  assert.deepEqual(await storage.readLocationQueue(), []);
});

test('background callback persists GPS before offline upload and ignores callbacks after session removal', async () => {
  disk.clear();
  let callback;
  let uploads = 0;
  let bleChecks = 0;
  let permission = 'denied';
  let running = false;
  let starts = 0;
  let stops = 0;
  const background = loadTs('src/background-location.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'expo-crypto': cryptoMock,
    'expo-task-manager': { defineTask(name, handler) { callback = handler; } },
    'expo-location': {
      Accuracy: { High: 4 }, ActivityType: { AutomotiveNavigation: 1 },
      async requestForegroundPermissionsAsync() { return { status: permission }; },
      async requestBackgroundPermissionsAsync() { return { status: permission }; },
      async hasStartedLocationUpdatesAsync() { return running; },
      async startLocationUpdatesAsync() { running = true; starts++; },
      async stopLocationUpdatesAsync() { running = false; stops++; },
    },
    './storage': storage,
    './sync': { async flushLocationQueue() {
      uploads++;
      assert.equal((await storage.readLocationQueue()).length, 1);
      throw new Error('offline');
    } },
    './ble-monitor': { async monitorBlePresence() { bleChecks++; throw new Error('BLE unavailable'); } },
  });
  await assert.rejects(background.startBackgroundTracking(), /必須允許/);
  assert.equal(starts, 0);
  permission = 'granted';
  await background.startBackgroundTracking();
  await background.startBackgroundTracking();
  assert.equal(starts, 1);
  await storage.writeActiveSession({ sessionId: 's', vehicleId: 'v', deviceId: 'd', driverId: 'u' });
  const data = { locations: [{ timestamp: Date.now(), coords: { latitude: 25, longitude: 121, speed: -1, heading: -1, accuracy: 5, altitude: null }, mocked: true }] };
  await callback({ data });
  const [point] = await storage.readLocationQueue();
  assert.equal(point.speed_kmh, 0);
  assert.equal(point.heading_deg, null);
  assert.equal(point.is_mocked, true);
  assert.equal(uploads, 1);
  assert.equal(bleChecks, 1);
  await storage.writeActiveSession(null);
  await callback({ data });
  await callback({ data, error: new Error('native callback error') });
  assert.equal(uploads, 1);
  assert.equal((await storage.readLocationQueue()).length, 1);
  await background.stopBackgroundTracking();
  await background.stopBackgroundTracking();
  assert.equal(stops, 1);
});

test('failed BLE event upload preserves transition for retry and throttles only after success', async () => {
  let state = { lastCheckedAt: 0, presence: 'present' };
  let fail = true;
  let calls = 0;
  const monitor = loadTs('src/ble-monitor.ts', {
    'react-native': { Platform: { OS: 'android' } },
    './ble': { async findRegisteredDevice() { return null; } },
    './storage': { async readBleMonitorState() { return state; }, async writeBleMonitorState(next) { state = next; } },
    './supabase': { supabase: { from(table) {
      assert.equal(table, 'vehicle_tracking_events');
      return { async insert(event) {
        calls++;
        assert.equal(event.event_type, 'ble_disconnected');
        return { error: fail ? new Error('offline') : null };
      } };
    } } },
  });
  const session = { deviceId: 'd', vehicleId: 'v', sessionId: 's', platformIdentifier: 'bound-id' };
  await assert.rejects(monitor.monitorBlePresence(session), /稍後/);
  assert.deepEqual(state, { lastCheckedAt: 0, presence: 'present' });
  fail = false;
  await monitor.monitorBlePresence(session);
  assert.equal(state.presence, 'missing');
  await monitor.monitorBlePresence(session);
  assert.equal(calls, 2);
});

test('BLE identity rejects same-name tags and cancellation holds lock until native cleanup', async () => {
  let scanned;
  let releaseStop;
  let stopStarted;
  let subscriptionsRemoved = 0;
  const started = new Promise(resolve => { scanned = resolve; });
  const stopping = new Promise(resolve => { stopStarted = resolve; });
  const stopGate = new Promise(resolve => { releaseStop = resolve; });
  class FakeManager {
    onStateChange(handler) { handler('on'); return { remove() { subscriptionsRemoved++; } }; }
    async startDeviceScan() { scanned(); }
    async stopDeviceScan() { stopStarted(); await stopGate; }
  }
  const ble = loadTs('src/ble.ts', {
    'react-native': { Platform: { OS: 'ios' }, PermissionsAndroid: {} },
    'react-native-ble-plx': { BleManager: FakeManager, State: { PoweredOn: 'on' } },
  });
  const registered = { advertised_name: 'Tag', service_uuid: 'service', platform_identifiers: { ios: 'bound-id' } };
  assert.equal(ble.matchesRegisteredDevice({ id: 'other-id', name: 'Tag', serviceUuids: ['service'] }, registered), false);
  assert.equal(ble.matchesRegisteredDevice({ id: 'bound-id' }, registered), true);
  const first = ble.scanNearbyDevices(() => {}, 'service');
  const rejected = assert.rejects(first, /取消/);
  try {
    await started;
    ble.stopBleManager();
    await stopping;
    await assert.rejects(ble.scanNearbyDevices(() => {}, 'service'), /正在進行/);
  } finally { releaseStop(); }
  await rejected;
  assert.equal(subscriptionsRemoved, 1);
});
