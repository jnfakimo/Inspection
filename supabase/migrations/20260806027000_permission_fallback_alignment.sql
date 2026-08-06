-- Keep database authorization aligned with the documented front-end role
-- defaults while preserving an explicit per-user true/false override.
create or replace function public.has_app_permission(p_permission text)
returns boolean language sql security definer stable
set search_path=public,pg_temp as $$
  select public.active_rbac_role()='sysadmin' or coalesce((
    select case
      when coalesce(u.permissions,'{}'::jsonb) ? p_permission
        then lower(coalesce(u.permissions->>p_permission,'false'))='true'
      when p_permission='create' then coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else u.role end) in ('reporter','duty','dispatcher','unit_supervisor','sysadmin')
      when p_permission='update' then coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else u.role end) in ('dispatcher','technician','sysadmin')
      else false end
    from public.users u where u.auth_id=auth.uid() and u.status='active' limit 1
  ),false)
$$;
revoke all on function public.has_app_permission(text) from public,anon;
grant execute on function public.has_app_permission(text) to authenticated;
