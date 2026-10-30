// Claude Code hook 共用工具：讀 stdin JSON、輸出阻擋訊息。
// 所有 hook 都必須「失敗時放行」：本檔任何例外都不應讓整個工作流程卡死。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const readInput = () => {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const projectDir = () => path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// exit 2 + stderr：PreToolUse 會擋下該工具呼叫並把原因交給 Claude；PostToolUse 會把訊息交回 Claude。
export const block = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

export const allow = () => process.exit(0);

// 本 session 的狀態檔：PostToolUse 寫入，Stop 讀取。放系統暫存區，不進 repo。
//   edited：改過哪些檔案；verified：改檔當下已跑過且通過的測試（Stop 不重跑）。
const stateFile = (sessionId, kind = 'edited') => {
  const dir = path.join(os.tmpdir(), 'claude-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(sessionId || 'default').replace(/[^\w.-]/g, '_')}.${kind}`);
};

const appendState = (sessionId, kind, line) => {
  try {
    fs.appendFileSync(stateFile(sessionId, kind), `${line}\n`);
  } catch {
    /* 狀態檔寫不進去就算了，只是少一次收尾檢查 */
  }
};

const readState = (sessionId, kind) => {
  try {
    return [...new Set(fs.readFileSync(stateFile(sessionId, kind), 'utf8').split('\n').filter(Boolean))];
  } catch {
    return [];
  }
};

export const recordEdited = (sessionId, relPath) => appendState(sessionId, 'edited', relPath);
export const readEdited = (sessionId) => readState(sessionId, 'edited');
export const recordVerified = (sessionId, relPath) => appendState(sessionId, 'verified', relPath);
export const readVerified = (sessionId) => readState(sessionId, 'verified');

export const clearEdited = (sessionId) => {
  for (const kind of ['edited', 'verified']) {
    try {
      fs.rmSync(stateFile(sessionId, kind), { force: true });
    } catch {
      /* ignore */
    }
  }
};

// worktree 沒有自己的 node_modules 時，退到主工作樹那份（git common dir 的上一層）。
// 以 typescript/package.json 非空判斷「裝好了」：雲端硬碟上的 npm ci 可能留下 0 byte 的壞檔。
export const findNodeModules = (root) => {
  const usable = (dir) => {
    try {
      return fs.statSync(path.join(dir, 'node_modules', 'typescript', 'package.json')).size > 0;
    } catch {
      return false;
    }
  };
  if (usable(root)) return path.join(root, 'node_modules');
  try {
    const common = path.resolve(root, fs.readFileSync(path.join(root, '.git'), 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1].trim() ?? '', '..', '..');
    const main = path.dirname(common);
    if (usable(main)) return path.join(main, 'node_modules');
  } catch {
    /* 不是 worktree 或讀不到 .git：略過 */
  }
  return null;
};

// PostToolUse／SessionStart 的「提醒但不阻擋」訊息。
export const addContext = (eventName, text) =>
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }));

// 回傳 repo 相對路徑（正斜線）；不在 repo 內回傳 null。
export const toRelative = (root, filePath) => {
  if (!filePath) return null;
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replaceAll('\\', '/');
};
