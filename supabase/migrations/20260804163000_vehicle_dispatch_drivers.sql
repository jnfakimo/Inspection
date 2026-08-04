-- 公務車司機採逐人指派；派車管理員、司機與一般系統角色彼此獨立。
begin;

create table if not exists vehicle_dispatch_drivers (
  user_id uuid primary key references users(user_id),
  active boolean not null default true,
  assigned_by uuid references users(user_id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 保留既有派車單中的司機，避免新名單上線後無法處理尚未完成的任務。
insert into vehicle_dispatch_drivers(user_id,active)
select distinct driver_id,true
from vehicle_dispatch_requests
where driver_id is not null
on conflict (user_id) do nothing;

alter table vehicle_dispatch_requests
  add column if not exists driver_accepted_at timestamptz;
alter table vehicle_dispatch_requests
  add column if not exists driver_accepted_by uuid references users(user_id);

drop trigger if exists trg_vehicle_dispatch_drivers_updated_at on vehicle_dispatch_drivers;
create trigger trg_vehicle_dispatch_drivers_updated_at
  before update on vehicle_dispatch_drivers
  for each row execute function touch_vehicle_updated_at();

alter table vehicle_dispatch_drivers enable row level security;
drop policy if exists "vehicle_dispatch_drivers_read" on vehicle_dispatch_drivers;
drop policy if exists "vehicle_dispatch_drivers_admin_insert" on vehicle_dispatch_drivers;
drop policy if exists "vehicle_dispatch_drivers_admin_update" on vehicle_dispatch_drivers;
create policy "vehicle_dispatch_drivers_read" on vehicle_dispatch_drivers
  for select to authenticated using (true);
create policy "vehicle_dispatch_drivers_admin_insert" on vehicle_dispatch_drivers
  for insert to authenticated with check (
    exists(select 1 from users u where u.auth_id=auth.uid() and u.status='active' and coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else '' end)='sysadmin')
  );
create policy "vehicle_dispatch_drivers_admin_update" on vehicle_dispatch_drivers
  for update to authenticated using (
    exists(select 1 from users u where u.auth_id=auth.uid() and u.status='active' and coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else '' end)='sysadmin')
  ) with check (
    exists(select 1 from users u where u.auth_id=auth.uid() and u.status='active' and coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else '' end)='sysadmin')
  );

create or replace function guard_vehicle_dispatch_assignment_and_driver()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid;
  actor_role text;
  taipei_today date := (now() at time zone 'Asia/Taipei')::date;
begin
  -- SQL Editor、migration 或 service role 不帶 auth.uid，由受信任後端自行管理。
  if auth.uid() is null then
    return new;
  end if;

  select u.user_id,
    coalesce(u.rbac_role,case u.role
      when 'admin' then 'sysadmin'
      when 'supervisor' then 'unit_supervisor'
      when 'maintenance' then 'technician'
      else 'reporter' end)
  into actor_id,actor_role
  from users u
  where u.auth_id=auth.uid() and u.status='active'
  limit 1;

  if actor_id is null then
    raise exception using errcode='42501',message='找不到有效的派車系統人員帳號';
  end if;

  if old.status='approved' and new.status='assigned' then
    if actor_role<>'sysadmin' and not exists(
      select 1 from vehicle_dispatch_managers m where m.user_id=actor_id and m.active
    ) then
      raise exception using errcode='42501',message='目前帳號不是派車管理員';
    end if;
    if new.vehicle_id is null or new.driver_id is null then
      raise exception using errcode='23514',message='派車時必須指派公務車與司機';
    end if;
    if not exists(
      select 1 from vehicle_dispatch_drivers d where d.user_id=new.driver_id and d.active
    ) then
      raise exception using errcode='42501',message='所選人員尚未被指派為公務車司機';
    end if;
    new.driver_accepted_at := null;
    new.driver_accepted_by := null;
  end if;

  if old.status='assigned' and old.driver_accepted_at is null and new.driver_accepted_at is not null then
    if actor_role<>'sysadmin' and (
      actor_id<>old.driver_id or not exists(
        select 1 from vehicle_dispatch_drivers d where d.user_id=actor_id and d.active
      )
    ) then
      raise exception using errcode='42501',message='只有被指派的司機可以接單';
    end if;
    if actor_role<>'sysadmin' and old.trip_date<>taipei_today then
      raise exception using errcode='22023',message='司機只能在用車當日接單';
    end if;
    new.driver_accepted_by := actor_id;
  end if;

  if old.status='assigned' and new.status='completed' then
    if actor_role<>'sysadmin' and (
      actor_id<>old.driver_id or not exists(
        select 1 from vehicle_dispatch_drivers d where d.user_id=actor_id and d.active
      )
    ) then
      raise exception using errcode='42501',message='只有被指派的司機可以完成行車回報';
    end if;
    if coalesce(old.driver_accepted_at,new.driver_accepted_at) is null then
      raise exception using errcode='23514',message='請先接單再填寫行車回報';
    end if;
    if new.actual_departure_at is null or (new.actual_departure_at at time zone 'Asia/Taipei')::date<>old.trip_date then
      raise exception using errcode='22023',message='實際出發日期必須與用車日期相同';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_assignment_and_driver on vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_assignment_and_driver
  before update on vehicle_dispatch_requests
  for each row execute function guard_vehicle_dispatch_assignment_and_driver();

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.vehicle_dispatch_drivers;
    create trigger trg_prevent_removal before delete or truncate
      on public.vehicle_dispatch_drivers for each statement
      execute function public.reject_physical_data_removal();
  end if;
end $$;

commit;
