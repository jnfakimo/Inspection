// Stop：本 session 改過 web/ 的 ts／tsx，結束前跑一次 `tsc -p web/tsconfig.json --noEmit`。
//   - 沒改過 web 程式碼：略過（純文件、SQL、tools 修改不需要）。
//   - 找不到 node_modules/typescript（例如雲端硬碟副本）：略過並提示，不假裝檢查過。
//   - 失敗：阻止結束並把錯誤交回 Claude 修；若已因此續跑過一次（stop_hook_active）就只警告，避免無限迴圈。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { allow, clearEdited, projectDir, readEdited, readInput } from './lib.mjs';

const input = readInput();
const root = projectDir();
const edited = readEdited(input.session_id).filter((f) => /^web\/.+\.tsx?$/.test(f));
if (!edited.length) allow();

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tsc)) {
  process.stdout.write(JSON.stringify({ systemMessage: '[stop-typecheck] 這個資料夾沒有 node_modules/typescript，已略過型別檢查（尚未驗證）。' }));
  allow();
}

const run = spawnSync(process.execPath, [tsc, '-p', 'web/tsconfig.json', '--noEmit'], { cwd: root, encoding: 'utf8', timeout: 170_000, maxBuffer: 16 * 1024 * 1024 });
if (run.status === 0) {
  clearEdited(input.session_id);
  allow();
}

const timedOut = run.error?.code === 'ETIMEDOUT';
const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(0, 25).join('\n');
const reason = timedOut ? '[stop-typecheck] 型別檢查逾時（170 秒），請手動執行 npm run typecheck:v2。' : `[stop-typecheck] npm run typecheck:v2 失敗，請修正後再結束：\n${tail}`;

if (input.stop_hook_active || timedOut) {
  process.stdout.write(JSON.stringify({ systemMessage: `${reason}\n（已續跑過一次，這次不再阻擋；請在回報中如實標示型別檢查未通過。）` }));
  allow();
}
process.stdout.write(JSON.stringify({ decision: 'block', reason }));
allow();
