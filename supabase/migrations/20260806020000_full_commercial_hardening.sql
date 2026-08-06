-- Full commercial hardening. Idempotent and data-preserving.
-- This migration changes authorization only; it never deletes business rows.

begin;

create or replace function public.active_user_id()
returns uuid language sql security definer stable
set search_path=public,pg_temp as $$
  select user_id from public.users
  where auth_id=auth.uid() and status='active'
  limit 1
$$;

create or replace function public.active_rbac_role()
returns text language sql security definer stable
set search_path=public,pg_temp as $$
  select coalesce(rbac_role,case role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else role end)
  from public.users where auth_id=auth.uid() and status='active' limit 1
$$;

create or replace function public.has_system_access(p_permission text)
returns boolean language sql security definer stable
set search_path=public,pg_temp as $$
  select public.active_rbac_role()='sysadmin' or exists(
    select 1 from public.role_permissions rp
    where rp.role_id=public.active_rbac_role()
      and rp.perm=p_permission and rp.allowed=true
  )
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

revoke all on function public.active_user_id() from public,anon;
revoke all on function public.active_rbac_role() from public,anon;
revoke all on function public.has_system_access(text) from public,anon;
revoke all on function public.has_app_permission(text) from public,anon;
grant execute on function public.active_user_id() to authenticated;
grant execute on function public.active_rbac_role() to authenticated;
grant execute on function public.has_system_access(text) to authenticated;
grant execute on function public.has_app_permission(text) to authenticated;

-- The anon key is an application identifier, never an authorization grant.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('revoke all on table public.%I from anon',t.tablename);
  end loop;
end $$;

-- Remove every legacy policy from the tables managed below.
do $$
declare p record;
begin
  for p in
    select schemaname,tablename,policyname from pg_policies
    where schemaname='public' and tablename=any(array[
      'users','system_settings','roles','role_permissions','departments','markets','locations',
      'equipment','inspection_cycles','inspection_records','repair_requests','maintenance_orders',
      'cost_records','audit_logs','client_error_logs','case_status_log','repair_attachments','notifications',
      'floor_models','floor_spaces','plan_markers','checkin_logs','patrol_shift_template','patrol_shifts',
      'handover_records','handover_cases','handover_case_logs','handover_case_attachments',
      'material_categories','materials','equipment_maintenance_plans','equipment_maintenance_records',
      'equipment_contracts','equipment_documents','equipment_annual_costs','equipment_external_links',
      'equipment_monitor_points','equipment_monitor_events','official_vehicles','vehicle_dispatch_managers',
      'vehicle_dispatch_drivers','vehicle_dispatch_requests','vehicle_dispatch_logs','vehicle_dispatch_attachments'
    ])
  loop execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename); end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'users','system_settings','roles','role_permissions','departments','markets','locations',
    'equipment','inspection_cycles','inspection_records','repair_requests','maintenance_orders',
    'cost_records','audit_logs','client_error_logs','case_status_log','repair_attachments','notifications',
    'floor_models','floor_spaces','plan_markers','checkin_logs','patrol_shift_template','patrol_shifts',
    'handover_records','handover_cases','handover_case_logs','handover_case_attachments',
    'material_categories','materials','equipment_maintenance_plans','equipment_maintenance_records',
    'equipment_contracts','equipment_documents','equipment_annual_costs','equipment_external_links',
    'equipment_monitor_points','equipment_monitor_events',
    'official_vehicles','vehicle_dispatch_managers','vehicle_dispatch_drivers','vehicle_dispatch_requests',
    'vehicle_dispatch_logs','vehicle_dispatch_attachments'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I enable row level security',t);
      execute format('alter table public.%I force row level security',t);
    end if;
  end loop;
end $$;

-- Identity and RBAC metadata.
create policy users_active_read on public.users for select to authenticated
  using (public.active_user_id() is not null);
create policy users_admin_insert on public.users for insert to authenticated
  with check (public.is_admin());
create policy users_admin_update on public.users for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy settings_active_read on public.system_settings for select to authenticated
  using (public.active_user_id() is not null and key<>'line_channel_token');
create policy settings_admin_insert on public.system_settings for insert to authenticated with check(public.is_admin());
create policy settings_admin_update on public.system_settings for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy rbac_active_read_roles on public.roles for select to authenticated using(public.active_user_id() is not null);
create policy rbac_active_read_permissions on public.role_permissions for select to authenticated using(public.active_user_id() is not null);
create policy rbac_admin_insert_roles on public.roles for insert to authenticated with check(public.is_admin());
create policy rbac_admin_update_roles on public.roles for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy rbac_admin_insert_permissions on public.role_permissions for insert to authenticated with check(public.is_admin());
create policy rbac_admin_update_permissions on public.role_permissions for update to authenticated using(public.is_admin()) with check(public.is_admin());

