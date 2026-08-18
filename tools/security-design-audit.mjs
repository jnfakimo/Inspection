#!/usr/bin/env node
/**
 * V2 開發前資安閘門：檢查提交內容是否出現明顯的機密外洩或危險執行模式。
 * 這是 ISO/IEC 27000 系列的工程前置檢核，不等同第三方驗證或認證。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const roots = ['web', 'supabase', 'tools'];
const findings = [];
const add = (severity, file, rule, message) => findings.push({ severity, file: path.relative(root, file).replaceAll('\\', '/'), rule, message });

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'out', '_site', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(?:tsx?|jsx?|mjs|css|sql|ya?ml|json)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

for (const relative of roots) {
  for (const file of walk(path.join(root, relative))) {
    const text = fs.readFileSync(file, 'utf8');
    if (/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["']eyJ/i.test(text)) add('error', file, '硬編碼服務金鑰', '不可將 service_role JWT 寫入前端或版本庫。');
    if (/-----BEGIN (?:RSA |EC |)PRIVATE KEY-----\s*\r?\n[A-Za-z0-9+/=\r\n]{100,}\r?\n-----END (?:RSA |EC |)PRIVATE KEY-----/.test(text)) add('error', file, '硬編碼私鑰', '私鑰只能透過受控的部署密鑰注入。');
    if (/\beval\s*\(|new\s+Function\s*\(/.test(text)) add('error', file, '動態程式碼執行', '禁止 eval／new Function，避免注入風險。');
    if (/http:\/\/(?!localhost|127\.0\.0\.1|www\.w3\.org)/i.test(text)) add('warning', file, '非加密連線', '確認此 URL 僅限受控的內部設備來源，正式外部服務必須使用 HTTPS。');
    if (/dangerouslySetInnerHTML/.test(text) && !file.endsWith('security-design-audit.mjs')) add('warning', file, 'HTML 注入 API', '確認內容已固定或完成跳脫，並保留 CSP 防線。');
    if (/document\.write\s*\(/.test(text)) add('warning', file, '文件字串輸出', '列印或報表內容必須逐欄跳脫，優先改為 React 列印區塊。');
  }
}

const errors = findings.filter(item => item.severity === 'error');
const warnings = findings.filter(item => item.severity === 'warning');
console.log(`資安設計自我檢核：錯誤 ${errors.length}，警告 ${warnings.length}`);
for (const item of findings) console.log(`[${item.severity === 'error' ? '錯誤' : '警告'}] ${item.file}（${item.rule}）${item.message}`);
if (errors.length) process.exitCode = 1;
