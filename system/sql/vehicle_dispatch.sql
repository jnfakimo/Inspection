-- ============================================================
-- 公務車派車申請與行車紀錄
-- 流程：申請人送出 → 單位主管核可 → 車管派車 → 司機回報
-- 本檔可重複執行；正式資料只允許新增、修改或取消，不實體刪除。
-- ============================================================

begin;

create sequence if not exists vehicle_dispatch_seq;

create or replace function gen_vehicle_dispatch_no()
returns text
language sql
as $$
  select 'CAR-' || to_char(now() at time zone 'Asia/Taipei','YYYYMMDD') || '-' ||
         lpad(nextval('vehicle_dispatch_seq')::text,4,'0')
$$;

create table if not exists official_vehicles (
  vehicle_id uuid primary key default gen_random_uuid(),
  plate_no text not null unique,
  vehicle_name text,
  brand text,
  model text,
  seats integer not null default 5,
  current_odometer numeric(12,1) not null default 0,
  status text not null default 'active',
  note text,
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table official_vehicles add column if not exists plate_no text;
alter table official_vehicles add column if not exists vehicle_name text;
alter table official_vehicles add column if not exists brand text;
alter table official_vehicles add column if not exists model text;
alter table official_vehicles add column if not exists seats integer default 5;
alter table official_vehicles add column if not exists current_odometer numeric(12,1) default 0;
alter table official_vehicles add column if not exists status text default 'active';
alter table official_vehicles add column if not exists note text;
alter table official_vehicles add column if not exists created_by uuid references users(user_id);
alter table official_vehicles add column if not exists created_at timestamptz default now();
alter table official_vehicles add column if not exists updated_at timestamptz default now();
alter table official_vehicles drop constraint if exists official_vehicles_status_check;
alter table official_vehicles add constraint official_vehicles_status_check
  check (status in ('active','maintenance','inactive'));
alter table official_vehicles drop constraint if exists official_vehicles_seats_check;
alter table official_vehicles add constraint official_vehicles_seats_check check (seats > 0);
alter table official_vehicles drop constraint if exists official_vehicles_odometer_check;
alter table official_vehicles add constraint official_vehicles_odometer_check check (current_odometer >= 0);
create unique index if not exists idx_official_vehicles_plate on official_vehicles(plate_no);

create table if not exists vehicle_dispatch_managers (
  user_id uuid primary key references users(user_id),
  active boolean not null default true,
  assigned_by uuid references users(user_id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into vehicle_dispatch_managers(user_id,active)
select user_id,true from users where status='active' and rbac_role='dispatcher'
on conflict (user_id) do nothing;

create table if not exists vehicle_dispatch_drivers (
  user_id uuid primary key references users(user_id),
  active boolean not null default true,
  assigned_by uuid references users(user_id),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_dispatch_requests (
  request_id uuid primary key default gen_random_uuid(),
  request_no text not null default gen_vehicle_dispatch_no(),
  applicant_id uuid not null references users(user_id),
  applicant_name text not null,
  applicant_department text,
  applicant_phone text,
  application_date date not null default current_date,
  trip_date date not null,
  planned_departure_time time not null,
  planned_return_time time not null,
  origin_location text not null,
  destination_location text not null,
  trip_purpose text not null,
  passenger_count integer not null,
  applicant_note text,
  status text not null default 'draft',
  supervisor_id uuid references users(user_id),
  supervisor_name text,
  supervisor_note text,
  approved_at timestamptz,
  vehicle_manager_id uuid references users(user_id),
  vehicle_manager_name text,
  vehicle_id uuid references official_vehicles(vehicle_id),
  plate_no text,
  driver_id uuid references users(user_id),
  driver_name text,
  dispatch_note text,
  dispatched_at timestamptz,
  driver_accepted_at timestamptz,
  driver_accepted_by uuid references users(user_id),
  actual_passenger_count integer,
  actual_departure_at timestamptz,
  actual_return_at timestamptz,
  odometer_start numeric(12,1),
  odometer_end numeric(12,1),
  total_mileage numeric(12,1) generated always as
    (case when odometer_start is not null and odometer_end is not null
      then odometer_end - odometer_start else null end) stored,
  refueled boolean not null default false,
  last_refuel_odometer numeric(12,1),
  last_refuel_cost numeric(12,2),
  refuel_odometer numeric(12,1),
  refuel_cost numeric(12,2),
  has_abnormality boolean not null default false,
  abnormality_note text,
  driver_note text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vehicle_dispatch_requests add column if not exists request_no text default gen_vehicle_dispatch_no();
alter table vehicle_dispatch_requests add column if not exists applicant_id uuid references users(user_id);
alter table vehicle_dispatch_requests add column if not exists applicant_name text;
alter table vehicle_dispatch_requests add column if not exists applicant_department text;
alter table vehicle_dispatch_requests add column if not exists applicant_phone text;
alter table vehicle_dispatch_requests add column if not exists application_date date default current_date;
alter table vehicle_dispatch_requests add column if not exists trip_date date;
alter table vehicle_dispatch_requests add column if not exists planned_departure_time time;
alter table vehicle_dispatch_requests add column if not exists planned_return_time time;
alter table vehicle_dispatch_requests add column if not exists origin_location text;
alter table vehicle_dispatch_requests add column if not exists destination_location text;
alter table vehicle_dispatch_requests add column if not exists trip_purpose text;
alter table vehicle_dispatch_requests add column if not exists passenger_count integer;
alter table vehicle_dispatch_requests add column if not exists applicant_note text;
alter table vehicle_dispatch_requests add column if not exists status text default 'draft';
alter table vehicle_dispatch_requests add column if not exists supervisor_id uuid references users(user_id);
alter table vehicle_dispatch_requests add column if not exists supervisor_name text;
alter table vehicle_dispatch_requests add column if not exists supervisor_note text;
alter table vehicle_dispatch_requests add column if not exists approved_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists vehicle_manager_id uuid references users(user_id);
alter table vehicle_dispatch_requests add column if not exists vehicle_manager_name text;
alter table vehicle_dispatch_requests add column if not exists vehicle_id uuid references official_vehicles(vehicle_id);
alter table vehicle_dispatch_requests add column if not exists plate_no text;
alter table vehicle_dispatch_requests add column if not exists driver_id uuid references users(user_id);
alter table vehicle_dispatch_requests add column if not exists driver_name text;
alter table vehicle_dispatch_requests add column if not exists dispatch_note text;
alter table vehicle_dispatch_requests add column if not exists dispatched_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists driver_accepted_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists driver_accepted_by uuid references users(user_id);
alter table vehicle_dispatch_requests add column if not exists actual_passenger_count integer;
alter table vehicle_dispatch_requests add column if not exists actual_departure_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists actual_return_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists odometer_start numeric(12,1);
alter table vehicle_dispatch_requests add column if not exists odometer_end numeric(12,1);
alter table vehicle_dispatch_requests add column if not exists total_mileage numeric(12,1) generated always as
  (case when odometer_start is not null and odometer_end is not null then odometer_end - odometer_start else null end) stored;
alter table vehicle_dispatch_requests add column if not exists refueled boolean default false;
alter table vehicle_dispatch_requests add column if not exists last_refuel_odometer numeric(12,1);
alter table vehicle_dispatch_requests add column if not exists last_refuel_cost numeric(12,2);
alter table vehicle_dispatch_requests add column if not exists refuel_odometer numeric(12,1);
alter table vehicle_dispatch_requests add column if not exists refuel_cost numeric(12,2);
alter table vehicle_dispatch_requests add column if not exists has_abnormality boolean default false;
alter table vehicle_dispatch_requests add column if not exists abnormality_note text;
alter table vehicle_dispatch_requests add column if not exists driver_note text;
alter table vehicle_dispatch_requests add column if not exists completed_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists cancelled_at timestamptz;
alter table vehicle_dispatch_requests add column if not exists cancel_reason text;
alter table vehicle_dispatch_requests add column if not exists created_at timestamptz default now();
alter table vehicle_dispatch_requests add column if not exists updated_at timestamptz default now();

-- 舊版「有加油」資料沒有費用欄，保留為歷史未記錄值；新版前端會強制填寫。
update vehicle_dispatch_requests set refuel_cost=0 where refueled and refuel_cost is null;

update vehicle_dispatch_requests set request_no=gen_vehicle_dispatch_no() where request_no is null;
create unique index if not exists idx_vehicle_dispatch_no on vehicle_dispatch_requests(request_no);
create index if not exists idx_vehicle_dispatch_status on vehicle_dispatch_requests(status,trip_date);
create index if not exists idx_vehicle_dispatch_applicant on vehicle_dispatch_requests(applicant_id,created_at desc);
create index if not exists idx_vehicle_dispatch_driver on vehicle_dispatch_requests(driver_id,trip_date);
alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_status_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_status_check
  check (status in ('draft','pending_approval','returned','approved','assigned','completed','cancelled'));
alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_passenger_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_passenger_check
  check (passenger_count > 0 and (actual_passenger_count is null or actual_passenger_count >= 0));
alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_time_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_time_check
  check (planned_return_time > planned_departure_time and
    (actual_departure_at is null or actual_return_at is null or actual_return_at >= actual_departure_at));
alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_no_time_overlap;
-- 鍵值必須含 vehicle_id，否則任何兩張時段重疊的申請都互斥，
-- 加第二台車後兩台車就不能在重疊時段各自出勤（2026-08-17 驗收撞到 23P01 才發現）。
-- vehicle_id 為 null（尚未指派車輛）的申請彼此不互斥，衝突改由指派時的 guard 判斷。
create extension if not exists btree_gist;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_no_time_overlap
  exclude using gist (
    vehicle_id with =,
    tsrange(trip_date + planned_departure_time,trip_date + planned_return_time,'[)') with &&
  ) where (status in ('pending_approval','approved','assigned','completed'));
alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_mileage_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_mileage_check
  check ((odometer_start is null or odometer_start >= 0) and
    (odometer_end is null or odometer_end >= odometer_start) and
    (last_refuel_odometer is null or last_refuel_odometer >= 0) and
    (last_refuel_cost is null or last_refuel_cost >= 0) and
    (not refueled or (refuel_odometer is not null and refuel_cost is not null)) and
    (refuel_odometer is null or odometer_start is null or refuel_odometer >= odometer_start) and
    (refuel_odometer is null or odometer_end is null or refuel_odometer <= odometer_end) and
    (refuel_cost is null or refuel_cost >= 0));
alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_abnormality_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_abnormality_check
  check (not has_abnormality or nullif(trim(abnormality_note),'') is not null);

insert into vehicle_dispatch_drivers(user_id,active)
select distinct driver_id,true from vehicle_dispatch_requests where driver_id is not null
on conflict (user_id) do nothing;

create table if not exists vehicle_dispatch_logs (
  log_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references vehicle_dispatch_requests(request_id),
  from_status text,
  to_status text not null,
  action text not null,
  note text,
  operator_id uuid references users(user_id),
  operator_name text,
  created_at timestamptz not null default now()
);
alter table vehicle_dispatch_logs add column if not exists request_id uuid references vehicle_dispatch_requests(request_id);
alter table vehicle_dispatch_logs add column if not exists from_status text;
alter table vehicle_dispatch_logs add column if not exists to_status text;
alter table vehicle_dispatch_logs add column if not exists action text;
alter table vehicle_dispatch_logs add column if not exists note text;
alter table vehicle_dispatch_logs add column if not exists operator_id uuid references users(user_id);
alter table vehicle_dispatch_logs add column if not exists operator_name text;
alter table vehicle_dispatch_logs add column if not exists created_at timestamptz default now();
create index if not exists idx_vehicle_dispatch_logs_request on vehicle_dispatch_logs(request_id,created_at);

create table if not exists vehicle_dispatch_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references vehicle_dispatch_requests(request_id),
  stage text not null default 'application',
  file_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references users(user_id),
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
alter table vehicle_dispatch_attachments add column if not exists request_id uuid references vehicle_dispatch_requests(request_id);
alter table vehicle_dispatch_attachments add column if not exists stage text default 'application';
alter table vehicle_dispatch_attachments add column if not exists file_path text;
alter table vehicle_dispatch_attachments add column if not exists file_name text;
alter table vehicle_dispatch_attachments add column if not exists mime_type text;
alter table vehicle_dispatch_attachments add column if not exists file_size bigint;
alter table vehicle_dispatch_attachments add column if not exists uploaded_by uuid references users(user_id);
alter table vehicle_dispatch_attachments add column if not exists uploaded_by_name text;
alter table vehicle_dispatch_attachments add column if not exists created_at timestamptz default now();
alter table vehicle_dispatch_attachments drop constraint if exists vehicle_dispatch_attachment_stage_check;
alter table vehicle_dispatch_attachments add constraint vehicle_dispatch_attachment_stage_check
  check (stage in ('application','driver','abnormality'));
create index if not exists idx_vehicle_dispatch_attachments_request on vehicle_dispatch_attachments(request_id,created_at);

create or replace function touch_vehicle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists trg_official_vehicles_updated_at on official_vehicles;
create trigger trg_official_vehicles_updated_at
  before update on official_vehicles
  for each row execute function touch_vehicle_updated_at();

drop trigger if exists trg_vehicle_dispatch_updated_at on vehicle_dispatch_requests;
create trigger trg_vehicle_dispatch_updated_at
  before update on vehicle_dispatch_requests
  for each row execute function touch_vehicle_updated_at();

drop trigger if exists trg_vehicle_dispatch_managers_updated_at on vehicle_dispatch_managers;
create trigger trg_vehicle_dispatch_managers_updated_at
  before update on vehicle_dispatch_managers
  for each row execute function touch_vehicle_updated_at();

drop trigger if exists trg_vehicle_dispatch_drivers_updated_at on vehicle_dispatch_drivers;
create trigger trg_vehicle_dispatch_drivers_updated_at
  before update on vehicle_dispatch_drivers
  for each row execute function touch_vehicle_updated_at();

create or replace function guard_vehicle_dispatch_approval()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid;
  actor_role text;
  actor_department text;
begin
  if old.status='pending_approval' and new.status in ('approved','returned') then
    if auth.uid() is null then return new; end if;
    select u.user_id,
      case coalesce(u.rbac_role,u.role,'reporter')
        when 'admin' then 'sysadmin'
        when 'supervisor' then 'unit_supervisor'
        when 'maintenance' then 'technician'
        when 'inspector' then 'reporter'
        else coalesce(u.rbac_role,u.role,'reporter')
      end,
      u.department
    into actor_id,actor_role,actor_department
    from users u where u.auth_id=auth.uid() and u.status='active' limit 1;
    if actor_id is null then raise exception using errcode='42501',message='找不到有效的核可人員帳號'; end if;
    if actor_role not in ('unit_supervisor','mgmt_supervisor','sysadmin') then raise exception using errcode='42501',message='目前帳號沒有單位主管核可權限'; end if;
    if actor_role<>'sysadmin' and actor_id=old.applicant_id then raise exception using errcode='42501',message='申請人不得核准或退回自己的派車申請'; end if;
    if actor_role<>'sysadmin' and trim(coalesce(actor_department,''))<>trim(coalesce(old.applicant_department,'')) then raise exception using errcode='42501',message='僅限申請人所屬單位主管核可'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_approval on vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_approval
  before update on vehicle_dispatch_requests
  for each row execute function guard_vehicle_dispatch_approval();

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

-- 已出車但未補齊里程的行程，不得完成回報，也不得讓同一車輛再次派車。
create or replace function guard_vehicle_dispatch_mileage()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  taipei_today date := (now() at time zone 'Asia/Taipei')::date;
  taipei_time time := (now() at time zone 'Asia/Taipei')::time;
begin
  if new.status='cancelled' and nullif(btrim(coalesce(new.cancel_reason,'')),'') is null then
    raise exception using errcode='23514',message='取消派車申請前，必須填寫取消原因';
  end if;
  if new.status='completed' and (new.odometer_start is null or new.odometer_end is null) then
    raise exception using errcode='23514',message='完成行車回報前，必須填寫起始與回程里程';
  end if;
  if tg_op='UPDATE' then
    if old.status='approved' and new.status='assigned' and new.vehicle_id is not null
      and exists(
        select 1 from vehicle_dispatch_requests prior
        where prior.request_id<>old.request_id and prior.vehicle_id=new.vehicle_id
          and prior.status in ('assigned','completed')
          and (prior.odometer_start is null or prior.odometer_end is null)
          and (prior.actual_departure_at is not null or
            (prior.driver_accepted_at is not null and
              (prior.trip_date<taipei_today or (prior.trip_date=taipei_today and prior.planned_return_time<=taipei_time))))
      ) then
      raise exception using errcode='23514',message='該車輛上一趟行程已出車但尚未填寫完整里程，暫停派車，請先完成司機回報';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_vehicle_dispatch_mileage on vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_mileage
  before insert or update of status,vehicle_id,odometer_start,odometer_end,actual_departure_at,driver_accepted_at,cancel_reason
  on vehicle_dispatch_requests for each row execute function guard_vehicle_dispatch_mileage();

-- 預計時段不得在過去；行車完成回報的實際時間不得晚於現在。
create or replace function guard_vehicle_dispatch_time_window()
returns trigger language plpgsql set search_path=public as $$
declare schedule_changed boolean:=tg_op='INSERT';
begin
  if tg_op='UPDATE' then
    schedule_changed:=new.trip_date is distinct from old.trip_date
      or new.planned_departure_time is distinct from old.planned_departure_time
      or new.planned_return_time is distinct from old.planned_return_time;
  end if;
  if (new.status in ('draft','pending_approval','approved','assigned') or (new.status='returned' and schedule_changed))
    and ((new.trip_date+new.planned_departure_time) at time zone 'Asia/Taipei')<=now() then
    raise exception using errcode='22023',message='預計出發時間已經過去，請選擇目前時間之後的時段';
  end if;
  if new.status='completed' and ((new.actual_departure_at is not null and new.actual_departure_at>now()) or (new.actual_return_at is not null and new.actual_return_at>now())) then
    raise exception using errcode='22023',message='實際出發與回程時間不得晚於目前時間';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_vehicle_dispatch_time_window on vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_time_window
  before insert or update of trip_date,planned_departure_time,planned_return_time,status,actual_departure_at,actual_return_at
  on vehicle_dispatch_requests for each row execute function guard_vehicle_dispatch_time_window();

alter table official_vehicles enable row level security;
alter table vehicle_dispatch_managers enable row level security;
alter table vehicle_dispatch_drivers enable row level security;
alter table vehicle_dispatch_requests enable row level security;
alter table vehicle_dispatch_logs enable row level security;
alter table vehicle_dispatch_attachments enable row level security;
drop policy if exists "vehicle_authenticated" on official_vehicles;
drop policy if exists "vehicle_dispatch_managers_read" on vehicle_dispatch_managers;
drop policy if exists "vehicle_dispatch_managers_admin_insert" on vehicle_dispatch_managers;
drop policy if exists "vehicle_dispatch_managers_admin_update" on vehicle_dispatch_managers;
drop policy if exists "vehicle_dispatch_drivers_read" on vehicle_dispatch_drivers;
drop policy if exists "vehicle_dispatch_drivers_admin_insert" on vehicle_dispatch_drivers;
drop policy if exists "vehicle_dispatch_drivers_admin_update" on vehicle_dispatch_drivers;
drop policy if exists "vehicle_dispatch_authenticated" on vehicle_dispatch_requests;
drop policy if exists "vehicle_dispatch_logs_authenticated" on vehicle_dispatch_logs;
drop policy if exists "vehicle_dispatch_attachments_authenticated" on vehicle_dispatch_attachments;
create policy "vehicle_authenticated" on official_vehicles
  for all to authenticated using (true) with check (true);
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
create policy "vehicle_dispatch_authenticated" on vehicle_dispatch_requests
  for all to authenticated using (true) with check (true);
create policy "vehicle_dispatch_logs_authenticated" on vehicle_dispatch_logs
  for all to authenticated using (true) with check (true);
create policy "vehicle_dispatch_attachments_authenticated" on vehicle_dispatch_attachments
  for all to authenticated using (true) with check (true);

insert into storage.buckets(id,name,public)
values ('vehicle-dispatch-files','vehicle-dispatch-files',true)
on conflict (id) do update set public=true;
drop policy if exists "vehicle_dispatch_files_read" on storage.objects;
drop policy if exists "vehicle_dispatch_files_insert" on storage.objects;
create policy "vehicle_dispatch_files_read" on storage.objects
  for select to authenticated using (bucket_id='vehicle-dispatch-files');
create policy "vehicle_dispatch_files_insert" on storage.objects
  for insert to authenticated with check (bucket_id='vehicle-dispatch-files');

insert into role_permissions(role_id,perm,allowed)
select role_id,'sys_vehicle',true from roles
on conflict (role_id,perm) do nothing;

-- 若永久資料保護函式已存在，立即將新表納入不可刪除／清空保護。
do $$
declare table_name text;
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    foreach table_name in array array['official_vehicles','vehicle_dispatch_managers','vehicle_dispatch_drivers','vehicle_dispatch_requests','vehicle_dispatch_logs','vehicle_dispatch_attachments'] loop
      execute format('drop trigger if exists trg_prevent_removal on public.%I',table_name);
      execute format('create trigger trg_prevent_removal before delete or truncate on public.%I for each statement execute function public.reject_physical_data_removal()',table_name);
    end loop;
  end if;
end $$;

commit;
