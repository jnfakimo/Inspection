-- 公務車派車管理員改為逐人指派，不與報修系統的「派工管理員」角色綁死。
begin;

create table if not exists vehicle_dispatch_managers (
  user_id uuid primary key references users(user_id),
  active boolean not null default true,
  assigned_by uuid references users(user_id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into vehicle_dispatch_managers(user_id,active)
select user_id,true from users
where status='active' and rbac_role='dispatcher'
on conflict (user_id) do nothing;

drop trigger if exists trg_vehicle_dispatch_managers_updated_at on vehicle_dispatch_managers;
create trigger trg_vehicle_dispatch_managers_updated_at
  before update on vehicle_dispatch_managers
  for each row execute function touch_vehicle_updated_at();

alter table vehicle_dispatch_managers enable row level security;
drop policy if exists "vehicle_dispatch_managers_read" on vehicle_dispatch_managers;
drop policy if exists "vehicle_dispatch_managers_admin_insert" on vehicle_dispatch_managers;
drop policy if exists "vehicle_dispatch_managers_admin_update" on vehicle_dispatch_managers;
create policy "vehicle_dispatch_managers_read" on vehicle_dispatch_managers
  for select to authenticated using (true);
create policy "vehicle_dispatch_managers_admin_insert" on vehicle_dispatch_managers
  for insert to authenticated with check (
    exists(select 1 from users u where u.auth_id=auth.uid() and u.status='active' and coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else '' end)='sysadmin')
  );
create policy "vehicle_dispatch_managers_admin_update" on vehicle_dispatch_managers
  for update to authenticated using (
    exists(select 1 from users u where u.auth_id=auth.uid() and u.status='active' and coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else '' end)='sysadmin')
  ) with check (
    exists(select 1 from users u where u.auth_id=auth.uid() and u.status='active' and coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else '' end)='sysadmin')
  );

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.vehicle_dispatch_managers;
    create trigger trg_prevent_removal before delete or truncate
      on public.vehicle_dispatch_managers for each statement
      execute function public.reject_physical_data_removal();
  end if;
end $$;

commit;
