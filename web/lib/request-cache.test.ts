import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedRequest, clearRequestCache, requestCacheKey } from './request-cache.ts';

test('同一使用者與參數的進行中請求只送出一次', async () => {
  clearRequestCache();
  let calls = 0;
  let release!: (value: string) => void;
  const pending = new Promise<string>(resolve => { release = resolve; });
  const key = requestCacheKey('user-1', 'market_analysis', { filters: { market: '第一市場' } });
  const first = cachedRequest(key, () => { calls += 1; return pending; }, { ttlMs: 60_000 });
  const second = cachedRequest(key, () => { calls += 1; return Promise.resolve('重複'); }, { ttlMs: 60_000 });
  assert.strictEqual(first, second);
  release('完成');
  assert.deepEqual(await Promise.all([first, second]), ['完成', '完成']);
  assert.equal(calls, 1);
});

test('短效快取命中，強制更新會略過已完成快取', async () => {
  clearRequestCache();
  let calls = 0;
  const key = requestCacheKey('user-1', 'market_catalog', {});
  const request = () => Promise.resolve(++calls);
  assert.equal(await cachedRequest(key, request, { ttlMs: 60_000 }), 1);
  assert.equal(await cachedRequest(key, request, { ttlMs: 60_000 }), 1);
  assert.equal(await cachedRequest(key, request, { ttlMs: 60_000, force: true }), 2);
  assert.equal(calls, 2);
});

test('清除快取後，舊請求完成也不會覆蓋新資料', async () => {
  clearRequestCache();
  let release!: (value: string) => void;
  const oldPending = new Promise<string>(resolve => { release = resolve; });
  const key = requestCacheKey('user-1', 'dashboard_market_rotation', { view: 'cards' });
  const oldRequest = cachedRequest(key, () => oldPending, { ttlMs: 60_000 });
  clearRequestCache();
  assert.equal(await cachedRequest(key, () => Promise.resolve('新資料'), { ttlMs: 60_000 }), '新資料');
  release('舊資料');
  assert.equal(await oldRequest, '舊資料');
  assert.equal(
    await cachedRequest(key, () => Promise.resolve('不應執行'), { ttlMs: 60_000 }),
    '新資料',
  );
});
