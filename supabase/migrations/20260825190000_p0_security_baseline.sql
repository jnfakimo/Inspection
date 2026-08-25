-- P0 資安基線：強制 RLS、RBAC 不可自我繞過、私有附件不可用未索引路徑讀取。
-- 只增加防護與權限邊界，不刪除或改寫任何業務資料。

begin;

-- 這些表在不同歷史版本分開建立；以條件式處理，讓既有環境與新環境都能安全套用。
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users_history', 'security_alerts', 'meeting_booking_change_requests',
    'dashboard_layouts', 'dashboard_layout_versions', 'dashboard_layout_items',
    'handover_field_pilot_records', 'handover_field_pilot_audit'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('alter table public.%I force row level security', table_name);
      execute format('revoke all on table public.%I from public, anon', table_name);
    end if;
  end loop;
end $$;

-- 使用者歷程與資安告警只能由系統管理員讀取；Edge Function 以 service_role
-- 寫入，瀏覽器不取得寫入權限。
do $$
begin
  if to_regclass('public.users_history') is not null then
    revoke all on table public.users_history from authenticated;
    grant select on table public.users_history to authenticated;
    drop policy if exists users_history_select on public.users_history;
    create policy users_history_select on public.users_history
      for select to authenticated using (public.is_admin());
  end if;

  if to_regclass('public.security_alerts') is not null then
    revoke all on table public.security_alerts from authenticated;
    grant select, update on table public.security_alerts to authenticated;
    drop policy if exists security_alerts_admin_read on public.security_alerts;
    drop policy if exists security_alerts_admin_update on public.security_alerts;
    create policy security_alerts_admin_read on public.security_alerts
      for select to authenticated using (public.is_admin());
    create policy security_alerts_admin_update on public.security_alerts
      for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- 預約變更只讓申請人與原預約人看到，並明確拒絕匿名及未登入的歷程讀取。
do $$
begin
  if to_regclass('public.meeting_booking_change_requests') is not null then
    revoke all on table public.meeting_booking_change_requests from authenticated;
    grant select on table public.meeting_booking_change_requests to authenticated;
    drop policy if exists meeting_change_authenticated_select on public.meeting_booking_change_requests;
    drop policy if exists "meeting_change_authenticated_select" on public.meeting_booking_change_requests;
    create policy meeting_change_authenticated_select
      on public.meeting_booking_change_requests for select to authenticated using (
        public.active_user_id() is not null
        and (
          requester_id=public.active_user_id()
          or exists (
            select 1 from public.meeting_bookings b
            where b.booking_id=target_booking_id and b.user_id=public.active_user_id()
          )
        )
      );
  end if;
end $$;

-- 戰情版面可供啟用帳號讀取，只有管理員能改版；版本與圖塊沿用同一邊界。
do $$
begin
  if to_regclass('public.dashboard_layouts') is not null then
    revoke all on table public.dashboard_layouts from authenticated;
    grant select, insert, update on table public.dashboard_layouts to authenticated;
    drop policy if exists "dashboard_layouts_read" on public.dashboard_layouts;
    drop policy if exists "dashboard_layouts_insert" on public.dashboard_layouts;
    drop policy if exists "dashboard_layouts_update" on public.dashboard_layouts;
    create policy dashboard_layouts_read on public.dashboard_layouts
      for select to authenticated using (public.active_user_id() is not null);
    create policy dashboard_layouts_insert on public.dashboard_layouts
      for insert to authenticated with check (public.can_manage_dashboard_layout());
    create policy dashboard_layouts_update on public.dashboard_layouts
      for update to authenticated using (public.can_manage_dashboard_layout())
      with check (public.can_manage_dashboard_layout());
  end if;
  if to_regclass('public.dashboard_layout_versions') is not null then
    revoke all on table public.dashboard_layout_versions from authenticated;
    grant select, insert, update on table public.dashboard_layout_versions to authenticated;
    drop policy if exists "dashboard_versions_read" on public.dashboard_layout_versions;
    drop policy if exists "dashboard_versions_insert" on public.dashboard_layout_versions;
    drop policy if exists "dashboard_versions_update" on public.dashboard_layout_versions;
    create policy dashboard_versions_read on public.dashboard_layout_versions
      for select to authenticated using (public.active_user_id() is not null);
    create policy dashboard_versions_insert on public.dashboard_layout_versions
      for insert to authenticated with check (public.can_manage_dashboard_layout());
    create policy dashboard_versions_update on public.dashboard_layout_versions
      for update to authenticated using (public.can_manage_dashboard_layout())
      with check (public.can_manage_dashboard_layout());
  end if;
  if to_regclass('public.dashboard_layout_items') is not null then
    revoke all on table public.dashboard_layout_items from authenticated;
    grant select, insert, update on table public.dashboard_layout_items to authenticated;
    drop policy if exists "dashboard_items_read" on public.dashboard_layout_items;
    drop policy if exists "dashboard_items_insert" on public.dashboard_layout_items;
    drop policy if exists "dashboard_items_update" on public.dashboard_layout_items;
    create policy dashboard_items_read on public.dashboard_layout_items
      for select to authenticated using (public.active_user_id() is not null);
    create policy dashboard_items_insert on public.dashboard_layout_items
      for insert to authenticated with check (public.can_manage_dashboard_layout());
    create policy dashboard_items_update on public.dashboard_layout_items
      for update to authenticated using (public.can_manage_dashboard_layout())
      with check (public.can_manage_dashboard_layout());
  end if;