-- Master data: active staff may read; only administrators may change organization/location masters.
do $$ declare t text; begin
  foreach t in array array['departments','markets','locations'] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy %I on public.%I for select to authenticated using(public.active_user_id() is not null)',t||'_active_read',t);
      execute format('create policy %I on public.%I for insert to authenticated with check(public.is_admin())',t||'_admin_insert',t);
      execute format('create policy %I on public.%I for update to authenticated using(public.is_admin()) with check(public.is_admin())',t||'_admin_update',t);
    end if;
  end loop;
end $$;

-- Equipment, floor and material masters.
do $$ declare t text; begin
  foreach t in array array[
    'equipment','floor_models','floor_spaces','plan_markers','material_categories','materials',
    'equipment_maintenance_plans','equipment_maintenance_records','equipment_contracts',
    'equipment_documents','equipment_annual_costs','equipment_external_links',
    'equipment_monitor_points','equipment_monitor_events'
  ] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy %I on public.%I for select to authenticated using(public.active_user_id() is not null)',t||'_active_read',t);
      execute format('create policy %I on public.%I for insert to authenticated with check(public.has_system_access(''sys_equipment'') and public.has_app_permission(''create''))',t||'_managed_insert',t);
      execute format('create policy %I on public.%I for update to authenticated using(public.has_system_access(''sys_equipment'') and public.has_app_permission(''update'')) with check(public.has_system_access(''sys_equipment'') and public.has_app_permission(''update''))',t||'_managed_update',t);
    end if;
  end loop;
end $$;

-- Inspection records: inspectors can create only records attributed to themselves.
create policy inspection_cycles_active_read on public.inspection_cycles for select to authenticated using(public.active_user_id() is not null);
create policy inspection_cycles_admin_insert on public.inspection_cycles for insert to authenticated with check(public.is_admin());
create policy inspection_cycles_admin_update on public.inspection_cycles for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy inspection_records_patrol_read on public.inspection_records for select to authenticated using(public.has_system_access('sys_guardpatrol'));
create policy inspection_records_own_insert on public.inspection_records for insert to authenticated
  with check(public.has_system_access('sys_guardpatrol') and inspector_id=public.active_user_id());
create policy inspection_records_admin_update on public.inspection_records for update to authenticated
  using(public.is_admin()) with check(public.is_admin());

-- QR/check-in history is never anonymous and is append-only for the current user.
create policy checkin_logs_patrol_read on public.checkin_logs for select to authenticated
  using(public.has_system_access('sys_guardpatrol'));
create policy checkin_logs_own_insert on public.checkin_logs for insert to authenticated
  with check(public.has_system_access('sys_guardpatrol') and user_id=public.active_user_id());
do $$ declare t text; begin
  foreach t in array array['patrol_shift_template','patrol_shifts'] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy %I on public.%I for select to authenticated using(public.has_system_access(''sys_guardpatrol''))',t||'_patrol_read',t);
      execute format('create policy %I on public.%I for insert to authenticated with check(public.is_admin())',t||'_admin_insert',t);
      execute format('create policy %I on public.%I for update to authenticated using(public.is_admin()) with check(public.is_admin())',t||'_admin_update',t);
    end if;
  end loop;
end $$;

-- Work orders and repair data.
create policy repair_requests_system_read on public.repair_requests for select to authenticated
  using(public.has_system_access('sys_workorder'));
create policy repair_requests_own_insert on public.repair_requests for insert to authenticated
  with check(public.has_system_access('sys_workorder') and created_by=public.active_user_id());
create policy repair_requests_managed_update on public.repair_requests for update to authenticated
  using(public.has_system_access('sys_workorder') and (public.is_admin() or public.has_app_permission('update') or created_by=public.active_user_id()))
  with check(public.has_system_access('sys_workorder') and (public.is_admin() or public.has_app_permission('update') or created_by=public.active_user_id()));
do $$ declare t text; begin
  foreach t in array array['maintenance_orders','cost_records'] loop
    if to_regclass('public.'||t) is not null then
      execute format('create policy %I on public.%I for select to authenticated using(public.has_system_access(''sys_workorder''))',t||'_system_read',t);
      execute format('create policy %I on public.%I for insert to authenticated with check(public.has_system_access(''sys_workorder'') and (public.is_admin() or public.has_app_permission(''update'')))',t||'_managed_insert',t);
      execute format('create policy %I on public.%I for update to authenticated using(public.has_system_access(''sys_workorder'') and (public.is_admin() or public.has_app_permission(''update''))) with check(public.has_system_access(''sys_workorder'') and (public.is_admin() or public.has_app_permission(''update'')))',t||'_managed_update',t);
    end if;
  end loop;
