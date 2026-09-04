'use client';

type CacheEntry<T> = {
  expiresAt: number;
  storedAt: number;
  value: T;
};

type CacheOptions = {
  ttlMs: number;
  force?: boolean;
};

const MAX_ENTRIES = 32;
const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
let cacheGeneration = 0;

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(',')}}`;
}

function trimCache(now: number) {
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) memoryCache.delete(key);
  }
  while (memoryCache.size > MAX_ENTRIES) {
    const oldest = [...memoryCache.entries()]
      .sort(([, left], [, right]) => left.storedAt - right.storedAt)[0];
    if (!oldest) break;
    memoryCache.delete(oldest[0]);
  }
}

export function requestCacheKey(scope: string, action: string, payload: Record<string, unknown> = {}) {
  return `${scope}:${action}:${stableSerialize(payload)}`;
}

export function clearRequestCache() {
  cacheGeneration += 1;
  memoryCache.clear();
  inFlight.clear();
}

/**
 * 分頁記憶體內的短效讀取快取。同鍵請求共用 Promise，成功後才寫入 LRU；
 * 不寫 sessionStorage，所以登出整頁導頁後不會跨帳號沿用舊權限結果。
 */
export function cachedRequest<T>(key: string, request: () => Promise<T>, options: CacheOptions): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const now = Date.now();
  trimCache(now);
  if (!options.force) {
    const cached = memoryCache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > now) {
      memoryCache.delete(key);
      memoryCache.set(key, cached);
      return Promise.resolve(cached.value);
    }
  }

  const requestGeneration = cacheGeneration;
  const next = request()
    .then(value => {
      const storedAt = Date.now();
      if (requestGeneration === cacheGeneration) {
        memoryCache.set(key, {
          value,
          storedAt,
          expiresAt: storedAt + Math.max(0, options.ttlMs),
        });
        trimCache(storedAt);
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(key) === next) inFlight.delete(key);
    });
  inFlight.set(key, next);
  return next;
}