end $$;

-- 現場交接試用表不得由任一登入者偽造；讀寫都要求交接簿系統權限，稽核表只可讀。
do $$
begin
  if to_regclass('public.handover_field_pilot_records') is not null then
    revoke all on table public.handover_field_pilot_records from authenticated;
    grant select, insert, update on table public.handover_field_pilot_records to authenticated;
    drop policy if exists "handover_field_pilot_authenticated" on public.handover_field_pilot_records;
    drop policy if exists "handover_field_pilot_read" on public.handover_field_pilot_records;
    drop policy if exists "handover_field_pilot_write" on public.handover_field_pilot_records;
    drop policy if exists "handover_field_pilot_update" on public.handover_field_pilot_records;
    create policy handover_field_pilot_read on public.handover_field_pilot_records
      for select to authenticated using (public.has_system_access('sys_handover'));
    create policy handover_field_pilot_write on public.handover_field_pilot_records
      for insert to authenticated with check (public.has_system_access('sys_handover'));
    create policy handover_field_pilot_update on public.handover_field_pilot_records
      for update to authenticated using (public.has_system_access('sys_handover'))
      with check (public.has_system_access('sys_handover'));
  end if;
  if to_regclass('public.handover_field_pilot_audit') is not null then
    revoke all on table public.handover_field_pilot_audit from authenticated;
    grant select on table public.handover_field_pilot_audit to authenticated;
    drop policy if exists "handover_field_pilot_audit_authenticated" on public.handover_field_pilot_audit;
    drop policy if exists "handover_field_pilot_audit_read" on public.handover_field_pilot_audit;
    drop policy if exists "handover_field_pilot_audit_write" on public.handover_field_pilot_audit;
    create policy handover_field_pilot_audit_read on public.handover_field_pilot_audit
      for select to authenticated using (public.has_system_access('sys_handover'));
  end if;
end $$;

-- RBAC 防呆：保留系統管理員完整權限，不允許把後台權限授給其他角色，
-- 也不允許透過 REST 直接改掉保留角色代碼。
create or replace function public.guard_reserved_rbac_changes()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_table_name='roles' then
    if tg_op='DELETE' and old.role_id in ('reporter','duty','dispatcher','technician','unit_supervisor','mgmt_supervisor','sysadmin') then
      raise exception '系統保留角色不可刪除' using errcode='42501';
    end if;
    if tg_op='UPDATE'
       and old.role_id in ('reporter','duty','dispatcher','technician','unit_supervisor','mgmt_supervisor','sysadmin')
       and new.role_id is distinct from old.role_id then
      raise exception '系統保留角色代碼不可變更' using errcode='42501';
    end if;
  elsif tg_table_name='role_permissions' then
    if tg_op='DELETE' and old.role_id='sysadmin' then
      raise exception '系統管理員的完整權限不可刪除' using errcode='42501';
    end if;
    if new.role_id='sysadmin' and new.allowed is distinct from true then
      raise exception '系統管理員的完整權限不可取消' using errcode='42501';
    end if;
    if new.perm='sys_admin' and new.role_id<>'sysadmin' and new.allowed is true then
      raise exception '後台管理權限只保留給系統管理員' using errcode='42501';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
drop trigger if exists trg_guard_reserved_role_changes on public.roles;
create trigger trg_guard_reserved_role_changes
before update or delete on public.roles for each row execute function public.guard_reserved_rbac_changes();
drop trigger if exists trg_guard_reserved_permission_changes on public.role_permissions;
create trigger trg_guard_reserved_permission_changes
before insert or update or delete on public.role_permissions for each row execute function public.guard_reserved_rbac_changes();
revoke all on function public.guard_reserved_rbac_changes() from public,anon,authenticated;

-- 帳號階層的資料庫最後防線：一般帳號只能指向同單位、啟用中的課室主管；
-- 課室主管與系統管理員不得再掛上層主管。
create or replace function public.guard_user_supervisor_hierarchy()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text := coalesce(new.rbac_role, case new.role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter'
    else new.role end, 'reporter');
  v_supervisor record;