end $$;
create policy case_status_log_system_read on public.case_status_log for select to authenticated using(public.has_system_access('sys_workorder'));
create policy case_status_log_own_insert on public.case_status_log for insert to authenticated with check(public.has_system_access('sys_workorder') and (operator_id is null or operator_id=public.active_user_id()));
create policy repair_attachments_system_read on public.repair_attachments for select to authenticated using(public.has_system_access('sys_workorder'));
create policy repair_attachments_own_insert on public.repair_attachments for insert to authenticated with check(public.has_system_access('sys_workorder') and uploaded_by=public.active_user_id());

create policy notifications_own_read on public.notifications for select to authenticated using(recipient_id=public.active_user_id());
create policy notifications_own_update on public.notifications for update to authenticated using(recipient_id=public.active_user_id()) with check(recipient_id=public.active_user_id());
create policy notifications_managed_insert on public.notifications for insert to authenticated with check(public.has_system_access('sys_workorder'));
create policy audit_admin_read on public.audit_logs for select to authenticated using(public.is_admin());
create policy audit_own_insert on public.audit_logs for insert to authenticated with check(operator_id=public.active_user_id());
do $$ begin
  if to_regclass('public.client_error_logs') is not null then
    create policy client_errors_admin_read on public.client_error_logs for select to authenticated using(public.is_admin());
    create policy client_errors_own_insert on public.client_error_logs for insert to authenticated with check(user_id is null or user_id=public.active_user_id());
  end if;
end $$;

-- Handover: system users can read; writes stay with creator/participants/assignee or admin.
create policy handover_records_system_read on public.handover_records for select to authenticated using(public.has_system_access('sys_handover'));
create policy handover_records_own_insert on public.handover_records for insert to authenticated with check(public.has_system_access('sys_handover') and created_by=public.active_user_id());
create policy handover_records_party_update on public.handover_records for update to authenticated
  using(public.has_system_access('sys_handover') and (public.is_admin() or created_by=public.active_user_id() or handover_by=public.active_user_id() or takeover_by=public.active_user_id()))
  with check(public.has_system_access('sys_handover') and (public.is_admin() or created_by=public.active_user_id() or handover_by=public.active_user_id() or takeover_by=public.active_user_id()));
create policy handover_cases_system_read on public.handover_cases for select to authenticated using(public.has_system_access('sys_handover'));
create policy handover_cases_own_insert on public.handover_cases for insert to authenticated with check(public.has_system_access('sys_handover') and created_by=public.active_user_id());
create policy handover_cases_party_update on public.handover_cases for update to authenticated
  using(public.has_system_access('sys_handover') and (public.is_admin() or created_by=public.active_user_id() or assigned_to=public.active_user_id()))
  with check(public.has_system_access('sys_handover') and (public.is_admin() or created_by=public.active_user_id() or assigned_to=public.active_user_id()));
create policy handover_logs_system_read on public.handover_case_logs for select to authenticated using(public.has_system_access('sys_handover'));
create policy handover_logs_own_insert on public.handover_case_logs for insert to authenticated with check(public.has_system_access('sys_handover') and created_by=public.active_user_id());
create policy handover_attachments_system_read on public.handover_case_attachments for select to authenticated using(public.has_system_access('sys_handover'));
create policy handover_attachments_own_insert on public.handover_case_attachments for insert to authenticated with check(public.has_system_access('sys_handover') and uploaded_by=public.active_user_id());

