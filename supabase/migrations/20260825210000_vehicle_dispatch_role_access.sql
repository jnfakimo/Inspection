-- P0 派車流程角色存取基線。
--
-- 派車申請、直屬主管核可、派車管理員派車與指定駕駛接單都會經過
-- has_system_access('sys_vehicle')。RBAC 頁面曾將這個入口收緊到只有
-- 管理主管與系統管理員，導致流程各節點在資料庫 guard 尚未執行前就被拒絕。
-- 角色權限只開放「進入公務車派車系統」；實際核可、派車、接單仍由
-- vehicle_request_action、名單表與資料庫 trigger 做最小範圍授權。

begin;

insert into public.role_permissions(role_id, perm, allowed)
select role_id, 'sys_vehicle', true
from public.roles
where role_id in ('reporter', 'unit_supervisor', 'dispatcher', 'duty', 'technician')
on conflict (role_id, perm) do update set allowed = excluded.allowed;

notify pgrst, 'reload schema';

commit;
