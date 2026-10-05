import assert from 'node:assert/strict';
import test from 'node:test';
import { debounceTask } from './debounce-task.ts';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('coalesces a burst of date changes into one latest request', async () => {
  const calls: string[] = [];
  const directCalls: string[] = [];
  const request = debounceTask((range: string) => calls.push(range), 20);

  // The former onChange behavior invoked one load for each direct call.
  directCalls.push('2026-10-01', '2026-10-02', '2026-10-03');
  request.schedule('2026-10-01');
  request.schedule('2026-10-02');
  request.schedule('2026-10-03');
  assert.equal(calls.length, 0);
  await wait(50);

  assert.equal(directCalls.length, 3);
  assert.deepEqual(calls, ['2026-10-03']);
});

test('cancels pending work when the page effect is cleaned up', async () => {
  let calls = 0;
  const request = debounceTask(() => { calls += 1; }, 20);
  request.schedule();
  request.cancel();
  await wait(50);

  assert.equal(calls, 0);
});
