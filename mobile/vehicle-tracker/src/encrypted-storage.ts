import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fromByteArray, toByteArray } from 'base64-js';
import { withStorageCoordinator } from './native-storage-lock';

const KEY_NAME = 'vehicle_tracker_storage_key_v1';
const PREFIX = 'encrypted_v1:';
const CHUNK_SIZE = 200_000;
const MAX_CHUNKS = 128;
let keyPromise: Promise<AESEncryptionKey> | undefined;
const operations = new Map<string, Promise<void>>();

function withKeyLock<T>(key: string, operation: (canCollect: boolean) => Promise<T>): Promise<T> {
  const result = (operations.get(key) ?? Promise.resolve()).then(() => withStorageCoordinator(operation));
  const tail = result.then(() => undefined, () => undefined);
  operations.set(key, tail);
  void tail.then(() => { if (operations.get(key) === tail) operations.delete(key); });
  return result;
}

async function collectUnreferencedChunks(key: string): Promise<void> {
  // Called only while holding the Android process-wide AND OS-wide lock. Never use age/TTL.
  const indexKey = PREFIX + key;
  const chunkPrefix = `${indexKey}:chunk:`;
  const ownsChunk = (name: string) => name.startsWith(chunkPrefix)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(?:0|[1-9][0-9]{0,2})$/i.test(name.slice(chunkPrefix.length))
    && Number(name.slice(name.lastIndexOf(':') + 1)) < MAX_CHUNKS;
  const allKeys = await AsyncStorage.getAllKeys();
  const stored = await AsyncStorage.getItem(indexKey);
  // Android's getItem normalizes an empty string to null; key presence distinguishes corruption.
  if (stored === '' || (stored === null && allKeys.includes(indexKey))) throw new Error('加密資料索引無法安全清理');
  const referenced = chunkKeys(key, stored);
  // An unfamiliar/corrupt manifest cannot grant deletion authority.
  if (!referenced.every(ownsChunk) || new Set(referenced).size !== referenced.length) {
    throw new Error('加密資料索引無法安全清理');
  }
  const live = new Set(referenced);
  const candidates = allKeys.filter(name => ownsChunk(name) && !live.has(name));
  for (let offset = 0; offset < candidates.length; offset += MAX_CHUNKS) {
    await AsyncStorage.multiRemove(candidates.slice(offset, offset + MAX_CHUNKS));
  }
}

function chunkKeys(key: string, stored: string | null): string[] {
  if (!stored || stored.startsWith(PREFIX)) return [];
  const manifest: unknown = JSON.parse(stored);
  if (!manifest || typeof manifest !== 'object' || !('chunks' in manifest) || !Array.isArray(manifest.chunks)) {
    throw new Error('加密資料索引不正確');
  }
  const keys = manifest.chunks;
  if (keys.length < 1 || keys.length > MAX_CHUNKS || !keys.every((item): item is string => typeof item === 'string' && item.startsWith(`${PREFIX}${key}:chunk:`))) {
    throw new Error('加密資料索引不正確');
  }
  return keys;
}

async function readEncrypted(key: string, coordinated: boolean): Promise<string | null> {
  const indexKey = PREFIX + key;
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = await AsyncStorage.getItem(indexKey);
    if (!stored) {
      if (coordinated && (await AsyncStorage.getAllKeys()).includes(indexKey)) {
        throw new Error('加密資料索引無法安全清理');
      }
      return null;
    }
    if (stored.startsWith(PREFIX)) return stored;
    const parts = await Promise.all(chunkKeys(key, stored).map(part => AsyncStorage.getItem(part)));
    if (parts.every(part => part !== null)) return parts.join('');
    // A different JS runtime may have replaced the index and reclaimed its old chunks.
    // Retry only a changed generation; actual corruption and storage errors still fail closed.
    if (await AsyncStorage.getItem(indexKey) === stored) throw new Error('加密資料不完整');
  }
  throw new Error('加密資料在讀取期間持續變更，請重試');
}

async function encryptionKey(): Promise<AESEncryptionKey> {
  keyPromise ??= (async () => {
    const saved = await SecureStore.getItemAsync(KEY_NAME);
    if (saved) return AESEncryptionKey.import(saved, 'base64');
    const generated = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(KEY_NAME, await generated.encoded('base64'));
    return generated;
  })().catch(error => {
    keyPromise = undefined;
    throw error;
  });
  return keyPromise;
}

