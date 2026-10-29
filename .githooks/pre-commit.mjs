// pre-commit：檢查「已 stage」的內容。
//   1. 檔名是機密檔（.env、auth.json、*.sqlite、*.pem、cookie…）
//   2. 新增的行含機密樣式（service_role JWT、API key、GitHub token、私鑰…）
// 規則與 Claude Code hook 共用 .claude/hooks/secret-patterns.mjs。
// 假資料在該行加 `allow-secret-pattern` 註記；確有必要才用 `git commit --no-verify`，並在回報說明原因。
import { spawnSync } from 'node:child_process';
import { SECRET_FILE, findSecretLabels } from '../.claude/hooks/secret-patterns.mjs';

const git = (args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).stdout.split('\0').filter(Boolean);
const problems = [];

for (const name of names) if (SECRET_FILE.test(name)) problems.push(`疑似機密檔：${name}`);

let file = '';
let lineNo = 0;
const diff = git(['diff', '--cached', '-U0', '--no-color', '--diff-filter=ACMR']).stdout;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.slice(4).replace(/^b\//, '');
    continue;
  }
  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
  if (hunk) {
    lineNo = Number(hunk[1]);
    continue;
  }
  if (!line.startsWith('+')) continue;
  const labels = findSecretLabels(line.slice(1).replace(/\r$/, ''));
  if (labels.length) problems.push(`${file}:${lineNo} 疑似含 ${[...new Set(labels)].join('、')}`);
  lineNo += 1;
}

if (problems.length) {
  process.stderr.write(
    `[pre-commit] 已攔截提交，疑似含機密：\n- ${problems.join('\n- ')}\n` +
      '機密請放環境變數／GitHub Secrets；確屬假資料在該行加 allow-secret-pattern 註記後重新 stage。\n',
  );
  process.exit(1);
}
