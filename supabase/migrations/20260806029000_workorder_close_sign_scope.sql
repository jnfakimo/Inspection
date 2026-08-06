-- Supervisors with close/sign (but not dispatch) may perform lifecycle updates,
-- while creation/assignment remains limited to dispatch-capable roles.
create or replace function public.can_manage_workorder()
returns boolean language sql security definer stable
set search_path=public,pg_temp as $$
  select public.is_admin() or public.has_app_permission('dispatch')
    or public.has_app_permission('close') or public.has_app_permission('sign')
$$;
revoke all on function public.can_manage_workorder() from public,anon;
grant execute on function public.can_manage_workorder() to authenticated;

drop policy if exists repair_requests_managed_update on public.repair_requests;
create policy repair_requests_managed_update on public.repair_requests for update to authenticated
using(public.has_system_access('sys_workorder') and (
  public.can_manage_workorder() or created_by=public.active_user_id()
  or exists(select 1 from public.maintenance_orders m where m.request_id=repair_requests.request_id and m.assignee_id=public.active_user_id())
)) with check(public.has_system_access('sys_workorder'));

drop policy if exists maintenance_orders_managed_update on public.maintenance_orders;
create policy maintenance_orders_managed_update on public.maintenance_orders for update to authenticated
using(public.has_system_access('sys_workorder') and (
  public.can_manage_workorder() or (public.active_rbac_role()='technician' and assignee_id=public.active_user_id())
)) with check(public.has_system_access('sys_workorder') and (
  public.can_manage_workorder() or (public.active_rbac_role()='technician' and assignee_id=public.active_user_id())
));

drop policy if exists repair_attachments_own_insert on public.repair_attachments;
create policy repair_attachments_own_insert on public.repair_attachments for insert to authenticated
with check(public.has_system_access('sys_workorder') and uploaded_by=public.active_user_id() and (
  public.can_manage_workorder()
  or exists(select 1 from public.repair_requests r where r.request_id=repair_attachments.request_id and r.created_by=public.active_user_id())
  or exists(select 1 from public.maintenance_orders m where m.order_id=repair_attachments.order_id and m.assignee_id=public.active_user_id())
));

drop policy if exists case_status_log_own_insert on public.case_status_log;
create policy case_status_log_own_insert on public.case_status_log for insert to authenticated
with check(public.has_system_access('sys_workorder') and operator_id=public.active_user_id() and (
  public.can_manage_workorder()
  or exists(select 1 from public.repair_requests r where r.request_id=case_status_log.request_id and r.created_by=public.active_user_id())
  or exists(select 1 from public.maintenance_orders m where m.order_id=case_status_log.order_id and m.assignee_id=public.active_user_id())
));

create or replace function public.protect_repair_request_columns()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if public.can_manage_workorder() then return new; end if;
  if (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then
    raise exception 'repair request master fields are immutable for this role' using errcode='42501';
  end if;
  return new;
end $$;

create or replace function public.protect_technician_order_columns()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if public.can_manage_workorder() then return new; end if;
  if public.active_rbac_role()<>'technician' then raise exception 'order update is not allowed for this role' using errcode='42501'; end if;
  if (to_jsonb(new)-array['status','finish_time','result_desc','handle_method','note','accept_status','arrival_time','fault_cause','parts_used','labor_hours','materials'])
     is distinct from
     (to_jsonb(old)-array['status','finish_time','result_desc','handle_method','note','accept_status','arrival_time','fault_cause','parts_used','labor_hours','materials']) then
    raise exception 'order assignment fields are immutable for technicians' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_repair_request_columns() from public,anon,authenticated;
revoke all on function public.protect_technician_order_columns() from public,anon,authenticated;
