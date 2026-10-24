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
    return new SealedData(Buffer.from(iv, 'base64'), Buffer.from(body, 'base64'), Buffer.from(tag, 'base64'));
  }
  async iv() { return this.nonce.toString('base64'); }
  async ciphertext() { return this.body.toString('base64'); }
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
  '@react-native-async-storage/async-storage': asyncStorage,
  'expo-crypto': cryptoMock,
  'expo-secure-store': secureStore,
}).encryptedStorage;
const storage = loadTs('src/storage.ts', {
  '@react-native-async-storage/async-storage': asyncStorage,
  './encrypted-storage': { encryptedStorage },
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
