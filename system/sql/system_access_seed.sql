-- ============================================================
-- 系統層級存取權限種子資料
-- 目的：6 大系統（後台管理/報修派工完工/駐衛警巡檢/電子交接簿/
-- 設備建置/專案核心樹狀關係圖）依角色決定能否開放，沿用既有
-- role_permissions 表（不新建表），只是多存 6 個 sys_* perm 值。
-- 預設全部允許（等同上線前的實際行為），之後在 RBAC 頁面「系統
-- 存取權限」分頁手動收緊。idempotent：重跑不會覆蓋既有設定。
-- ============================================================

begin;

insert into role_permissions (role_id, perm, allowed)
select r.role_id, p.perm, true
from roles r
cross join (values
  ('sys_admin'),
  ('sys_workorder'),
  ('sys_guardpatrol'),
  ('sys_handover'),
  ('sys_equipment'),
  ('sys_structuremap')
) as p(perm)
on conflict (role_id, perm) do nothing;

commit;
