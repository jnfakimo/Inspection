import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { fromByteArray, toByteArray } from 'base64-js';

const KEY_NAME = 'vehicle_tracker_storage_key_v1';
const PREFIX = 'encrypted_v1:';
const CHUNK_SIZE = 200_000;
const MAX_CHUNKS = 128;
let keyPromise: Promise<AESEncryptionKey> | undefined;
const operations = new Map<string, Promise<void>>();

function withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (operations.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  operations.set(key, tail);
  void tail.then(() => { if (operations.get(key) === tail) operations.delete(key); });
  return result;
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

async function readEncrypted(key: string): Promise<string | null> {
  const stored = await AsyncStorage.getItem(PREFIX + key);
  if (!stored) return null;
  if (stored.startsWith(PREFIX)) return stored;
  const parts = await Promise.all(chunkKeys(key, stored).map(part => AsyncStorage.getItem(part)));
  if (parts.some(part => part === null)) throw new Error('加密資料不完整');
  return parts.join('');
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
    return withKeyLock(key, async () => {
      const current = await readEncrypted(key);
      if (current !== null) {
        const plaintext = await decrypt(current);
        // Resume cleanup if the app stopped after publishing ciphertext but before removing legacy plaintext.
        await AsyncStorage.removeItem(key);
        return plaintext;
      }
      const legacy = await AsyncStorage.getItem(key);
      if (legacy === null) return null;
      // Migrate only after encryption is safely persisted; never silently discard existing data.
      await setItemUnlocked(key, legacy);
      return legacy;
    });
  },
  setItem(key: string, value: string): Promise<void> {
    return withKeyLock(key, () => setItemUnlocked(key, value));
  },
  removeItem(key: string): Promise<void> {
    return withKeyLock(key, async () => {
      const indexKey = PREFIX + key;
      const stored = await AsyncStorage.getItem(indexKey);
      let parts: string[] = [];
      // A corrupt index must not prevent logout, nor authorize deleting arbitrary keys.
      try { parts = chunkKeys(key, stored); } catch { /* Discard only the invalid index and legacy value. */ }
      await AsyncStorage.multiRemove([indexKey, key, ...parts]);
    });
  },
};
