const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const worker = path.join(__dirname, 'fixtures/storage-crash-worker.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const expected = version => hash(version === 'short' ? '短資料' : (version === 'old' ? '舊定位' : '新定位').repeat(50_000));
function workspace(t) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, 'inspection-process-crash-'));
  fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ disk: {}, keys: {} }));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), tempRoot);
    assert.ok(path.basename(resolved).startsWith('inspection-process-crash-'));
    fs.rmSync(resolved, { recursive: true });
  });
  return root;
}
function run(root, operation, checkpoint) {
  return new Promise((resolve, reject) => {
    const child = fork(worker, [root, operation, checkpoint ?? ''], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let result, reached = false, failure;
    const timer = setTimeout(() => {
      failure = new Error('worker timed out');
      if (!child.kill('SIGKILL')) reject(failure);
    }, 15_000);
    child.on('error', error => { failure = error; clearTimeout(timer); reject(error); });
    child.on('message', message => {
      if (message.kind === 'checkpoint') {
        if (message.point !== checkpoint) failure = new Error('unexpected checkpoint');
        reached = true; child.kill('SIGKILL');
      } else if (message.kind === 'result') result = message;
      else failure = new Error('worker operation failed');
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (checkpoint) {
        if (!reached || result || (code === 0 && !signal)) return reject(new Error('worker was not interrupted'));
        return resolve({ interrupted: true });
      }
      if (code !== 0 || !result) return reject(new Error('fresh worker did not finish'));
      resolve(result);
    });
  });
}
test('process killed during chunk writes leaves the last committed value readable', async t => {
  const root = workspace(t); await run(root, 'old');
  await run(root, 'new', 'chunk-written');
  const recovered = await run(root, 'read');
  assert.equal(recovered.digest, expected('old'));
  assert.ok(recovered.unreferencedChunks > 0, 'unpublished ciphertext can remain after abrupt termination');
});
test('process killed after publishing a chunk index recovers the complete new value', async t => {
  const root = workspace(t); await run(root, 'old');
  await run(root, 'new', 'index-published');
  const recovered = await run(root, 'read');
  assert.equal(recovered.digest, expected('new'));
  assert.ok(recovered.unreferencedChunks > 0, 'prior ciphertext cleanup may not have run');
});
test('process killed after publishing a short value never falls back to old chunks', async t => {
  const root = workspace(t); await run(root, 'old');
  await run(root, 'short', 'index-published');
  assert.equal((await run(root, 'read')).digest, expected('short'));
});
test('fresh process resumes legacy plaintext cleanup after interrupted migration', async t => {
  const root = workspace(t);
  const stateFile = path.join(root, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ disk: { 'crash-record': '新定位'.repeat(50_000) }, keys: {} }));
  await run(root, 'read', 'index-published');
  assert.ok(JSON.parse(fs.readFileSync(stateFile, 'utf8')).disk['crash-record']);
  const recovered = await run(root, 'read');
  assert.equal(recovered.digest, expected('new')); assert.equal(recovered.legacyPresent, false);
});
test('termination after atomic removal does not resurrect the logged-out record', async t => {
  const root = workspace(t); await run(root, 'old');
  await run(root, 'remove', 'record-removed');
  assert.equal((await run(root, 'read')).digest, null);
});
test('key persisted before termination is reused by the next write', async t => {
  const root = workspace(t); await run(root, 'new', 'key-written');
  const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
  const keyDigest = hash(state.keys.vehicle_tracker_storage_key_v1);
  assert.equal(Object.keys(state.disk).length, 0);
  const recovered = await run(root, 'new');
  assert.equal(recovered.digest, expected('new')); assert.equal(recovered.keyDigest, keyDigest);
});
