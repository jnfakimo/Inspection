// git hook 的回歸測試：node .githooks/githooks.test.mjs
// 在臨時 repo 與本機 bare 遠端實際跑 git commit／push，不碰真實 repo。假機密於執行期拼接。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hooksDir = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'githooks-test-'));
const work = path.join(tmp, 'work');
const remote = path.join(tmp, 'remote.git');

const git = (args, cwd = work) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const put = (name, content) => {
  fs.mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
  fs.writeFileSync(path.join(work, name), content);
};
const tryCommit = (name, content, message = 'test') => {
  put(name, content);
  git(['add', '--', name]);
  const r = git(['commit', '-m', message]);
  if (r.code !== 0) git(['reset', '-q', '--', name]); // 失敗時清掉 stage，不影響下一個案例
  return r;
};

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

try {
  fs.mkdirSync(work);
  spawnSync('git', ['init', '-q', '-b', 'main', remote, '--bare']);
  git(['init', '-q', '-b', 'main']);
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@example.com'], ['core.hooksPath', hooksDir], ['core.autocrlf', 'false']]) git(['config', k, v]);
  git(['remote', 'add', 'origin', remote]);

  const jwt = (role) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.');
  const ghp = `t=${'ghp_' + 'a'.repeat(36)}`;

  console.log('pre-commit');
  ok('一般檔案可提交', () => assert.equal(tryCommit('a.txt', 'hello\n', 'first').code, 0));
  ok('.env 被擋', () => {
    const r = tryCommit('.env', 'A=1\n');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /已攔截提交/);
  });
  ok('web/.env.local 被擋', () => assert.notEqual(tryCommit('web/.env.local', 'A=1\n').code, 0));
  ok('auth.json 被擋', () => assert.notEqual(tryCommit('tools/auth.json', '{}\n').code, 0));
  ok('.env.example 放行', () => assert.equal(tryCommit('.env.example', 'A=\n').code, 0));
  ok('內容含 GitHub token 被擋並指出行號', () => {
    const r = tryCommit('b.ts', `x\n${ghp}\n`);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /b\.ts:2 .*GitHub token/);
  });
  ok('service_role JWT 被擋', () => assert.notEqual(tryCommit('c.ts', `const k = '${jwt('service_role')}';\n`).code, 0));
  ok('anon JWT 放行', () => assert.equal(tryCommit('d.ts', `const k = '${jwt('anon')}';\n`).code, 0));
  ok('allow-secret-pattern 假資料放行', () => assert.equal(tryCommit('e.md', `${ghp} // allow-secret-pattern\n`).code, 0));
  ok('regex 剝除私鑰標頭的程式碼放行', () => assert.equal(tryCommit('f.ts', `s.replace(/${'-----BEGIN ' + 'PRIVATE KEY-----'}|x/g, '');\n`).code, 0));
  ok('公開金鑰檔 .pem（檔名含 public）放行', () => assert.equal(tryCommit('security/provenance-public-key.pem', 'abc\n').code, 0));

  console.log('pre-push');
  ok('新分支與一般推送可通過', () => assert.equal(git(['push', '-q', '-u', 'origin', 'main']).code, 0));
  ok('快轉更新可通過', () => {
    tryCommit('g.txt', 'more\n', 'second');
    assert.equal(git(['push', '-q', 'origin', 'main']).code, 0);
  });
  ok('amend 後一般 push 被擋（git 本身就會拒絕非快轉）', () => {
    assert.equal(git(['commit', '--amend', '-q', '-m', 'rewritten']).code, 0);
    assert.notEqual(git(['push', 'origin', 'main']).code, 0);
  });
  ok('--force 被 pre-push 攔下', () => {
    const r = git(['push', '--force', 'origin', 'main']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /已攔截推送/);
  });
  ok('--force-with-lease 被 pre-push 攔下', () => {
    const r = git(['push', '--force-with-lease', 'origin', 'main']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /已攔截推送/);
  });
  ok('刪除遠端 main 被擋', () => {
    const r = git(['push', 'origin', '--delete', 'main']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /禁止刪除遠端 main/);
  });
  ok('刪除其他分支可通過', () => {
    assert.equal(git(['push', '-q', 'origin', 'HEAD:refs/heads/tmp-branch']).code, 0);
    assert.equal(git(['push', '-q', 'origin', '--delete', 'tmp-branch']).code, 0);
  });
  console.log('pre-push 測試閘門');
  const mapSource = fs.readFileSync(path.join(hooksDir, '..', 'tools', 'affected-tests.mjs'), 'utf8');
  ok('受影響的測試失敗 → 推送被攔下並指出檔名', () => {
    put('tools/affected-tests.mjs', mapSource);
    put('tools/gate-sample.test.mjs', "throw new Error('故意失敗');\n");
    git(['add', '--', 'tools/affected-tests.mjs', 'tools/gate-sample.test.mjs']);
    assert.equal(git(['commit', '-q', '-m', 'add failing test']).code, 0);
    const r = git(['push', 'origin', 'HEAD:refs/heads/gate-bad']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /已攔截推送/);
    assert.match(r.out, /gate-sample\.test\.mjs/);
  });
  ok('SKIP_PREPUSH_TESTS=1 可緊急略過（並留下警告）', () => {
    const r = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/gate-skip'], { cwd: work, encoding: 'utf8', env: { ...process.env, SKIP_PREPUSH_TESTS: '1' } });
    assert.equal(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /略過測試閘門/);
  });
  ok('測試修好後可推送', () => {
    put('tools/gate-sample.test.mjs', "import assert from 'node:assert/strict';\nassert.equal(1, 1);\n");
    git(['add', '--', 'tools/gate-sample.test.mjs']);
    assert.equal(git(['commit', '-q', '-m', 'fix test']).code, 0);
    assert.equal(git(['push', '-q', 'origin', 'HEAD:refs/heads/gate-good']).code, 0);
  });
  ok('只改文件的推送不跑測試也能過', () => {
    put('notes.md', 'x\n');
    git(['add', '--', 'notes.md']);
    assert.equal(git(['commit', '-q', '-m', 'docs']).code, 0);
    assert.equal(git(['push', '-q', 'origin', 'HEAD:refs/heads/gate-docs']).code, 0);
  });
  ok('遠端內容仍是原本的快轉結果（未被強推覆蓋）', () => {
    const remoteLog = git(['log', '--format=%s', 'main'], remote).out.trim().split('\n');
    assert.equal(remoteLog[0], 'second');
    assert.ok(!remoteLog.includes('rewritten'));
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${passed} 項 git hook 測試通過`);
