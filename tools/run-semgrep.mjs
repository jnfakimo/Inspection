import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const roots = ['web', 'system', 'supabase/functions', 'supabase/migrations', 'backend'];
const extensions = new Set([
  '.cjs', '.html', '.js', '.jsx', '.json', '.mjs', '.ps1', '.py', '.sql',
  '.toml', '.ts', '.tsx', '.yaml', '.yml',
]);
const excludedPrefixes = [
  'web/.next/',
  'web/out/',
  'web/public/vendor/',
  'system/vendor/',
  'system/plans/',
  'system/icons/',
  'backend/node-api/dist/',
];

const listed = spawnSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...roots],
  { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
if (listed.error || listed.status !== 0) {
  console.error(`無法列出 Semgrep 掃描目標：${listed.error?.message || listed.stderr}`);
  process.exit(1);
}

const files = listed.stdout.split('\0').filter(Boolean).filter(file => {
  const normalized = file.replaceAll('\\', '/');
  return extensions.has(path.extname(normalized).toLowerCase())
    && !excludedPrefixes.some(prefix => normalized.startsWith(prefix));
});
if (!files.length) {
  console.error('Semgrep 沒有可掃描的正式原始碼。');
  process.exit(1);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'beinong-semgrep-'));
let result;
try {
  for (const file of files) {
    const source = path.resolve(file);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const destination = path.join(staging, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  result = spawnSync(
    process.platform === 'win32' ? 'semgrep.exe' : 'semgrep',
    [
      'scan',
      '--config', path.resolve('security/semgrep.yml'),
      '--metrics=off',
      '--error',
      '--no-git-ignore',
      staging,
    ],
    {
      cwd: staging,
      env: { ...process.env, PYTHONUTF8: '1' },
      stdio: 'inherit',
      shell: false,
    },
  );
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

if (result?.error) {
  console.error(`無法啟動 Semgrep：${result.error.message}`);
  process.exitCode = 1;
} else {
  console.log(`Semgrep 已掃描 ${files.length} 個正式原始碼檔案。`);
  process.exitCode = result?.status ?? 1;
}
