// 「改了哪個檔案 → 該跑哪些測試」的單一對照來源。
// 使用者：.claude/hooks/post-edit-check.mjs（改檔當下）、stop-typecheck.mjs（結束前）、.githooks/pre-push.mjs（推送前）。
// 規則（只看檔案，不執行任何東西）：
//   1. 改的是測試／檢查腳本本身 → 跑它自己。
//   2. 改 supabase/migrations/*.sql → 內文提到該 migration 檔名的測試，加上 tools/schema-contract-check.mjs。
//   3. 改 tools／web／supabase/functions 的程式碼 → 同目錄的 <名稱>.test.*，加上內文 import／讀取該檔的測試與檢查腳本。
// CLI：node tools/affected-tests.mjs [--base <ref>] [--files a b ...] [--run] [--json]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCAN_DIRS = ['tools', 'web/lib', 'web/app', 'supabase/functions'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'out', 'worktrees']);
const CODE_RE = /\.(?:tsx?|mjs|cjs|js)$/;
const TEST_RE = /\.test\.(?:tsx?|mjs|cjs|js)$/;
const CHECK_RE = /^tools\/[^/]+-check\.mjs$/;
// 這些名稱太通用，反向比對會拉進一堆無關測試，只用「同目錄 sibling 測試」。
const GENERIC = new Set(['index', 'route', 'page', 'layout', 'types', 'utils', 'constants', 'config', 'main']);
const MAX_AFFECTED = 8;
const FIXED_MIGRATION_GATE = 'tools/schema-contract-check.mjs';
// 套件缺少或安裝壞掉（例如雲端硬碟上 npm ci 產生 0 byte 的 package.json）都是環境問題，不是測試失敗。
const MODULE_MISSING = /ERR_MODULE_NOT_FOUND|ERR_INVALID_PACKAGE_CONFIG|Cannot find (?:package|module)/;

const toPosix = (p) => p.replaceAll('\\', '/');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const walk = (root, relDir, out) => {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(root, `${relDir}/${e.name}`, out);
    } else if (TEST_RE.test(e.name) || CHECK_RE.test(`${relDir}/${e.name}`)) {
      out.push(`${relDir}/${e.name}`);
    }
  }
};

// 回傳 { files: string[], text: Map<string,string> }，text 內容是惰性讀取後快取。
export const listVerifiers = (root) => {
  const files = [];
  for (const dir of SCAN_DIRS) walk(root, dir, files);
  const cache = new Map();
  const text = (rel) => {
    if (!cache.has(rel)) {
      try {
        cache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
      } catch {
        cache.set(rel, '');
      }
    }
    return cache.get(rel);
  };
  return { files: [...new Set(files)], text };
};

export const isVerifier = (rel) => TEST_RE.test(rel) || CHECK_RE.test(rel);

// rel：repo 相對路徑（正斜線）。回傳 { files, truncated }。
export const affectedFor = (root, rel, verifiers = listVerifiers(root)) => {
  rel = toPosix(rel);
  const found = [];
  const add = (f) => {
    if (f !== rel && !found.includes(f)) found.push(f);
  };
  const exists = (f) => fs.existsSync(path.join(root, f));

  if (isVerifier(rel)) return { files: exists(rel) ? [rel] : [], truncated: false };

  if (/^supabase\/migrations\/[^/]+\.sql$/.test(rel)) {
    const name = path.posix.basename(rel);
    for (const f of verifiers.files) if (verifiers.text(f).includes(name)) add(f);
    if (exists(FIXED_MIGRATION_GATE)) add(FIXED_MIGRATION_GATE);
  } else if (CODE_RE.test(rel) && /^(?:tools|web|supabase\/functions)\//.test(rel)) {
    const dir = path.posix.dirname(rel);
    const base = path.posix.basename(rel).replace(CODE_RE, '');
    for (const ext of ['ts', 'tsx', 'mjs', 'js', 'cjs']) {
      const sibling = `${dir}/${base}.test.${ext}`;
      if (exists(sibling)) add(sibling);
    }
    if (!GENERIC.has(base)) {
      const ref = new RegExp(`[/'"\`]${escapeRe(base)}(?:\\.(?:tsx?|mjs|cjs|js))?['"\`]`);
      for (const f of verifiers.files) if (ref.test(verifiers.text(f))) add(f);
    }
  }
  return { files: found.slice(0, MAX_AFFECTED), truncated: found.length > MAX_AFFECTED };
};

export const affectedForAll = (root, rels) => {
  const verifiers = listVerifiers(root);
  const files = [];
  let truncated = false;
  for (const rel of [...new Set(rels.map(toPosix))]) {
    const r = affectedFor(root, rel, verifiers);
    truncated ||= r.truncated;
    for (const f of r.files) if (!files.includes(f)) files.push(f);
  }
  return { files, truncated };
};

export const commandFor = (file) =>
  TEST_RE.test(file)
    ? ['--experimental-strip-types', '--no-warnings', '--test', file]
    : ['--experimental-strip-types', '--no-warnings', file];

// 依序執行，總時間不超過 budgetMs。結果分四類：
//   passed／failed（真的失敗，要擋）／skipped（缺套件，未驗證）／notRun（預算用完或單檔逾時，未驗證）。
export const runVerifiers = (root, files, { budgetMs = 60_000, perFileMs = 45_000 } = {}) => {
  const result = { passed: [], failed: [], skipped: [], notRun: [] };
  const started = Date.now();
  for (const file of files) {
    const left = budgetMs - (Date.now() - started);
    if (left < 1500) {
      result.notRun.push({ file, reason: '時間預算用完' });
      continue;
    }
    const run = spawnSync(process.execPath, commandFor(file), {
      cwd: root,
      encoding: 'utf8',
      timeout: Math.min(left, perFileMs),
      maxBuffer: 8 * 1024 * 1024,
    });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    if (run.error?.code === 'ETIMEDOUT') result.notRun.push({ file, reason: '執行逾時' });
    else if (run.status === 0) result.passed.push(file);
    else if (MODULE_MISSING.test(out)) result.skipped.push({ file, reason: '缺少或損壞的套件（請在本機磁碟 npm ci）' });
    else result.failed.push({ file, out: out.trim().split('\n').slice(-14).join('\n') });
  }
  return result;
};

export const changedFilesSince = (root, base) => {
  const r = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
};

const main = () => {
  const args = process.argv.slice(2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const flag = (name) => args.indexOf(name);
  let rels = [];
  const fi = flag('--files');
  if (fi >= 0) rels = args.slice(fi + 1).filter((a) => !a.startsWith('--'));
  const bi = flag('--base');
  if (bi >= 0) rels = changedFilesSince(root, args[bi + 1]);
  const { files, truncated } = affectedForAll(root, rels);
  if (flag('--json') >= 0 && flag('--run') < 0) {
    console.log(JSON.stringify({ files, truncated }, null, 2));
    return;
  }
  console.log(`影響到的測試／檢查（${files.length} 個${truncated ? '，已截斷' : ''}）：\n${files.map((f) => `  - ${f}`).join('\n') || '  （無）'}`);
  if (flag('--run') < 0) return;
  const result = runVerifiers(root, files, { budgetMs: 10 * 60_000, perFileMs: 5 * 60_000 });
  console.log(`通過 ${result.passed.length}／失敗 ${result.failed.length}／缺套件 ${result.skipped.length}／未執行 ${result.notRun.length}`);
  for (const f of result.failed) console.error(`✗ ${f.file}\n${f.out}`);
  process.exit(result.failed.length ? 1 : 0);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
