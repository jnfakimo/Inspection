// pre-push：git 會從 stdin 逐行給 `<local ref> <local sha> <remote ref> <remote sha>`。
//   - 遠端既有提交不是本地提交的祖先 = 非快轉更新（force push）→ 擋下
//   - 刪除 main／master → 擋下
// 遇到衝突請 fetch 後 rebase；不要強推（AGENTS.md §1 第 4 點）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const isZero = (sha) => /^0+$/.test(sha);
const problems = [];

for (const line of fs.readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
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
