-- P0 維修流程角色存取基線。
--
-- 實際資料庫的 role_permissions 曾被 RBAC 頁面收緊到只有主管能進入
-- sys_workorder，造成一般報修人員無法建立案件、技師無法接單或回報完工。
-- 這裡只恢復維修流程所需的最小系統入口與應用權限，不放大結案／驗收權限。

begin;

insert into public.role_permissions(role_id, perm, allowed) values
  ('reporter',    'sys_workorder', true),
  ('reporter',    'read',          true),
  ('reporter',    'create',        true),
  ('technician',  'sys_workorder', true),
  ('technician',  'read',          true),
  ('technician',  'update',        true),
  ('dispatcher',  'sys_workorder', true),
  ('dispatcher',  'read',          true),
  ('dispatcher',  'create',        true),
  ('dispatcher',  'update',        true),
  ('dispatcher',  'dispatch',      true),
  ('dispatcher',  'export',        true),
  ('duty',        'sys_workorder', true),
  ('duty',        'read',          true),
  ('duty',        'create',        true),
  ('duty',        'dispatch',      true)
on conflict (role_id, perm) do update set allowed = excluded.allowed;

notify pgrst, 'reload schema';

commit;
