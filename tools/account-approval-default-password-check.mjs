import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adminApi = readFileSync(new URL('../supabase/functions/admin-api/index.ts', import.meta.url), 'utf8');
const usersAdmin = readFileSync(new URL('../web/components/admin/UsersAdmin.tsx', import.meta.url), 'utf8');

assert.match(adminApi, /const ACCOUNT_APPLICATION_INITIAL_PASSWORD = '12345678';/);
assert.match(adminApi, /password:\s*ACCOUNT_APPLICATION_INITIAL_PASSWORD/);
assert.doesNotMatch(adminApi, /temporaryNumericPassword/);
assert.match(adminApi, /初始密碼為 12345678；啟用連結已寄出/);
assert.match(usersAdmin, /核准後初始密碼為 <strong>12345678<\/strong>/);
assert.match(usersAdmin, />核准並建立帳號<\/button>/);

// 初始密碼不得進入既有帳號建立稽核內容。
const approvalAuditStart = adminApi.indexOf("await audit('users'");
const approvalAuditEnd = adminApi.indexOf('return reply(req', approvalAuditStart);
assert.ok(approvalAuditStart >= 0 && approvalAuditEnd > approvalAuditStart, '找不到帳號核准稽核區塊');
const approvalAudit = adminApi.slice(approvalAuditStart, approvalAuditEnd);
assert.doesNotMatch(approvalAudit, /12345678|initial_password|temporaryPassword|password\s*:/i);

console.log('帳號申請核准檢查通過：初始密碼固定為 12345678、畫面提示一致，稽核不保存密碼本文。');
