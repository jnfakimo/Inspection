import fs from 'node:fs';
import path from 'node:path';

const roots = ['web', 'system'];
const extensions = new Set(['.html', '.js', '.jsx', '.ts', '.tsx', '.css', '.json', '.md']);
const forbidden = [
  { name: 'Supabase service-role 金鑰值', pattern: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"](?!\$\{)[^'"\s]+/i },
  { name: 'Supabase access token 值', pattern: /SUPABASE_ACCESS_TOKEN\s*[:=]\s*['"](?!\$\{)[^'"\s]+/i },
  { name: 'Edge Function 祕密值', pattern: /(?:LINE_CHANNEL_SECRET|CRON_SECRET|CAPTCHA_SECRET|IPCAM_PASSWORD|GOOGLE_TOKEN_ENCRYPTION_KEY)\s*[:=]\s*['"](?!\$\{)[^'"\s]+/i },
  { name: 'GitHub personal token', pattern: /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/ },
  { name: '私鑰區塊', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

function filesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesIn(file);
    return extensions.has(path.extname(entry.name).toLowerCase()) ? [file] : [];
  });
}

const findings = [];
for (const root of roots) {
  for (const file of filesIn(root)) {
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      for (const rule of forbidden) {
        if (rule.pattern.test(line)) findings.push(`${file}:${index + 1} ${rule.name}`);
      }
    });
  }
}

if (findings.length) {
  console.error('前端／靜態頁面疑似包含不可公開的祕密：');
  findings.forEach(item => console.error(`- ${item}`));
  process.exitCode = 1;
} else {
  console.log('安全祕密掃描通過：web/ 與 system/ 未發現 Edge Function 私密值。');
}
