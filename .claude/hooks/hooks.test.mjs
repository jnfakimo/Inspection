// hook 腳本的回歸測試：node .claude/hooks/hooks.test.mjs
// 假機密一律在執行期拼接，避免本檔本身被 guard-secrets 或 gitleaks 攔下。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sessionId = `hooks-test-${process.pid}`;

const run = (script, payload, extraEnv = {}) => {
  const r = spawnSync(process.execPath, [path.join(here, script)], {
    input: JSON.stringify({ session_id: sessionId, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv },
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const bash = (command) => run('guard-bash.mjs', { tool_name: 'Bash', tool_input: { command } });
const write = (file_path, content) => run('guard-secrets.mjs', { tool_name: 'Write', tool_input: { file_path, content } });
const edit = (file_path, new_string) => run('guard-secrets.mjs', { tool_name: 'Edit', tool_input: { file_path, new_string } });

let passed = 0;
const ok = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

console.log('guard-bash');
for (const cmd of [
  'git add .', 'git add -A', 'git add --all', 'git add *', 'git -C web add .', 'npm test && git add .',
  'git commit -am "x"', 'git commit -a -m x', 'git push --force', 'git push -f origin main', 'git push origin +main',
  'git push --force-with-lease', 'git reset --hard HEAD~1', 'git clean -fd', 'git add .env', 'git add web/.env.local', 'git add auth.json', 'git add data/app.sqlite',
]) {
  ok(`擋下：${cmd}`, () => assert.equal(bash(cmd).code, 2, cmd));
}
for (const cmd of [
  'git add web/app/page.tsx', 'git add ./web/app/page.tsx tools/x.mjs', 'git add .env.example', 'git commit -m "fix: git add . 不再誤擋"', 'echo "git add ."',
  'git push origin feat/x', 'git push -u origin feat/x', 'git reset HEAD file.ts', 'git status --short', 'git clean -n', 'npm run typecheck:v2', 'git commit --amend --no-edit',
]) {
  ok(`放行：${cmd}`, () => assert.equal(bash(cmd).code, 0, cmd));
}

console.log('guard-secrets');
const jwt = (role) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'c2lnbmF0dXJlc2lnbmF0dXJl'].join('.');
const fakes = {
  'service_role JWT': `const k = '${jwt('service_role')}';`,
  'sk- key': `OPENAI=${'sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'}`,
  'GitHub token': `t=${'ghp_' + 'a'.repeat(36)}`,
  'AWS key': `k=${'AKIA' + 'ABCDEFGHIJKLMNOP'}`,
  'Google/Gemini key': `k=${'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'}`,
  '私鑰': `${'-----BEGIN ' + 'PRIVATE KEY-----'}`,
};
for (const [name, content] of Object.entries(fakes)) {
  ok(`擋下寫入：${name}`, () => assert.equal(write('web/lib/x.ts', content).code, 2, name));
  ok(`擋下 Edit：${name}`, () => assert.equal(edit('web/lib/x.ts', content).code, 2, name));
}
ok('放行：anon JWT（公開金鑰）', () => assert.equal(write('web/lib/x.ts', `const k = '${jwt('anon')}';`).code, 0));
ok('放行：標註 allow-secret-pattern 的假資料', () => assert.equal(write('docs/x.md', `${fakes['GitHub token']} // allow-secret-pattern`).code, 0));
ok('放行：一般程式碼', () => assert.equal(write('web/lib/x.ts', 'export const a = 1;\n').code, 0));
ok('擋下：寫入 .env', () => assert.equal(write('.env', 'A=1').code, 2));
ok('擋下：寫入 auth.json', () => assert.equal(write('tools/auth.json', '{}').code, 2));
ok('放行：寫入 .env.example', () => assert.equal(write('.env.example', 'A=').code, 0));

console.log('post-edit-check / stop-typecheck');
const edited = path.join(os.tmpdir(), 'claude-hooks', `${sessionId}.edited`);
const badCss = path.join(root, 'web', 'app', '__hook-test-bad.css');
const post = (file) => run('post-edit-check.mjs', { tool_name: 'Edit', tool_input: { file_path: file } });
ok('非 web 檔案：略過', () => assert.equal(post(path.join(root, 'docs', 'x.md')).code, 0));
fs.writeFileSync(badCss, '.hook-test { color: #123456; }\n');
try {
  ok('web css 含 hex 色碼：失敗並回報', () => {
    const r = post(badCss);
    assert.equal(r.code, 2);
    assert.match(r.out, /色彩 token/);
  });
} finally {
  fs.rmSync(badCss, { force: true });
}
ok('web 檔案無違規：通過', () => assert.equal(post(path.join(root, 'web', 'app', 'tokens.css')).code, 0));
ok('Stop：有改 web ts 但缺 node_modules → 略過並提示', () => {
  fs.mkdirSync(path.dirname(edited), { recursive: true });
  fs.writeFileSync(edited, 'web/lib/x.ts\n');
  const r = run('stop-typecheck.mjs', { stop_hook_active: false }, { CLAUDE_PROJECT_DIR: os.tmpdir() });
  assert.equal(r.code, 0);
  assert.match(r.out, /已略過型別檢查/);
});
ok('Stop：沒改 web ts → 靜默放行', () => {
  fs.rmSync(edited, { force: true });
  const r = run('stop-typecheck.mjs', {});
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), '');
});
fs.rmSync(edited, { force: true });

console.log('security-check');
const secCheck = (relPath, content) => {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  try {
    return run('security-check.mjs', { tool_name: 'Edit', tool_input: { file_path: abs } });
  } finally {
    fs.rmSync(abs, { force: true });
  }
};
const SEC_WEB = 'web/lib/__sec-test.ts';
const SEC_SQL = 'supabase/migrations/99990101000000_sec_test.sql';
const evalCall = ['ev', 'al(code);'].join('');
ok('非程式檔案：略過', () => assert.equal(post(path.join(root, 'docs', 'x.md')).code, 0));
ok('乾淨的 web 檔案：通過且靜默', () => {
  const r = secCheck(SEC_WEB, 'export const a = 1;\n');
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), '');
});
ok('web 出現 service_role：擋下', () => {
  const r = secCheck(SEC_WEB, `export const k = process.env.${['SUPABASE_SERVICE', 'ROLE_KEY'].join('_')};\n`);
  assert.equal(r.code, 2);
  assert.match(r.out, /service_role/);
});
ok('NEXT_PUBLIC_ 變數名含 TOKEN：擋下', () => assert.equal(secCheck(SEC_WEB, `export const t = process.env.NEXT_PUBLIC_${'API'}_TOKEN;\n`).code, 2));
ok('eval：由 security-design-audit 擋下', () => {
  const r = secCheck(SEC_WEB, `${evalCall}\n`);
  assert.equal(r.code, 2);
  assert.match(r.out, /動態程式碼執行/);
});
ok('innerHTML 賦值：提醒但不擋', () => {
  const r = secCheck(SEC_WEB, 'host.innerHTML = userInput;\n');
  assert.equal(r.code, 0);
  assert.match(r.out, /additionalContext/);
});
ok('innerHTML 清空：不提醒', () => assert.equal(secCheck(SEC_WEB, "host.innerHTML = '';\n").out.trim(), ''));
ok('migration 建表沒開 RLS：擋下', () => {
  const r = secCheck(SEC_SQL, 'begin;\ncreate table public.sec_test (id int);\ncommit;\n');
  assert.equal(r.code, 2);
  assert.match(r.out, /RLS/);
});
ok('migration 建表且開 RLS：通過', () => assert.equal(secCheck(SEC_SQL, 'begin;\ncreate table public.sec_test (id int);\nalter table public.sec_test enable row level security;\ncommit;\n').code, 0));
ok('migration 註解裡的 RLS 不算數：擋下', () => assert.equal(secCheck(SEC_SQL, 'create table public.sec_test (id int);\n-- alter table public.sec_test enable row level security;\n').code, 2));
ok('security definer 缺 search_path：擋下', () => {
  const r = secCheck(SEC_SQL, 'create or replace function public.sec_fn() returns int language sql security definer as $$ select 1 $$;\n');
  assert.equal(r.code, 2);
  assert.match(r.out, /search_path/);
});
ok('security definer 有 search_path：通過', () => assert.equal(secCheck(SEC_SQL, "create or replace function public.sec_fn() returns int language sql security definer set search_path = public as $$ select 1 $$;\n").code, 0));

ok('migration 建 view 沒設 security_invoker 也沒 revoke：擋下', () => {
  const r = secCheck(SEC_SQL, 'begin;\ncreate view public.sec_v as select 1 as a;\ncommit;\n');
  assert.equal(r.code, 2);
  assert.match(r.out, /view sec_v/);
});
ok('migration 建 view 設 security_invoker：通過', () => assert.equal(secCheck(SEC_SQL, 'create view public.sec_v with (security_invoker = true) as select 1 as a;\n').code, 0));
ok('migration 建 view 並 revoke authenticated：通過', () => assert.equal(secCheck(SEC_SQL, 'create view public.sec_v as select 1 as a;\nrevoke all on table public.sec_v from public, anon, authenticated;\n').code, 0));

console.log(`\n${passed} 項 hook 測試通過`);
