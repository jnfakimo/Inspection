-- 對齊正式庫的 is_admin() 與 repo 定義。
--
-- 2026-08-17 實測發現正式庫的版本漏認 rbac_role='sysadmin'：
--   role='supervisor' + rbac_role='sysadmin' → false（應為 true）
--   role='admin'                            → true
--   rbac_role='admin'                       → true
-- 亦即線上等同 `role='admin' or rbac_role='admin'`，而
-- system/sql/rls_hardening.sql:36-46 與 work_order_schema.sql:181-191 寫的是
-- `role='admin' or rbac_role in ('admin','sysadmin')`。
-- 同一身分下 active_rbac_role() 正確回 'sysadmin'，可排除「查不到使用者列」。
--
-- 影響範圍：所有以 is_admin() 把關的 RLS 政策與 security definer 函式。
-- 目前三位管理員（022443、021976、admin）的 role 欄都是 'admin'，因此套用前後
-- 這三人的權限完全不變；此修正是為了讓日後只從 rbac.html 升為 sysadmin 的帳號
-- 能真正取得管理權限，而不是拿到系統存取權卻無法執行任何管理動作。
--
-- 套用後請實測一次：找一個 rbac_role='sysadmin' 且 role 不是 'admin' 的帳號，
-- 確認 select public.is_admin() 回 true。

begin;

create or replace function public.is_admin() returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users
    where auth_id = auth.uid()
      and (role = 'admin' or rbac_role in ('admin','sysadmin'))
      and status = 'active'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

commit;
