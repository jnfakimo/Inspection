// Stop：結束前的收尾驗證。
//   1. 本 session 改過 web/ 的 ts／tsx → 跑 `tsc -p web/tsconfig.json --noEmit`。
//   2. 本 session 改過的檔案所對應的測試（tools/affected-tests.mjs），改檔當下沒跑成或逾時的，這裡補跑。
//   - 什麼都沒改：略過（純文件修改不需要）。
//   - 找不到 typescript（本資料夾與主工作樹都沒有）：明確標示「尚未驗證」，不假裝檢查過。
//   - 失敗：阻止結束並把錯誤交回 Claude 修；若已因此續跑過一次（stop_hook_active）就只警告，避免無限迴圈。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allow, clearEdited, findNodeModules, projectDir, readEdited, readInput, readVerified } from './lib.mjs';

const input = readInput();
const root = projectDir();
const editedAll = readEdited(input.session_id);
const editedWebTs = editedAll.filter((f) => /^web\/.+\.tsx?$/.test(f));
if (!editedAll.length) allow();

const problems = [];
const unverified = [];

// ---- 1. 補跑沒驗證成的測試 ----
const mapModule = path.join(root, 'tools', 'affected-tests.mjs');
if (fs.existsSync(mapModule)) {
  try {
    const { affectedForAll, runVerifiers } = await import(pathToFileURL(mapModule).href);
    const done = new Set(readVerified(input.session_id));
    const pending = affectedForAll(root, editedAll).files.filter((f) => !done.has(f));
    if (pending.length) {
      const result = runVerifiers(root, pending, { budgetMs: 100_000, perFileMs: 60_000 });
      for (const f of result.failed) problems.push(`測試失敗：${f.file}\n${f.out}`);
      for (const s of [...result.skipped, ...result.notRun]) unverified.push(`${s.file}（${s.reason}）`);
    }
  } catch (error) {
    unverified.push(`受影響測試的對照表執行失敗：${error?.message ?? error}`);
  }
}

// ---- 2. 型別檢查 ----
let tscTimedOut = false;
if (editedWebTs.length) {
  const nodeModules = findNodeModules(root);
  if (!nodeModules) {
    unverified.push('web 型別檢查（找不到 node_modules/typescript，請先 npm ci 再跑 npm run typecheck:v2）');
  } else {
    const tsc = path.join(nodeModules, 'typescript', 'bin', 'tsc');
    const run = spawnSync(process.execPath, [tsc, '-p', 'web/tsconfig.json', '--noEmit'], { cwd: root, encoding: 'utf8', timeout: 170_000, maxBuffer: 16 * 1024 * 1024 });
    if (run.error?.code === 'ETIMEDOUT') {
      tscTimedOut = true;
      unverified.push('web 型別檢查逾時（170 秒），請手動執行 npm run typecheck:v2');
    } else if (run.status !== 0) {
      const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(0, 25).join('\n');
      problems.push(`npm run typecheck:v2 失敗：\n${tail}`);
    }
  }
}

const unverifiedNote = unverified.length ? `\n以下項目尚未驗證，請在回報中如實說明：\n- ${unverified.join('\n- ')}` : '';

if (!problems.length) {
  if (!unverified.length) clearEdited(input.session_id);
  if (unverifiedNote) process.stdout.write(JSON.stringify({ systemMessage: `[stop-verify] 沒有失敗項目。${unverifiedNote}` }));
  allow();
}

const reason = `[stop-verify] 結束前驗證失敗，請修正後再結束：\n\n${problems.join('\n\n')}${unverifiedNote}`;
if (input.stop_hook_active || tscTimedOut) {
  process.stdout.write(JSON.stringify({ systemMessage: `${reason}\n（已續跑過一次，這次不再阻擋；請在回報中如實標示驗證未通過。）` }));
  allow();
}
process.stdout.write(JSON.stringify({ decision: 'block', reason }));
allow();