async function encrypt(value: string): Promise<string> {
  // Hermes does not guarantee TextEncoder/TextDecoder globals on every supported device.
  const binary = encodeURIComponent(value).replace(/%([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const sealed = await aesEncryptAsync(Uint8Array.from(binary, char => char.charCodeAt(0)), await encryptionKey());
  return PREFIX + JSON.stringify({
    iv: await sealed.iv('base64'),
    // Android uses outputFormat internally, not the TS/web encoding option. Request bytes explicitly.
    ciphertext: fromByteArray(await sealed.ciphertext()),
    tag: await sealed.tag('base64'),
  });
}

async function decrypt(value: string): Promise<string> {
  if (!value.startsWith(PREFIX)) throw new Error('加密資料格式不正確');
  const { iv, ciphertext, tag } = JSON.parse(value.slice(PREFIX.length));
  // Android's fromParts bridge rejects inputs accepted by its TS declaration.
  // Reconstruct the authenticated binary payload while preserving the existing stored format.
  if (typeof tag !== 'string' || tag.length !== 24) throw new Error('加密驗證標籤格式不正確');
  const authTag = toByteArray(tag);
  if (authTag.length !== 16) throw new Error('加密驗證標籤長度不正確');
  if (typeof iv !== 'string') throw new Error('加密資料格式不正確');
  const nonce = toByteArray(iv);
  let body: Uint8Array;
  if (typeof ciphertext === 'string') body = toByteArray(ciphertext);
  else {
    // Earlier Android writes serialized a Uint8Array as a numeric-key object. Preserve readable data.
    if (!ciphertext || typeof ciphertext !== 'object' || Array.isArray(ciphertext)) throw new Error('加密資料格式不正確');
    const keys = Object.keys(ciphertext);
    if (!keys.every((key, index) => key === String(index) && Number.isInteger(ciphertext[key]) && ciphertext[key] >= 0 && ciphertext[key] <= 255)) {
      throw new Error('加密資料格式不正確');
    }
    body = Uint8Array.from(keys.map(key => ciphertext[key]));
  }
  const combined = new Uint8Array(nonce.length + body.length + authTag.length);
  combined.set(nonce);
  combined.set(body, nonce.length);
  combined.set(authTag, nonce.length + body.length);
  const sealed = AESSealedData.fromCombined(combined, { ivLength: nonce.length, tagLength: authTag.length });
  const plaintext = await aesDecryptAsync(sealed, await encryptionKey());
  let encoded = '';
  for (const byte of plaintext) encoded += `%${byte.toString(16).padStart(2, '0')}`;
  return decodeURIComponent(encoded);
}

async function setItemUnlocked(key: string, value: string): Promise<void> {
  const indexKey = PREFIX + key;
  const previous = chunkKeys(key, await AsyncStorage.getItem(indexKey));
  const ciphertext = await encrypt(value);
  if (ciphertext.length <= CHUNK_SIZE) {
    await AsyncStorage.setItem(indexKey, ciphertext);
  } else {
    const count = Math.ceil(ciphertext.length / CHUNK_SIZE);
    if (count > MAX_CHUNKS) throw new Error('加密資料超出裝置儲存上限');
    const generation = randomUUID();
    const parts = Array.from({ length: count }, (_, index) => `${indexKey}:chunk:${generation}:${index}`);
    const manifest = JSON.stringify({ chunks: parts });
    try {
      for (let index = 0; index < count; index++) {
        await AsyncStorage.setItem(parts[index]!, ciphertext.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
      }
      // Publish only complete generations; readers and logout use the same per-key lock.
      await AsyncStorage.setItem(indexKey, manifest);
    } catch (error) {
      // A native error may arrive after commit. Delete only a generation known to be unpublished.
      const current = await AsyncStorage.getItem(indexKey).catch(() => undefined);
      if (current !== undefined && current !== manifest) {
        await AsyncStorage.multiRemove(parts).catch(() => undefined);
      }
      throw error;
    }
  }
  await AsyncStorage.removeItem(key);
  if (previous.length) await AsyncStorage.multiRemove(previous);
}

export const encryptedStorage = {
  getItem(key: string): Promise<string | null> {
    return withKeyLock(key, async canCollect => {
      const current = await readEncrypted(key, canCollect);
      if (current !== null) {
        const plaintext = await decrypt(current);
        // Resume cleanup if the app stopped after publishing ciphertext but before removing legacy plaintext.
        await AsyncStorage.removeItem(key);
        if (canCollect) await collectUnreferencedChunks(key);
        return plaintext;
      }
      const legacy = await AsyncStorage.getItem(key);
      if (legacy === null) {
        if (canCollect) await collectUnreferencedChunks(key);
        return null;
      }
      // Migrate only after encryption is safely persisted; never silently discard existing data.
      await setItemUnlocked(key, legacy);
      if (canCollect) await collectUnreferencedChunks(key);
      return legacy;
    });
  },
  setItem(key: string, value: string): Promise<void> {
    return withKeyLock(key, async canCollect => {
      await setItemUnlocked(key, value);
      if (canCollect) await collectUnreferencedChunks(key);
    });
  },
  removeItem(key: string): Promise<void> {
    return withKeyLock(key, async canCollect => {
      const indexKey = PREFIX + key;
      const stored = await AsyncStorage.getItem(indexKey);
      let parts: string[] = [];
      // A corrupt index must not prevent logout, nor authorize deleting arbitrary keys.
      try { parts = chunkKeys(key, stored); } catch { /* Discard only the invalid index and legacy value. */ }
      await AsyncStorage.multiRemove([indexKey, key, ...parts]);
      if (canCollect) await collectUnreferencedChunks(key);
    });
  },
};
