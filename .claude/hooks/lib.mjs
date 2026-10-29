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

// 本 session 改過哪些檔案：PostToolUse 寫入，Stop 讀取。放系統暫存區，不進 repo。
const stateFile = (sessionId) => {
  const dir = path.join(os.tmpdir(), 'claude-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(sessionId || 'default').replace(/[^\w.-]/g, '_')}.edited`);
};

export const recordEdited = (sessionId, relPath) => {
  try {
    fs.appendFileSync(stateFile(sessionId), `${relPath}\n`);
  } catch {
    /* 狀態檔寫不進去就算了，只是少一次收尾檢查 */
  }
};

export const readEdited = (sessionId) => {
  try {
    return [...new Set(fs.readFileSync(stateFile(sessionId), 'utf8').split('\n').filter(Boolean))];
  } catch {
    return [];
  }
};

export const clearEdited = (sessionId) => {
  try {
    fs.rmSync(stateFile(sessionId), { force: true });
  } catch {
    /* ignore */
  }
};

// 回傳 repo 相對路徑（正斜線）；不在 repo 內回傳 null。
export const toRelative = (root, filePath) => {
  if (!filePath) return null;
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.replaceAll('\\', '/');
};