begin
  if v_role in ('unit_supervisor','sysadmin') and new.supervisor_id is not null then
    raise exception '主管及系統管理員不可設定直屬主管' using errcode='23514';
  end if;
  if new.status='active' and v_role not in ('unit_supervisor','sysadmin') and new.supervisor_id is null then
    raise exception '啟用中的一般人員必須指定直屬課室主管' using errcode='23514';
  end if;
  if new.supervisor_id is not null then
    select user_id,dept_id,rbac_role,role,status,department into v_supervisor
    from public.users where user_id=new.supervisor_id;
    if v_supervisor.user_id is null or v_supervisor.status<>'active' then
      raise exception '直屬主管必須是啟用中的帳號' using errcode='23514';
    end if;
    if coalesce(v_supervisor.rbac_role, case v_supervisor.role
      when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
      else v_supervisor.role end) not in ('unit_supervisor','sysadmin') then
      raise exception '直屬主管必須具備課室主管或系統管理員角色' using errcode='23514';
    end if;
    if coalesce(v_supervisor.rbac_role, case v_supervisor.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else v_supervisor.role end) <> 'sysadmin'
       and new.dept_id is not null and v_supervisor.dept_id is not null
       and new.dept_id is distinct from v_supervisor.dept_id then
      raise exception '直屬主管必須與人員屬於同一單位' using errcode='23514';
    end if;
    if coalesce(v_supervisor.rbac_role, case v_supervisor.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else v_supervisor.role end) <> 'sysadmin'
       and new.dept_id is null and nullif(btrim(new.department), '') is not null
       and nullif(btrim(v_supervisor.department), '') is not null
       and btrim(new.department) is distinct from btrim(v_supervisor.department) then
      raise exception '直屬主管必須與人員屬於同一單位' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_user_supervisor_hierarchy on public.users;
create trigger trg_guard_user_supervisor_hierarchy
before insert or update of role,rbac_role,dept_id,supervisor_id,status on public.users
for each row execute function public.guard_user_supervisor_hierarchy();
revoke all on function public.guard_user_supervisor_hierarchy() from public,anon,authenticated;

-- 私有附件只能讀取已建立索引的物件；即使知道 bucket 名稱，也不能用任意路徑
-- 取得孤兒檔案。函式以 security definer 查詢索引表，避免被索引表 RLS 反向擋住。
create or replace function public.storage_object_is_indexed(p_bucket text, p_name text)
returns boolean
language plpgsql
security definer stable
set search_path=public,storage,pg_temp
as $$
begin
  if p_bucket='repair-files' then
    return exists(select 1 from public.repair_attachments where file_path=p_name);
  elsif p_bucket='handover-attachments' then
    return exists(select 1 from public.handover_case_attachments where storage_path=p_name);
  elsif p_bucket='vehicle-dispatch-files' then
    return exists(select 1 from public.vehicle_dispatch_attachments where file_path=p_name);
  end if;
  return false;
end;
$$;
revoke all on function public.storage_object_is_indexed(text,text) from public,anon,authenticated;
grant execute on function public.storage_object_is_indexed(text,text) to authenticated;

drop policy if exists repairfiles_authenticated_select on storage.objects;
create policy repairfiles_authenticated_select on storage.objects for select to authenticated
  using (bucket_id='repair-files' and public.has_system_access('sys_workorder')
    and public.storage_object_is_indexed(bucket_id,name));
drop policy if exists handoverfiles_authenticated_select on storage.objects;
create policy handoverfiles_authenticated_select on storage.objects for select to authenticated
  using (bucket_id='handover-attachments' and public.has_system_access('sys_handover')
    and public.storage_object_is_indexed(bucket_id,name));
drop policy if exists vehiclefiles_authenticated_select on storage.objects;
create policy vehiclefiles_authenticated_select on storage.objects for select to authenticated
  using (bucket_id='vehicle-dispatch-files' and public.has_system_access('sys_vehicle')
    and public.storage_object_is_indexed(bucket_id,name));

-- 10MB 是三個業務附件前端與 Edge Function 共用的上限；限制 MIME 避免把任意
-- 可執行內容當成業務附件保存。既有物件不會被刪除。
update storage.buckets
set public=false,
    file_size_limit=10485760,
    allowed_mime_types=case id
      when 'handover-attachments' then array['image/jpeg','image/png','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
      when 'repair-files' then array['image/jpeg','image/png','image/webp','image/heic','video/mp4','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
      else array['image/jpeg','image/png','image/webp']::text[]
    end
where id in ('repair-files','handover-attachments','vehicle-dispatch-files');

notify pgrst,'reload schema';
commit;
