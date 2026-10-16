import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestSequence } from './request-sequence.ts';
import { firstQueryError } from './async-load-safety.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('a newer request makes older responses stale', () => {
  const sequence = createRequestSequence();
  const first = sequence.begin();
  const second = sequence.begin();

  assert.equal(sequence.isCurrent(first), false);
  assert.equal(sequence.isCurrent(second), true);
});

test('unmount invalidation rejects a response still in flight', () => {
  const sequence = createRequestSequence();
  const request = sequence.begin();

  sequence.invalidate();

  assert.equal(sequence.isCurrent(request), false);
});

test('a late response after a filter switch cannot overwrite the newer result', async () => {
  const sequence = createRequestSequence();
  const older = deferred<string>();
  const newer = deferred<string>();
  let visible = '';

  const oldId = sequence.begin();
  const oldCompletion = older.promise.then(value => {
    if (sequence.isCurrent(oldId)) visible = value;
  });
  const newId = sequence.begin();
  const newCompletion = newer.promise.then(value => {
    if (sequence.isCurrent(newId)) visible = value;
  });

  newer.resolve('new filter');
  await newCompletion;
  older.resolve('old filter');
  await oldCompletion;
  assert.equal(visible, 'new filter');
});

test('an unmounted view ignores its late response', async () => {
  const sequence = createRequestSequence();
  const pending = deferred<string>();
  const request = sequence.begin();
  let visible = '';
  const completion = pending.promise.then(value => {
    if (sequence.isCurrent(request)) visible = value;
  });

  sequence.invalidate();
  pending.resolve('late response');
  await completion;
  assert.equal(visible, '');
});

test('a resolved partial query error is not treated as an empty success', () => {
  const failure = new Error('secondary query failed');
  assert.equal(firstQueryError({ error: null }, { error: failure }), failure);
  assert.equal(firstQueryError({ error: null }, { error: null }), null);
});
