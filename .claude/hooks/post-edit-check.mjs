// PostToolUse(Write|Edit|MultiEdit)：改完檔案立刻跑對應的守門檢查與測試。
//   1. web/ 的 ts／tsx／css：色彩 token、系統頁標題、共用按鈕規格、資料下拉空白列（約 1 秒內）。
//   2. 所有 tools／web／supabase 的程式碼與 migration：用 tools/affected-tests.mjs 的對照表，
//      跑「受影響的測試」（改 migration → 提到它的 pglite 資料庫測試；改 handler → 同目錄測試）。
// 同時把被改的檔案記到本 session 的狀態檔，交給 Stop hook 收尾（型別檢查、補跑沒跑成的測試）。
// 沒有對應腳本（舊分支）就略過；失敗時 exit 2，把輸出交回 Claude 當場修；缺套件、逾時只提醒不阻擋。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addContext, allow, block, projectDir, readInput, recordEdited, recordVerified, toRelative } from './lib.mjs';

const input = readInput();
const root = projectDir();
const rel = toRelative(root, input.tool_input?.file_path);
const isWebFront = rel && /^web\/.+\.(tsx?|css)$/.test(rel);
const isTestable = rel && /^(?:tools\/.+\.(?:mjs|cjs|js|tsx?)|web\/.+\.(?:tsx?|mjs|js)|supabase\/functions\/.+\.(?:tsx?|mjs|js)|supabase\/migrations\/.+\.sql)$/.test(rel);
if (!isWebFront && !isTestable) allow();

recordEdited(input.session_id, rel);

const CHECKS = [
  ['色彩 token', ['tools/color-token-check.mjs']],
  ['系統頁標題', ['--experimental-strip-types', 'tools/system-page-heading-check.mjs']],
  ['共用按鈕規格', ['tools/v2-button-standard-check.mjs']],
  ['下拉空白列', ['tools/input-select-standard-check.mjs']],
];

const failures = [];
const notes = [];

if (isWebFront) {
  for (const [label, args] of CHECKS) {
    const script = args[args.length - 1];
    if (!fs.existsSync(path.join(root, script))) continue;
    const run = spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    if (run.status !== 0) {
      const out = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n');
      failures.push(`✗ ${label}（${script}）\n${out}`);
    }
  }
}

// 對照表模組在舊分支可能不存在：沒有就只做上面的檢查。
const mapModule = path.join(root, 'tools', 'affected-tests.mjs');
if (isTestable && fs.existsSync(mapModule)) {
  try {
    const { affectedFor, runVerifiers } = await import(pathToFileURL(mapModule).href);
    const { files, truncated } = affectedFor(root, rel);
    if (files.length) {
      const result = runVerifiers(root, files, { budgetMs: 55_000, perFileMs: 40_000 });
      for (const f of result.passed) recordVerified(input.session_id, f);
      for (const f of result.failed) failures.push(`✗ 測試失敗（${f.file}）\n${f.out}`);
      for (const s of [...result.skipped, ...result.notRun]) notes.push(`- ${s.file}：${s.reason}，未驗證（結束前會再補跑一次）`);
      if (truncated) notes.push('- 受影響的測試超過上限，只跑了前幾個；完整驗證靠推送前與 CI。');
    }
  } catch (error) {
    notes.push(`- 受影響測試的對照表執行失敗（${error?.message ?? error}），已略過。`);
  }
}

if (failures.length) {
  block(`[post-edit-check] 剛改的 ${rel} 讓守門檢查或測試失敗，請先修正再繼續：\n${failures.join('\n\n')}`);
}
if (notes.length) addContext('PostToolUse', `[post-edit-check] ${rel} 的部分測試沒跑成：\n${notes.join('\n')}`);
allow();
