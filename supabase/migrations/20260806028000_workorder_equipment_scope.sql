-- Separate equipment-master management from generic work-order CRUD and scope
-- technician writes to the orders actually assigned to that technician.

create or replace function public.active_rbac_role()
returns text language sql security definer stable
set search_path=public,pg_temp as $$
  select coalesce(rbac_role,case role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter' else role end)
  from public.users where auth_id=auth.uid() and status='active' limit 1
$$;

create or replace function public.has_app_permission(p_permission text)
returns boolean language sql security definer stable
set search_path=public,pg_temp as $$
  select public.active_rbac_role()='sysadmin' or coalesce((
    select case when coalesce(u.permissions,'{}'::jsonb) ? p_permission
      then lower(coalesce(u.permissions->>p_permission,'false'))='true'
      else coalesce((select rp.allowed from public.role_permissions rp where rp.role_id=public.active_rbac_role() and rp.perm=p_permission),false) end
    from public.users u where u.auth_id=auth.uid() and u.status='active' limit 1
  ),false)
$$;
revoke all on function public.active_rbac_role() from public,anon;
revoke all on function public.has_app_permission(text) from public,anon;
grant execute on function public.active_rbac_role() to authenticated;
grant execute on function public.has_app_permission(text) to authenticated;

insert into public.role_permissions(role_id,perm,allowed) values
  ('sysadmin','sys_equipment_manage',true),
  ('unit_supervisor','sys_equipment_manage',true),
  ('dispatcher','sys_equipment_manage',true),
  ('technician','sys_equipment_manage',true),
  ('mgmt_supervisor','sys_equipment_manage',false),
  ('duty','sys_equipment_manage',false),
  ('reporter','sys_equipment_manage',false)
on conflict(role_id,perm) do nothing;

do $$ declare t text; begin
  foreach t in array array[
    'equipment','floor_models','floor_spaces','plan_markers','material_categories','materials',
    'equipment_maintenance_plans','equipment_maintenance_records','equipment_contracts',
    'equipment_documents','equipment_annual_costs','equipment_external_links',
    'equipment_monitor_points','equipment_monitor_events'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %I on public.%I',t||'_managed_insert',t);
      execute format('drop policy if exists %I on public.%I',t||'_managed_update',t);
      execute format('create policy %I on public.%I for insert to authenticated with check(public.has_system_access(''sys_equipment_manage''))',t||'_managed_insert',t);
      execute format('create policy %I on public.%I for update to authenticated using(public.has_system_access(''sys_equipment_manage'')) with check(public.has_system_access(''sys_equipment_manage''))',t||'_managed_update',t);
    end if;
  end loop;
end $$;

drop policy if exists repair_requests_managed_update on public.repair_requests;
create policy repair_requests_managed_update on public.repair_requests for update to authenticated
using(public.has_system_access('sys_workorder') and (
  public.is_admin() or public.has_app_permission('dispatch') or created_by=public.active_user_id()
  or exists(select 1 from public.maintenance_orders m where m.request_id=repair_requests.request_id and m.assignee_id=public.active_user_id())
)) with check(public.has_system_access('sys_workorder'));

drop policy if exists maintenance_orders_managed_insert on public.maintenance_orders;
drop policy if exists maintenance_orders_managed_update on public.maintenance_orders;
create policy maintenance_orders_managed_insert on public.maintenance_orders for insert to authenticated
with check(public.has_system_access('sys_workorder') and (public.is_admin() or public.has_app_permission('dispatch')));
create policy maintenance_orders_managed_update on public.maintenance_orders for update to authenticated
using(public.has_system_access('sys_workorder') and (
  public.is_admin() or public.has_app_permission('dispatch')
  or (public.active_rbac_role()='technician' and assignee_id=public.active_user_id())
)) with check(public.has_system_access('sys_workorder') and (
  public.is_admin() or public.has_app_permission('dispatch')
  or (public.active_rbac_role()='technician' and assignee_id=public.active_user_id())
));

drop policy if exists cost_records_managed_insert on public.cost_records;
drop policy if exists cost_records_managed_update on public.cost_records;
create policy cost_records_managed_insert on public.cost_records for insert to authenticated
with check(public.has_system_access('sys_workorder') and (
  public.is_admin() or public.has_app_permission('dispatch')
  or exists(select 1 from public.maintenance_orders m where m.order_id=cost_records.order_id and m.assignee_id=public.active_user_id())
));
create policy cost_records_managed_update on public.cost_records for update to authenticated
using(public.has_system_access('sys_workorder') and (public.is_admin() or public.has_app_permission('dispatch')))
with check(public.has_system_access('sys_workorder') and (public.is_admin() or public.has_app_permission('dispatch')));

drop policy if exists repair_attachments_own_insert on public.repair_attachments;
create policy repair_attachments_own_insert on public.repair_attachments for insert to authenticated
with check(public.has_system_access('sys_workorder') and uploaded_by=public.active_user_id() and (
  public.is_admin() or public.has_app_permission('dispatch')
  or exists(select 1 from public.repair_requests r where r.request_id=repair_attachments.request_id and r.created_by=public.active_user_id())
  or exists(select 1 from public.maintenance_orders m where m.order_id=repair_attachments.order_id and m.assignee_id=public.active_user_id())
));

drop policy if exists case_status_log_own_insert on public.case_status_log;
create policy case_status_log_own_insert on public.case_status_log for insert to authenticated
with check(public.has_system_access('sys_workorder') and operator_id=public.active_user_id() and (
  public.is_admin() or public.has_app_permission('dispatch')
  or exists(select 1 from public.repair_requests r where r.request_id=case_status_log.request_id and r.created_by=public.active_user_id())
  or exists(select 1 from public.maintenance_orders m where m.order_id=case_status_log.order_id and m.assignee_id=public.active_user_id())
));

create or replace function public.protect_repair_request_columns()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if public.is_admin() or public.has_app_permission('dispatch') then return new; end if;
  if (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then
    raise exception 'repair request master fields are immutable for this role' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_repair_request_columns on public.repair_requests;
create trigger trg_protect_repair_request_columns before update on public.repair_requests
for each row execute function public.protect_repair_request_columns();

create or replace function public.protect_technician_order_columns()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if public.is_admin() or public.has_app_permission('dispatch') then return new; end if;
  if public.active_rbac_role()<>'technician' then
    raise exception 'order update is not allowed for this role' using errcode='42501';
  end if;
  if (to_jsonb(new)-array['status','finish_time','result_desc','handle_method','note','accept_status','arrival_time','fault_cause','parts_used','labor_hours','materials'])
     is distinct from
     (to_jsonb(old)-array['status','finish_time','result_desc','handle_method','note','accept_status','arrival_time','fault_cause','parts_used','labor_hours','materials']) then
    raise exception 'order assignment fields are immutable for technicians' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_technician_order_columns on public.maintenance_orders;
create trigger trg_protect_technician_order_columns before update on public.maintenance_orders
for each row execute function public.protect_technician_order_columns();

revoke all on function public.protect_repair_request_columns() from public,anon,authenticated;
revoke all on function public.protect_technician_order_columns() from public,anon,authenticated;
