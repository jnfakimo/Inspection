import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261028090000_vehicle_direct_dispatch.sql', 'utf8');
const workspace = fs.readFileSync('web/app/systems/[system]/[module]/vehicle-workspace.tsx', 'utf8');
const schema = fs.readFileSync('system/sql/vehicle_dispatch.sql', 'utf8');

for (const column of ['dispatch_source', 'direct_dispatch_reason', 'direct_dispatch_by', 'direct_dispatch_by_name']) {
  assert.match(migration, new RegExp(`add column if not exists ${column}\\b`), `migration 缺少 ${column}`);
  assert.match(schema, new RegExp(`add column if not exists ${column}\\b`), `system/sql/vehicle_dispatch.sql 缺少 ${column}`);
}

// 後端：只有派車管理員／系統管理員、事由必填、單一交易完成建單與派車、走既有 approved -> assigned 路徑。
assert.match(migration, /create or replace function public\.vehicle_direct_dispatch\(/, '缺少直接派車 RPC');
assert.match(migration, /只有派車管理員可以直接派車/, '直接派車必須限定派車管理員');
assert.match(migration, /請填寫臨時急用事由/, '臨時急用事由必須必填');
assert.match(migration, /'approved', 'direct'[\s\S]*status = 'assigned'/, '必須先以待派車建單，再走既有 approved -> assigned 派車路徑');
assert.match(migration, /臨時直接建單（免課長與部門經理核准）/, '流程歷程必須註明免核准直派');
assert.match(migration, /revoke all on function public\.vehicle_direct_dispatch\([^)]*\) from public, anon;/, '直接派車 RPC 不得開放給 anon');
assert.match(migration, /grant execute on function public\.vehicle_direct_dispatch\([^)]*\) to authenticated;/);
assert.match(migration, /建立後不得修改/, '來源與事由建立後不得被改寫');
assert.match(migration, /old\.dispatch_source = 'direct'[\s\S]*elsif old\.supervisor_id is null/, '一般單仍須課長與部門經理核准才能派車');

// 前端：只對派車管理員顯示入口，走專用 RPC，列表與詳情標示臨時直派，不新增子系統。
assert.match(workspace, /canManageFleet && <button[\s\S]{0,120}?>臨時直接派車<\/button>/, '入口只能對派車管理員顯示');
assert.match(workspace, /rpc\('vehicle_direct_dispatch'/, '前端必須呼叫 vehicle_direct_dispatch');
assert.match(workspace, /dispatch_source === 'direct' && <span className="vehicle-direct-flag"/, '列表必須標示臨時直派');
assert.match(workspace, /臨時急用事由/, '畫面必須有臨時急用事由');
// 臨時直接派車：用途與事由為「空白輸入欄＋下拉選單」（可直接輸入，也可從清單選），用車日期走日曆選擇器。
assert.match(workspace, /VEHICLE_DIRECT_REASON_OPTIONS = \['長官臨時指派用車'\]/, '臨時急用事由必須有常用選項');
assert.match(workspace, /reason: '', vehicle_id: ''/, '臨時急用事由預設為空白欄位');
assert.match(workspace, /<VehicleCombobox id="direct-purpose" menu /, '用途必須是可輸入、可下拉選擇的欄位');
assert.match(workspace, /<VehicleCombobox id="direct-reason" menu /, '臨時急用事由必須是可輸入、可下拉選擇的欄位');
assert.doesNotMatch(workspace, /VehicleSelectOther/, '用途與事由不再使用下拉加其他的元件');
// 詳情與行車回報視窗：分區卡片，不再是一整片欄位磚。
assert.match(workspace, /<VehicleDetailSection icon="calendar" title="用車資訊"/, '詳情視窗必須分區顯示用車資訊');
assert.match(workspace, /<VehicleFormSection icon="clock" title="實際行程時間"/, '行車回報視窗必須分區顯示');
assert.doesNotMatch(workspace, /className="detail-grid"/, '詳情視窗不得退回舊的欄位磚版型');
assert.match(workspace, /<LocalizedDateInput aria-label="用車日期（年\/月\/日）" value=\{form\.trip_date\} min=\{taipeiToday\(\)\}/, '用車日期必須使用日曆選擇器元件');
// 報表（Excel、A4 列印、畫面三處）都要標示臨時直派，不得各自重新組狀態文字。
assert.equal(workspace.match(/statusText\(r\)/g)?.length, 3, '派車報表三處輸出都必須使用 statusText 標示臨時直派');
assert.doesNotMatch(workspace, /STATUS_LABEL\[String\(r\.status\)\]/, '報表不得繞過 statusText 直接取狀態標籤');
assert.match(workspace, /1\. 申請人填單[\s\S]*5\. 司機接單與回報/, '原五步驟流程不得被改動');

console.log('公務車臨時直接派車檢查通過');
