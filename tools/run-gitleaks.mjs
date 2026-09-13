import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const listed = spawnSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
if (listed.error || listed.status !== 0) {
  console.error(`無法列出 Gitleaks 掃描目標：${listed.error?.message || listed.stderr}`);
  process.exit(1);
}

const files = listed.stdout.split('\0').filter(Boolean);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'beinong-gitleaks-'));
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
    process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks',
    [
      'dir', staging,
      '--config', path.resolve('.gitleaks.toml'),
      '--redact',
      '--no-banner',
    ],
    { cwd: staging, stdio: 'inherit', shell: false },
  );
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

if (result?.error) {
  console.error(`無法啟動 Gitleaks：${result.error.message}`);
  process.exitCode = 1;
} else {
  console.log(`Gitleaks 已掃描 ${files.length} 個目前版控檔案。`);
  process.exitCode = result?.status ?? 1;
}
