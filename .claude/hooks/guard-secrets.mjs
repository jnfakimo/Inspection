// PreToolUse(Write|Edit|MultiEdit)：寫入內容含機密樣式、或目標是機密檔時擋下。
// 規則：cookie、token、API key、service-role key、auth.json、SQLite 不得出現在 repo。
// 確屬假資料（測試樣本、說明文件）時，在該行加上 `allow-secret-pattern` 註記即可放行。
import { allow, block, projectDir, readInput, toRelative } from './lib.mjs';
import { SECRET_FILE, findSecretLabels } from './secret-patterns.mjs';

const input = readInput();
const tool = input.tool_name;
if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) allow();

const ti = input.tool_input ?? {};
const root = projectDir();
const rel = toRelative(root, ti.file_path) ?? String(ti.file_path ?? '');

if (SECRET_FILE.test(rel)) {
  block(`[guard-secrets] 不寫入疑似機密檔：${rel}。機密請放環境變數或密碼管理員，範本用 .env.example。`);
}

const chunks = [];
if (tool === 'Write') chunks.push(String(ti.content ?? ''));
if (tool === 'Edit') chunks.push(String(ti.new_string ?? ''));
if (tool === 'MultiEdit') for (const e of ti.edits ?? []) chunks.push(String(e?.new_string ?? ''));

const hits = [];
for (const chunk of chunks) for (const line of chunk.split(/\r?\n/)) hits.push(...findSecretLabels(line));

if (hits.length) {
  block(`[guard-secrets] 寫入內容疑似含機密（${[...new Set(hits)].join('、')}），已攔截 ${rel}。\n改用環境變數／GitHub Secrets；若確定是假資料，在該行加上 allow-secret-pattern 註記。`);
}
allow();
