import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20260913193000_vehicle_two_level_approval.sql', 'utf8');
const workspace = fs.readFileSync('web/app/systems/[system]/[module]/vehicle-workspace.tsx', 'utf8');
const schema = fs.readFileSync('system/sql/vehicle_dispatch.sql', 'utf8');

for (const source of [migration, workspace, schema]) {
  assert.match(source, /pending_manager_approval/, '必須定義「待部門經理核准」狀態');
}

for (const field of ['department_manager_id', 'department_manager_name', 'department_manager_note', 'department_manager_approved_at']) {
  assert.match(migration, new RegExp(`add column if not exists ${field}\\b`), `migration 缺少 ${field}`);
}
for (const field of ['department_manager_name', 'department_manager_note', 'department_manager_approved_at']) {
  assert.match(workspace, new RegExp(`row\\.${field}\\b`), `畫面缺少 ${field}`);
}

assert.match(migration, /new\.status='assigned' and old\.status<>'assigned'[\s\S]*old\.status<>'approved'[\s\S]*old\.supervisor_id is null[\s\S]*old\.department_manager_id is null/, '派車前必須由後端檢查兩層核准');
assert.match(migration, /insert into public\.vehicle_dispatch_logs[\s\S]*v_log_action[\s\S]*v_actor_name/, '兩層核准必須寫入操作人與時間紀錄');
assert.match(migration, /僅限申請人所屬課長核准或退回/, '課長階段必須限定申請人所屬課長');
assert.match(migration, /僅限申請人所屬部門經理核准或退回/, '經理階段必須限定申請人所屬部門經理');
assert.match(migration, /create policy vehicle_requests_scoped_read[\s\S]*can_review_vehicle_request\(applicant_id\)/, '課長與部門經理必須能在 RLS 下看到待核申請');
assert.match(workspace, /1\. 申請人填單[\s\S]*2\. 課長核准[\s\S]*3\. 部門經理核准[\s\S]*4\. 派車人員派車[\s\S]*5\. 司機接單與回報/, '畫面必須完整顯示五步驟流程');

console.log('公務車兩層核准流程檢查通過');
