// PostToolUse(Write|Edit|MultiEdit)：改完 web/ 的 ts／tsx／css 立刻跑快速守門檢查（約 1 秒內）。
//   - 色彩 token、系統頁標題、共用按鈕規格、資料下拉空白列
// 同時把被改的檔案記到本 session 的狀態檔，交給 Stop hook 決定要不要跑型別檢查。
// 沒有對應腳本（舊分支）就直接略過；失敗時 exit 2，把輸出交回 Claude 當場修。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { allow, block, projectDir, readInput, recordEdited, toRelative } from './lib.mjs';

const input = readInput();
const root = projectDir();
const rel = toRelative(root, input.tool_input?.file_path);
if (!rel || !/^web\/.+\.(tsx?|css)$/.test(rel)) allow();

recordEdited(input.session_id, rel);

const CHECKS = [
  ['色彩 token', ['tools/color-token-check.mjs']],
  ['系統頁標題', ['--experimental-strip-types', 'tools/system-page-heading-check.mjs']],
  ['共用按鈕規格', ['tools/v2-button-standard-check.mjs']],
  ['下拉空白列', ['tools/input-select-standard-check.mjs']],
];

const failures = [];
for (const [label, args] of CHECKS) {
  const script = args[args.length - 1];
  if (!fs.existsSync(path.join(root, script))) continue;
  const run = spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  if (run.status !== 0) {
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
    failures.push(`✗ ${label}（${script}）\n${out}`);
  }
}

if (failures.length) {
  block(`[post-edit-check] 剛改的 ${rel} 讓守門檢查失敗，請先修正再繼續：\n${failures.join('\n\n')}`);
}
allow();
