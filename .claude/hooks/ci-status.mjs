// SessionStart：開工時把 main 上「每個 workflow 最近一次結果」裡失敗的項目交給 Claude。
// 每日排程的 CI（台灣時間 05:00）紅了，下一個 agent 一開工就會看到，不必等人貼訊息。
// 任何問題（沒裝 gh、未登入、離線、逾時）一律靜默放行，不卡工作流程。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { addContext, allow, projectDir } from './lib.mjs';

const BAD = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled']);
// 這幾個是高頻探針／通知，單次失敗不代表程式有問題，只看需要人處理的驗證類 workflow。
const IGNORE = /synthetic|error threshold|notify|notification|import|sync|worker|maintenance|backup/i;

// runs：gh run list --json 的結果，新到舊。回傳每個 workflow 最新一筆已完成的失敗。
export const failingLatest = (runs) => {
  const seen = new Set();
  const out = [];
  for (const run of runs ?? []) {
    const name = run.workflowName || run.name;
    if (!name || seen.has(name) || run.status !== 'completed') continue;
    seen.add(name);
    if (BAD.has(run.conclusion) && !IGNORE.test(name)) out.push(run);
  }
  return out;
};

export const formatFailures = (failures) =>
  failures
    .map((r) => `- ${r.workflowName}：${r.conclusion}（${String(r.createdAt ?? '').slice(0, 16).replace('T', ' ')} UTC，${r.event ?? ''}）${r.url ?? ''}`)
    .join('\n');

const main = () => {
  const root = projectDir();
  const run = spawnSync(
    'gh',
    ['run', 'list', '--branch', 'main', '--limit', '40', '--json', 'workflowName,status,conclusion,event,createdAt,url'],
    { cwd: root, encoding: 'utf8', timeout: 12_000 },
  );
  if (run.error || run.status !== 0) allow();
  let runs;
  try {
    runs = JSON.parse(run.stdout);
  } catch {
    allow();
  }
  const failures = failingLatest(runs);
  if (!failures.length) allow();
  addContext(
    'SessionStart',
    `[ci-status] main 上這些 workflow 最近一次是失敗的，開工前先確認原因再動手（不要在紅燈上疊新變更）：\n${formatFailures(failures)}\n用 gh run view <run id> --log-failed 看原因。`,
  );
  allow();
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
