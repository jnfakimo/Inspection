// 唯讀正式部署檢查：limit=0 驗證欄位與排序，不下載交接內容或人員資料。
// 於受保護的 Node 環境使用 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。
const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('請在受保護環境設定 Supabase 網址與服務金鑰；不可將金鑰放入瀏覽器。');
const url = new URL(base);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Supabase 網址無效。');

const checks = [
  ['人員資料', 'users', 'user_id,name,username,email,role,rbac_role,department,dept_id,status'],
  ['交接事項', 'business_handover_entries', '*', 'shift_code,created_at'],
  ['主管批核', 'business_handover_approvals', '*', 'created_at'],
  ['事項完成紀錄', 'business_handover_completions', '*'],
  ['雙方簽認紀錄', 'business_handover_transfers', '*'],
  ['個人大系統授權', 'user_system_access', 'user_id,system_key,mode'],
  ['個人子系統授權', 'user_module_access', 'user_id,system_key,module_key,mode'],
  ['角色子系統授權', 'role_module_access', 'role_id,system_key,module_key,mode'],
  ['角色權限', 'role_permissions', 'role_id,perm,allowed'],
];
let failures = 0;
for (const [label, table, select, order] of checks) {
  const params = new URLSearchParams({ select, limit: '0' });
  if (order) params.set('order', order);
  try {
    const response = await fetch(`${base}/rest/v1/${table}?${params}`, {
      headers: { apikey: key }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error(`${label}：失敗（HTTP ${response.status}，代碼 ${error.code || '未知'}）`);
      failures++;
    } else console.log(`${label}：成功`);
  } catch {
    console.error(`${label}：連線失敗`);
    failures++;
  }
}
if (failures) { process.exitCode = 1; console.error(`${failures} 項相依資料檢查失敗，部署尚未就緒。`); }
else console.log('業管組交接簿相依資料表與欄位均可查詢；本檢查不代表已驗證正式帳號的簽認操作。');
