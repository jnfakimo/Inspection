// 資安告警在通知中心只能留「指標」，不得複製告警內容（ISO/IEC 27001 最小揭露）。
// 完整內容只存在 security_alerts（管理員專用、RLS 強制、防刪除 trigger）。
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const monitor = readFileSync(new URL('../supabase/functions/_shared/security-monitor.ts', import.meta.url), 'utf8');
const start = monitor.indexOf('async function createAdminNotices');
assert.ok(start >= 0, '找不到 createAdminNotices');
const end = monitor.indexOf('\nasync function ', start + 10);
const body = monitor.slice(start, end > start ? end : start + 1500);
for (const forbidden of ['alert.message', 'alert.title', 'alert.details', 'alert.event_count', 'ip_address', 'resource']) {
  assert.ok(!body.includes(forbidden), `通知中心副本不得包含告警內容：${forbidden}`);
}
assert.match(body, /event: "security_alert"/);
assert.match(body, /recipient_id: row\.user_id/, '副本必須指定收件管理員，不得是無收件人的公開列');

const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url));
const retention = migrations.find(name => name.endsWith('_security_notice_retention.sql'));
assert.ok(retention, '缺少資安通知保存期限 migration');
const sql = readFileSync(new URL(`../supabase/migrations/${retention}`, import.meta.url), 'utf8');
assert.match(sql, /purge_expired_security_notices/);
assert.match(sql, /grant execute on function public\.purge_expired_security_notices\(timestamptz\) to service_role/);
assert.match(sql, /revoke all on function public\.purge_expired_security_notices\(timestamptz\) from public, anon, authenticated/);

// 只能清除通知副本；證據資料表維持 append-only，保存政策不得改動它們。
// 以明確的 regex 常值列出（不動態組字串），並在下方以反例證明斷言真的會失敗。
const evidenceTamper = [
  /delete\s+from\s+(public\.)?security_alerts\b/i,
  /delete\s+from\s+(public\.)?security_alert_deliveries\b/i,
  /delete\s+from\s+(public\.)?security_session_blocks\b/i,
  /drop\s+trigger[^;]*security_(alerts|alert_deliveries|session_blocks)\b/i,
  /disable\s+trigger[^;]*security_(alerts|alert_deliveries|session_blocks)\b/i,
];
const tampers = text => evidenceTamper.some(pattern => pattern.test(text));
assert.equal(tampers('delete from public.security_alerts where true;'), true, '反例：刪除證據必須被偵測');
assert.equal(tampers('DELETE  FROM security_session_blocks;'), true, '反例：大小寫與空白變化也必須被偵測');
assert.equal(tampers('drop trigger trg_prevent_security_alert_removal on public.security_alerts;'), true, '反例：解除防護必須被偵測');
assert.equal(tampers(sql), false, '保存政策不得刪除或解除證據資料表的保護');

const alertFn = readFileSync(new URL('../supabase/functions/platform-log-alert/index.ts', import.meta.url), 'utf8');
assert.match(alertFn, /rpc\("purge_expired_security_notices"\)/, '排程函式必須呼叫保存期限清除');

console.log('資安通知最小揭露與保存期限檢查通過：通知中心只留告警指標，證據資料表不受清除影響。');
