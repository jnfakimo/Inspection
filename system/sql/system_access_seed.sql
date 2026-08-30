-- ============================================================
-- 系統層級存取權限種子資料
-- 目的：各子系統依角色決定能否開放，沿用既有 role_permissions 表。
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
  ('sys_structuremap'),
  ('sys_vehicle'),
  ('sys_meetingroom'),
  ('sys_officialdocs'),
  ('sys_marketanalytics')
) as p(perm)
on conflict (role_id, perm) do nothing;

commit;
