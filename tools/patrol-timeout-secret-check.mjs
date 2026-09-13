import fs from 'node:fs';

const legacyMigrations = [
  'supabase/migrations/20260719195500_patrol_timeout_notifications.sql',
  'supabase/migrations/20260720093500_fix_patrol_timeout_cron_auth.sql',
  'supabase/migrations/20260721110500_patrol_timeout_sync_http_cron.sql',
];

const failures = [];
for (const file of legacyMigrations) {
  const text = fs.readFileSync(file, 'utf8');
  if (/Bearer\s+eyJ[A-Za-z0-9_.-]+/i.test(text)) {
    failures.push(`${file} 仍包含硬編碼 Bearer JWT`);
  }
  if (/cron\.schedule\s*\(/i.test(text)) {
    failures.push(`${file} 不得重新建立已淘汰的資料庫通知排程`);
  }
}

const workflow = fs.readFileSync('.github/workflows/patrol-line-notify.yml', 'utf8');
if (!/CRON_SECRET:\s*\$\{\{\s*secrets\.CRON_SECRET\s*\}\}/.test(workflow)) {
  failures.push('巡檢通知 workflow 未由 GitHub Secret 注入 CRON_SECRET');
}
if (!/-H\s+"x-cron-secret:\s*\$CRON_SECRET"/.test(workflow)) {
  failures.push('巡檢通知 workflow 未傳送 x-cron-secret');
}

const edgeFunction = fs.readFileSync('supabase/functions/patrol-timeout-check/index.ts', 'utf8');
if (!/Deno\.env\.get\("CRON_SECRET"\)/.test(edgeFunction)) {
  failures.push('patrol-timeout-check 未從 Edge Function Secret 讀取 CRON_SECRET');
}
if (!/safeEqual\(req\.headers\.get\("x-cron-secret"\)/.test(edgeFunction)) {
  failures.push('patrol-timeout-check 未以常數時間比較 x-cron-secret');
}

if (failures.length) {
  console.error('巡檢逾時排程秘密檢查失敗：');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log('巡檢逾時排程秘密檢查通過：SQL 無硬編碼 JWT，排程使用 CRON_SECRET。');
}
