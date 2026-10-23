import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inspectGate, requiredWorkflows } from './deployment-security-gate.mjs';

const repository = 'example/Inspection', sha = 'a'.repeat(40);
const run = (file, overrides = {}) => ({ id: 1, head_sha: sha, head_branch: 'main',
  head_repository: { full_name: repository }, path: `.github/workflows/${file}`,
  event: 'push', status: 'completed', conclusion: 'success', ...overrides });
function fixture(overrides = {}, tip = sha) {
  return { repository, sha, get: async path => {
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: tip } };
    const file = requiredWorkflows.find(name => path.includes(`/${name}/`));
    assert.ok(file);
    return { workflow_runs: overrides[file] ?? [run(file)] };
  } };
}
test('全部必要流程須對應同一 main commit 才通過', async () => {
  assert.equal((await inspectGate(fixture())).ready, true);
});
test('缺少或仍執行中的流程必須等待', async () => {
  for (const rows of [[], [run('ci.yml', { status: 'in_progress', conclusion: null })]]) {
    assert.equal((await inspectGate(fixture({ 'ci.yml': rows }))).ready, false);
  }
});
test('失敗、取消、略過都阻擋，不退回較早的成功結果', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', null]) {
    await assert.rejects(inspectGate(fixture({ 'ci.yml': [run('ci.yml'), run('ci.yml', { id: 2, conclusion })] })), /未通過/);
  }
});
test('新版尚未完成不採用舊成功', async () => {
  assert.equal((await inspectGate(fixture({ 'ci.yml': [run('ci.yml'), run('ci.yml', { id: 2, status: 'queued' })] }))).ready, false);
});
test('其他 commit、分支、PR、倉庫與不同流程不能充當成功證據', async () => {
  for (const override of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' },
    { event: 'pull_request' }, { head_repository: { full_name: 'other/Inspection' } }, { path: '.github/workflows/untrusted.yml' }]) {
    assert.equal((await inspectGate(fixture({ 'ci.yml': [run('ci.yml', override)] }))).ready, false);
  }
});
test('過期 commit 被拒絕', async () => {
  await assert.rejects(inspectGate(fixture({}, 'b'.repeat(40))), /不是 main 最新/);
});
test('查詢過程 main 移動也被拒絕', async () => {
  const input = fixture(); const original = input.get; let calls = 0;
  input.get = path => path.endsWith('/git/ref/heads/main') && ++calls > 1
    ? Promise.resolve({ object: { sha: 'b'.repeat(40) } }) : original(path);
  await assert.rejects(inspectGate(input), /main 已更新/);
});
test('API 異常或不完整資料不得放行', async () => {
  const input = fixture(); input.get = async () => { throw new Error('network unavailable'); };
  await assert.rejects(inspectGate(input), /network/);
  const malformed = fixture(); const original = malformed.get;
  malformed.get = path => path.includes('/runs?') ? Promise.resolve({}) : original(path);
  await assert.rejects(inspectGate(malformed), /回應不完整/);
});
test('部署前兩次檢查，且 build 必須依賴 gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/hardened-pages.yml', import.meta.url), 'utf8');
  assert.match(workflow, /build:\s*\n\s+needs: security-gate/);
  assert.match(workflow, /node tools\/deployment-security-gate\.mjs --once/);
  assert.match(workflow, /actions: read/);
  const edge = readFileSync(new URL('../.github/workflows/deploy-edge-functions.yml', import.meta.url), 'utf8');
  assert.match(edge, /if: github.ref == 'refs\/heads\/main'/);
  assert.ok(edge.indexOf('node tools/deployment-security-gate.mjs') < edge.indexOf('- name: Require access token'));
  assert.match(edge, /node tools\/deployment-security-gate\.mjs --once/);
  assert.ok(edge.indexOf('node tools/deployment-security-gate.mjs --once') < edge.search(/- name: Deploy\r?\n/));
});
