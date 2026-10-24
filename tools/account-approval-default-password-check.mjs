import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminApi = readFileSync(new URL('../supabase/functions/admin-api/index.ts', import.meta.url), 'utf8');
const usersAdmin = readFileSync(new URL('../web/components/admin/UsersAdmin.tsx', import.meta.url), 'utf8');

assert.match(adminApi, /createUser\(\{\s*email: application\.email, email_confirm: true/);
assert.doesNotMatch(adminApi, /ACCOUNT_APPLICATION_INITIAL_PASSWORD|initialPassword|初始密碼為 12345678/);
assert.match(adminApi, /使用者須透過連結設定密碼/);
assert.match(usersAdmin, /核准後會寄送啟用連結/);
assert.match(usersAdmin, />核准並建立帳號<\/button>/);

// 初始密碼不得進入既有帳號建立稽核內容。
const approvalAuditStart = adminApi.indexOf("await audit('users'");
const approvalAuditEnd = adminApi.indexOf('return reply(req', approvalAuditStart);
assert.ok(approvalAuditStart >= 0 && approvalAuditEnd > approvalAuditStart, '找不到帳號核准稽核區塊');
const approvalAudit = adminApi.slice(approvalAuditStart, approvalAuditEnd);
assert.doesNotMatch(approvalAudit, /initialPassword|initial_password|temporaryPassword|password\s*:/i);

console.log('帳號申請核准檢查通過：建立帳號不配置初始密碼、使用者經啟用信設密碼、回應與稽核不保存密碼本文。');
