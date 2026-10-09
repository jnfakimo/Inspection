import assert from 'node:assert/strict';
import test from 'node:test';
import { createThenRefresh } from './create-refresh.ts';

test('preserves create success when the following list refresh fails', async () => {
  let createCalls = 0;
  let refreshCalls = 0;
  const error = new Error('offline GET');
  const result = await createThenRefresh(
    async () => { createCalls += 1; return { id: 'local-test-record' }; },
    async () => { refreshCalls += 1; return { ok: false, error }; },
  );

  assert.equal(result.created, true);
  assert.equal(result.refreshed, false);
  assert.equal(result.error, error);
  assert.equal(createCalls, 1);
  assert.equal(refreshCalls, 1);
});

test('a later reload retries only the list read and never repeats the create', async () => {
  let createCalls = 0;
  let refreshCalls = 0;
  const create = async () => { createCalls += 1; return 'created'; };
  const refresh = async () => {
    refreshCalls += 1;
    return refreshCalls === 1 ? { ok: false as const, error: new Error('offline GET') } : { ok: true as const };
  };

  const initial = await createThenRefresh(create, refresh);
  assert.equal(initial.refreshed, false);

  const reloaded = await refresh();
  assert.deepEqual(reloaded, { ok: true });
  assert.equal(createCalls, 1);
  assert.equal(refreshCalls, 2);
});

test('does not claim create success or refresh after the create fails', async () => {
  let refreshCalls = 0;
  await assert.rejects(createThenRefresh(
    async () => { throw new Error('POST failed'); },
    async () => { refreshCalls += 1; return { ok: true }; },
  ), /POST failed/);
  assert.equal(refreshCalls, 0);
});