-- Vehicle dispatch: rows are visible only to applicant, assigned driver, managers and admins.
create policy vehicles_active_read on public.official_vehicles for select to authenticated using(public.has_system_access('sys_vehicle'));
create policy vehicles_manager_insert on public.official_vehicles for insert to authenticated with check(public.is_admin() or exists(select 1 from public.vehicle_dispatch_managers m where m.user_id=public.active_user_id() and m.active));
create policy vehicles_manager_update on public.official_vehicles for update to authenticated using(public.is_admin() or exists(select 1 from public.vehicle_dispatch_managers m where m.user_id=public.active_user_id() and m.active)) with check(public.is_admin() or exists(select 1 from public.vehicle_dispatch_managers m where m.user_id=public.active_user_id() and m.active));
create policy vehicle_managers_active_read on public.vehicle_dispatch_managers for select to authenticated using(public.has_system_access('sys_vehicle'));
create policy vehicle_drivers_active_read on public.vehicle_dispatch_drivers for select to authenticated using(public.has_system_access('sys_vehicle'));
create policy vehicle_managers_admin_insert on public.vehicle_dispatch_managers for insert to authenticated with check(public.is_admin());
create policy vehicle_managers_admin_update on public.vehicle_dispatch_managers for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy vehicle_drivers_admin_insert on public.vehicle_dispatch_drivers for insert to authenticated with check(public.is_admin());
create policy vehicle_drivers_admin_update on public.vehicle_dispatch_drivers for update to authenticated using(public.is_admin()) with check(public.is_admin());
create policy vehicle_requests_scoped_read on public.vehicle_dispatch_requests for select to authenticated using(
  applicant_id=public.active_user_id() or driver_id=public.active_user_id() or public.is_admin()
  or exists(select 1 from public.vehicle_dispatch_managers m where m.user_id=public.active_user_id() and m.active)
);
create policy vehicle_requests_own_insert on public.vehicle_dispatch_requests for insert to authenticated with check(applicant_id=public.active_user_id());
create policy vehicle_requests_scoped_update on public.vehicle_dispatch_requests for update to authenticated using(
  applicant_id=public.active_user_id() or driver_id=public.active_user_id() or public.is_admin()
  or exists(select 1 from public.vehicle_dispatch_managers m where m.user_id=public.active_user_id() and m.active)
) with check(
  applicant_id=public.active_user_id() or driver_id=public.active_user_id() or public.is_admin()
  or exists(select 1 from public.vehicle_dispatch_managers m where m.user_id=public.active_user_id() and m.active)
);
create policy vehicle_logs_scoped_read on public.vehicle_dispatch_logs for select to authenticated using(exists(select 1 from public.vehicle_dispatch_requests r where r.request_id=vehicle_dispatch_logs.request_id));
create policy vehicle_logs_own_insert on public.vehicle_dispatch_logs for insert to authenticated with check(operator_id=public.active_user_id());
create policy vehicle_attachments_scoped_read on public.vehicle_dispatch_attachments for select to authenticated using(exists(select 1 from public.vehicle_dispatch_requests r where r.request_id=vehicle_dispatch_attachments.request_id));
create policy vehicle_attachments_own_insert on public.vehicle_dispatch_attachments for insert to authenticated with check(uploaded_by=public.active_user_id());

-- Private business attachments. floorplans intentionally remains public.
update storage.buckets set public=false where id in ('repair-files','handover-attachments','vehicle-dispatch-files');
insert into storage.buckets(id,name,public)
values ('handover-attachments','handover-attachments',false)
on conflict(id) do update set public=false;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects'
    and (policyname ilike 'repairfiles_%' or policyname ilike 'handover%attachment%' or policyname ilike 'handoverfiles_%' or policyname ilike 'vehicle_dispatch_files_%' or policyname ilike 'vehiclefiles_%')
  loop execute format('drop policy if exists %I on storage.objects',p.policyname); end loop;
end $$;
create policy repairfiles_authenticated_select on storage.objects for select to authenticated using(bucket_id='repair-files' and public.has_system_access('sys_workorder'));
create policy repairfiles_authenticated_insert on storage.objects for insert to authenticated with check(bucket_id='repair-files' and public.has_system_access('sys_workorder') and (storage.foldername(name))[1] is not null);
create policy repairfiles_owner_update on storage.objects for update to authenticated using(bucket_id='repair-files' and owner_id=auth.uid()::text) with check(bucket_id='repair-files' and owner_id=auth.uid()::text);
create policy repairfiles_owner_delete on storage.objects for delete to authenticated using(bucket_id='repair-files' and owner_id=auth.uid()::text);
create policy handoverfiles_authenticated_select on storage.objects for select to authenticated using(bucket_id='handover-attachments' and public.has_system_access('sys_handover'));
create policy handoverfiles_authenticated_insert on storage.objects for insert to authenticated with check(bucket_id='handover-attachments' and public.has_system_access('sys_handover') and (storage.foldername(name))[1] is not null);
create policy handoverfiles_owner_update on storage.objects for update to authenticated using(bucket_id='handover-attachments' and owner_id=auth.uid()::text) with check(bucket_id='handover-attachments' and owner_id=auth.uid()::text);
create policy handoverfiles_owner_delete on storage.objects for delete to authenticated using(bucket_id='handover-attachments' and owner_id=auth.uid()::text);
create policy vehiclefiles_authenticated_select on storage.objects for select to authenticated using(bucket_id='vehicle-dispatch-files' and public.has_system_access('sys_vehicle'));
create policy vehiclefiles_authenticated_insert on storage.objects for insert to authenticated with check(bucket_id='vehicle-dispatch-files' and public.has_system_access('sys_vehicle') and (storage.foldername(name))[1] is not null);
create policy vehiclefiles_owner_update on storage.objects for update to authenticated using(bucket_id='vehicle-dispatch-files' and owner_id=auth.uid()::text) with check(bucket_id='vehicle-dispatch-files' and owner_id=auth.uid()::text);
create policy vehiclefiles_owner_delete on storage.objects for delete to authenticated using(bucket_id='vehicle-dispatch-files' and owner_id=auth.uid()::text);

commit;
