// pre-push：git 會從 stdin 逐行給 `<local ref> <local sha> <remote ref> <remote sha>`。
//   - 遠端既有提交不是本地提交的祖先 = 非快轉更新（force push）→ 擋下
//   - 刪除 main／master → 擋下
//   - 通過後，跑「這次推送變更的檔案」所對應的測試（失敗擋下；缺套件或逾時只警告）
// 遇到衝突請 fetch 後 rebase；不要強推（AGENTS.md §1 第 4 點）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isZero = (sha) => /^0+$/.test(sha);
const problems = [];
const pushLines = fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);

for (const line of pushLines) {
  const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
  const branch = String(remoteRef).replace(/^refs\/heads\//, '');
  if (isZero(localSha)) {
    if (['main', 'master'].includes(branch)) problems.push(`禁止刪除遠端 ${branch}`);
    continue;
  }
  if (isZero(remoteSha)) continue; // 新分支
  const check = spawnSync('git', ['merge-base', '--is-ancestor', remoteSha, localSha], { encoding: 'utf8' });
  if (check.status === 1) problems.push(`${localRef} → ${remoteRef} 不是快轉更新（force push）`);
  else if (check.status !== 0) problems.push(`${remoteRef} 的遠端提交 ${remoteSha.slice(0, 9)} 不在本機，請先 git fetch 再推送`);
}

if (problems.length) {
  process.stderr.write(`[pre-push] 已攔截推送：\n- ${problems.join('\n- ')}\n遇到衝突請 fetch 後 rebase，不要 force push。\n`);
  process.exit(1);
}

// ---- 測試閘門：這次要推的變更所對應的測試必須全過 ----
// 對照規則在 tools/affected-tests.mjs（與改檔當下的 hook 同一份）。
// 只擋「真的失敗」；缺套件或逾時視為未驗證，只警告（完整驗證仍靠 CI 的 npm test）。
// 緊急略過：SKIP_PREPUSH_TESTS=1 git push …（會留下警告，事後要補跑）。
if (process.env.SKIP_PREPUSH_TESTS === '1') {
  process.stderr.write('[pre-push] 已依 SKIP_PREPUSH_TESTS=1 略過測試閘門，請事後補跑 node tools/affected-tests.mjs --base origin/main --run。\n');
  process.exit(0);
}

const gitOut = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};
const root = gitOut(['rev-parse', '--show-toplevel']);
const mapModule = root && path.join(root, 'tools', 'affected-tests.mjs');
if (mapModule && fs.existsSync(mapModule)) {
  const changed = new Set();
  for (const line of pushLines) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (isZero(localSha)) continue;
    const base = isZero(remoteSha) ? gitOut(['merge-base', 'origin/main', localSha]) : remoteSha;
    if (!base) continue;
    for (const f of gitOut(['diff', '--name-only', '--diff-filter=ACMR', base, localSha]).split('\n').filter(Boolean)) changed.add(f);
  }
  try {
    const { affectedForAll, runVerifiers } = await import(pathToFileURL(mapModule).href);
    const { files, truncated } = affectedForAll(root, [...changed]);
    if (files.length) {
      process.stderr.write(`[pre-push] 跑 ${files.length} 個受影響的測試${truncated ? '（已截斷）' : ''}…\n`);
      const result = runVerifiers(root, files, { budgetMs: 4 * 60_000, perFileMs: 2 * 60_000 });
      for (const s of [...result.skipped, ...result.notRun]) process.stderr.write(`[pre-push] 未驗證：${s.file}（${s.reason}）\n`);
      if (result.failed.length) {
        process.stderr.write(`[pre-push] 已攔截推送：以下測試失敗，修好再推（確定要略過請設 SKIP_PREPUSH_TESTS=1）：\n`);
        for (const f of result.failed) process.stderr.write(`\n✗ ${f.file}\n${f.out}\n`);
        process.exit(1);
      }
    }
  } catch (error) {
    process.stderr.write(`[pre-push] 測試閘門執行失敗，已略過：${error?.message ?? error}\n`);
  }
}
