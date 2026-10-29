// Process-crash adapter, not an emulation of SQLite/Keystore or physical power loss.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const [root, operation, checkpoint = ''] = process.argv.slice(2);
process.on('message', () => {}); // Keep the IPC channel alive at an interruption checkpoint.
const file = path.join(root, 'state.json');
const recordKey = 'crash-record';
const prefix = 'encrypted_v1:';
const payload = version => version === 'short' ? '短資料' : (version === 'old' ? '舊定位' : '新定位').repeat(50_000);
const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => value == null ? null : crypto.createHash('sha256').update(value).digest('hex');
function commit(update) {
  const state = read(); update(state);
  const temp = path.join(root, 'state.next.json');
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, file);
}
async function pause(point) {
  if (point !== checkpoint) return;
  await new Promise(resolve => process.send({ kind: 'checkpoint', point }, resolve));
  // Keep IPC alive; only the parent terminates this process. No cleanup is run.
  await new Promise(() => {});
}
const storage = {
  async getItem(key) { return read().disk[key] ?? null; },
  async setItem(key, value) {
    commit(s => { s.disk[key] = value; });
    if (key.includes(':chunk:')) await pause('chunk-written');
    if (key === prefix + recordKey) await pause('index-published');
  },
  async removeItem(key) { commit(s => { delete s.disk[key]; }); },
  async multiRemove(keys) {
    // One acknowledged adapter operation is atomic; do not invent partial SQLite transactions.
    commit(s => { for (const key of keys) delete s.disk[key]; });
    await pause('record-removed');
  },
};
class Key {
  constructor(bytes) { this.bytes = bytes; }
  static async generate() { return new Key(crypto.randomBytes(32)); }
  static async import(value) { return new Key(Buffer.from(value, 'base64')); }
  async encoded() { return this.bytes.toString('base64'); }
}
class Sealed {
  constructor(iv, body, tag) { Object.assign(this, { nonce: iv, body, authTag: tag }); }
  static fromCombined(value, { ivLength, tagLength }) {
    const bytes = Buffer.from(value);
    return new Sealed(bytes.subarray(0, ivLength), bytes.subarray(ivLength, -tagLength), bytes.subarray(-tagLength));
  }
  async iv() { return this.nonce.toString('base64'); }
  async ciphertext() { return Uint8Array.from(this.body); }
  async tag() { return this.authTag.toString('base64'); }
}
const mocks = {
  '@react-native-async-storage/async-storage': storage,
  'expo-secure-store': {
    async getItemAsync(key) { return read().keys[key] ?? null; },
    async setItemAsync(key, value) { commit(s => { s.keys[key] = value; }); await pause('key-written'); },
  },
  'expo-crypto': {
    AESEncryptionKey: Key, AESSealedData: Sealed, randomUUID: crypto.randomUUID,
    async aesEncryptAsync(bytes, key) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key.bytes, iv);
      return new Sealed(iv, Buffer.concat([cipher.update(bytes), cipher.final()]), cipher.getAuthTag());
    },
    async aesDecryptAsync(sealed, key) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key.bytes, sealed.nonce);
      decipher.setAuthTag(sealed.authTag);
      return Buffer.concat([decipher.update(sealed.body), decipher.final()]);
    },
  },
};
const filename = path.resolve(__dirname, '../../src/encrypted-storage.ts');
const loaded = new Module(filename, module);
loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
const originalRequire = loaded.require.bind(loaded);
loaded.require = id => id in mocks ? mocks[id] : originalRequire(id);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const encrypted = loaded.exports.encryptedStorage;
(async () => {
  if (operation === 'remove') await encrypted.removeItem(recordKey);
  else if (operation !== 'read') await encrypted.setItem(recordKey, payload(operation));
  const value = await encrypted.getItem(recordKey);
  const state = read(), index = state.disk[prefix + recordKey];
  const referenced = index && !index.startsWith(prefix) ? JSON.parse(index).chunks : [];
  const chunks = Object.keys(state.disk).filter(key => key.includes(':chunk:'));
  process.send({ kind: 'result', digest: hash(value), legacyPresent: recordKey in state.disk,
    unreferencedChunks: chunks.filter(key => !referenced.includes(key)).length,
    keyDigest: hash(state.keys.vehicle_tracker_storage_key_v1 ?? null) });
  process.disconnect();
})().catch(() => { process.send({ kind: 'error' }); process.disconnect(); process.exitCode = 1; });
