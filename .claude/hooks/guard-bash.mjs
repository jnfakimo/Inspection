// PreToolUse(Bash)：擋下 AGENTS.md 明令禁止的 git 動作。
//   - git add . / -A / --all / *      （只能逐一列出本次相關檔案）
//   - git commit -a / -am             （等同一次 stage 全部已追蹤變更）
//   - git push --force / -f / --force-with-lease
//   - git reset --hard、git clean -f
//   - git add 機密檔（.env、auth.json、*.sqlite、*.pem、cookie…）
// 多個 agent 共用同一份工作樹，這些動作會把別人未提交的變更一起帶走或洗掉。
import { allow, block, readInput } from './lib.mjs';
import { SECRET_FILE } from './secret-patterns.mjs';

const input = readInput();
if (input.tool_name && input.tool_name !== 'Bash') allow();
const command = String(input.tool_input?.command ?? '');
if (!command.trim()) allow();

// 先拿掉引號內的字串，避免 `echo "git add ."` 之類被誤擋；再依 && || ; | 換行切段。
const stripQuoted = (text) => text.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
const segments = stripQuoted(command).split(/&&|\|\||;|\||\r?\n/);


const problems = [];
for (const raw of segments) {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const gitAt = words.indexOf('git');
  if (gitAt === -1) continue;
  // 略過 git 的全域選項（-C <dir>、-c k=v、--no-pager 等）找到子命令。
  let i = gitAt + 1;
  while (i < words.length && words[i].startsWith('-')) i += words[i] === '-C' || words[i] === '-c' ? 2 : 1;
  const sub = words[i];
  const args = words.slice(i + 1);
  const has = (...flags) => args.some((a) => flags.includes(a));

  if (sub === 'add') {
    const paths = args.filter((a) => !a.startsWith('-'));
    if (has('-A', '--all') || paths.some((p) => p === '.' || p === '*' || p === ':/' || p === './')) {
      problems.push('禁止 `git add .` / `-A` / `--all`：請逐一列出本次相關檔案。');
    }
    const secret = paths.find((p) => SECRET_FILE.test(p));
    if (secret) problems.push(`禁止 stage 疑似機密檔：${secret}（cookie、token、API key、auth.json、SQLite 不得進 repo）。`);
  }
  if (sub === 'commit' && args.some((a) => a === '-a' || a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a) && !a.startsWith('--'))) {
    problems.push('禁止 `git commit -a`：會連同他人未提交的已追蹤變更一起提交，請先個別 `git add <檔案>`。');
  }
  if (sub === 'push' && (has('-f', '--force', '--force-with-lease') || args.some((a) => a.startsWith('--force-with-lease=') || /^\+\S/.test(a)))) {
    problems.push('禁止 force push：遇到衝突請 fetch 後 rebase，必要時回報而不是強推。');
  }
  if (sub === 'reset' && has('--hard')) {
    problems.push('禁止 `git reset --hard`：會洗掉其他 agent 或使用者尚未提交的工作。');
  }
  if (sub === 'clean' && args.some((a) => /^-[a-zA-Z]*f/.test(a) || a === '--force')) {
    problems.push('禁止 `git clean -f`：會刪除未追蹤檔案，可能含他人的工作成果。');
  }
}

if (problems.length) block(`[guard-bash] 已攔截此指令（規則見 AGENTS.md Git workflow）：\n- ${[...new Set(problems)].join('\n- ')}`);
allow();
