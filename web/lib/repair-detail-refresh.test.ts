import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  captureRepairDetailSession,
  isRepairDetailSessionCurrent,
  runRepairMutationWithDetailRefresh,
  type RepairDetailSession,
} from './repair-detail-refresh.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function actionOptions(
  session: RepairDetailSession | null,
  getActiveSession: () => RepairDetailSession | null,
  mutate: () => Promise<unknown>,
  overrides: Partial<Parameters<typeof runRepairMutationWithDetailRefresh>[0]> = {},
) {
  return {
    session,
    getActiveSession,
    mutate,
    reload: async () => undefined,
    clearError: () => undefined,
    onError: (error: unknown) => { throw error; },
    setBusy: () => undefined,
    refreshDetail: () => undefined,
    ...overrides,
  };
}

test('a delayed action does not reopen A after its detail was closed', async () => {
  let active: RepairDetailSession | null = { generation: 1, requestId: 'A' };
  let displayed: string | null = 'A';
  let refreshes = 0;
  let reloads = 0;
  let busy = false;
  const pending = deferred();
  const session = captureRepairDetailSession(active, 'A');
  const operation = runRepairMutationWithDetailRefresh(actionOptions(
    session,
    () => active,
    () => pending.promise,
    {
      reload: async () => { reloads += 1; },
      refreshDetail: () => { refreshes += 1; displayed = 'A'; },
      setBusy: value => { busy = value; },
    },
  ));

  active = null;
  displayed = null;
  pending.resolve();
  await operation;

  assert.equal(reloads, 1, 'the successful business action still reloads the list');
  assert.equal(refreshes, 0);
  assert.equal(displayed, null);
  assert.equal(busy, false);
});

test('a delayed action for A cannot replace a newly opened B detail', async () => {
  let active: RepairDetailSession | null = { generation: 4, requestId: 'A' };
  let displayed: string | null = 'A';
  let refreshes = 0;
  const pending = deferred();
  const session = captureRepairDetailSession(active, 'A');
  const operation = runRepairMutationWithDetailRefresh(actionOptions(
    session,
    () => active,
    () => pending.promise,
    { refreshDetail: () => { refreshes += 1; displayed = 'A'; } },
  ));

  active = { generation: 5, requestId: 'B' };
  displayed = 'B';
  pending.resolve();
  await operation;

  assert.equal(refreshes, 0);
  assert.equal(displayed, 'B');
});

test('a successful action refreshes its still-active case', async () => {
  let active: RepairDetailSession | null = { generation: 7, requestId: 'A' };
  let displayedStatus = 'in_progress';
  let refreshes = 0;
  const pending = deferred();
  const session = captureRepairDetailSession(active, 'A');
  const operation = runRepairMutationWithDetailRefresh(actionOptions(
    session,
    () => active,
    () => pending.promise,
    {
      onSuccess: () => { displayedStatus = 'pending_review'; },
      refreshDetail: () => {
        refreshes += 1;
        active = { generation: 8, requestId: 'A' };
      },
    },
  ));

  pending.resolve();
  await operation;

  assert.equal(displayedStatus, 'pending_review');
  assert.equal(refreshes, 1);
  assert.equal(isRepairDetailSessionCurrent(active, session), false, 'refresh starts a new generation');
});

test('failure stays visible, clears busy, and retry can complete', async () => {
  const active: RepairDetailSession = { generation: 9, requestId: 'A' };
  let errorMessage = '';
  let busy = false;
  let reloads = 0;
  let refreshes = 0;
  let retryMutation = deferred();
  const run = (mutate: () => Promise<unknown>) => runRepairMutationWithDetailRefresh(actionOptions(
    active,
    () => active,
    mutate,
    {
      reload: async () => { reloads += 1; },
      clearError: () => { errorMessage = ''; },
      onError: error => { errorMessage = error instanceof Error ? error.message : 'failed'; },
      setBusy: value => { busy = value; },
      refreshDetail: () => { refreshes += 1; },
    },
  ));

  await run(async () => { throw new Error('temporary network error'); });
  assert.equal(errorMessage, 'temporary network error');
  assert.equal(busy, false);
  assert.equal(reloads, 0);

  const retry = run(() => retryMutation.promise);
  assert.equal(busy, true);
  assert.equal(errorMessage, '');
  retryMutation.resolve();
  await retry;
  assert.equal(errorMessage, '');
  assert.equal(busy, false);
  assert.equal(reloads, 1);
  assert.equal(refreshes, 1);
});

test('workflow, dispatch, and completion route through the guarded helper', () => {
  const workspace = readFileSync(new URL('../app/systems/[system]/[module]/workspace.tsx', import.meta.url), 'utf8');
  const operations = [
    ['runRepairWorkflow', 'dispatchRepair'],
    ['dispatchRepair', 'openCompletionForm'],
    ['completeRepair', 'acceptByReporter'],
  ] as const;
  for (const [name, nextName] of operations) {
    const start = workspace.indexOf(`const ${name} = async`);
    const end = workspace.indexOf(`const ${nextName} =`, start + 1);
    assert.ok(start >= 0 && end > start, `${name} is present`);
    assert.ok(workspace.slice(start, end).includes('runRepairMutationWithDetailRefresh'), `${name} uses the tested guard`);
  }
});
