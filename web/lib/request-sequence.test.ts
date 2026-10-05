import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestSequence, dateRangeChanged, isValidDateRange } from './request-sequence.ts';

test('ignores an old response that completes inside the replacement debounce window', async () => {
  const requests = createRequestSequence();
  const oldRequest = requests.begin();
  let resolveOld!: (value: string) => void;
  let displayed: string | undefined;
  const oldResponse = new Promise<string>(resolve => { resolveOld = resolve; });
  const oldCompletion = oldResponse.then(value => {
    if (requests.isCurrent(oldRequest)) displayed = value;
  });

  // Invalidate at date-change time, before the 250 ms replacement timer fires.
  requests.invalidate();
  resolveOld('old-date-data');
  await oldCompletion;
  assert.equal(displayed, undefined);

  const nextRequest = requests.begin();
  assert.equal(requests.isCurrent(nextRequest), true);
});

test('ignores an in-flight response after the component unmounts', async () => {
  const requests = createRequestSequence();
  const pending = requests.begin();
  let resolvePending!: (value: string) => void;
  let displayed: string | undefined;
  const response = new Promise<string>(resolve => { resolvePending = resolve; });
  const completion = response.then(value => {
    if (requests.isCurrent(pending)) displayed = value;
  });

  requests.invalidate();
  resolvePending('after-unmount-data');
  await completion;
  assert.equal(displayed, undefined);
});

test('rapid A to B to A changes keep only the newest request current', () => {
  const requests = createRequestSequence();
  const firstA = requests.begin();
  requests.invalidate();
  const requestB = requests.begin();
  requests.invalidate();
  const secondA = requests.begin();

  assert.equal(requests.isCurrent(firstA), false);
  assert.equal(requests.isCurrent(requestB), false);
  assert.equal(requests.isCurrent(secondA), true);
});

test('same-valued quick ranges keep the in-flight request alive so it can clear busy', async () => {
  const requests = createRequestSequence();
  const active = requests.begin();
  const range = { from: '2026-10-01', to: '2026-10-05' };
  let busy = true;
  let resolveResponse!: () => void;
  const response = new Promise<void>(resolve => { resolveResponse = resolve; });
  const completion = response.then(() => {
    if (requests.isCurrent(active)) busy = false;
  });

  for (let click = 0; click < 3; click += 1) {
    const nextRange = { ...range };
    if (dateRangeChanged(range, nextRange)) requests.invalidate();
  }
  resolveResponse();
  await completion;

  assert.equal(busy, false);
  assert.equal(requests.isCurrent(active), true);
});

test('same-valued date updates after StrictMode effect replay do not invalidate the active load', () => {
  const requests = createRequestSequence();
  const replayedSetupRequest = requests.begin();
  requests.invalidate(); // StrictMode cleanup invalidates the first effect lifetime.
  const active = requests.begin(); // The replayed effect owns the current load.
  const range = { from: '2026-10-01', to: '2026-10-05' };
  const sameRange = { ...range };

  if (dateRangeChanged(range, sameRange)) requests.invalidate();
  assert.equal(requests.isCurrent(replayedSetupRequest), false);
  assert.equal(requests.isCurrent(active), true);
});

test('changed and incomplete ranges invalidate old work and fail validation', () => {
  const requests = createRequestSequence();
  const active = requests.begin();
  const current = { from: '2026-10-01', to: '2026-10-05' };
  const changed = { from: '2026-10-02', to: current.to };
  assert.equal(dateRangeChanged(current, changed), true);
  requests.invalidate();
  assert.equal(requests.isCurrent(active), false);

  assert.equal(isValidDateRange({ from: '', to: current.to }), false);
  assert.equal(isValidDateRange({ from: '2026-10-06', to: current.to }), false);
  assert.equal(isValidDateRange(current), true);

  let busy = true;
  if (!isValidDateRange({ from: '', to: current.to })) busy = false;
  assert.equal(busy, false);
});
