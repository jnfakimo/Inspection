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

alter table official_vehicles enable row level security;
alter table vehicle_dispatch_requests enable row level security;
alter table vehicle_dispatch_logs enable row level security;
alter table vehicle_dispatch_attachments enable row level security;
drop policy if exists "vehicle_authenticated" on official_vehicles;
drop policy if exists "vehicle_dispatch_authenticated" on vehicle_dispatch_requests;
drop policy if exists "vehicle_dispatch_logs_authenticated" on vehicle_dispatch_logs;
drop policy if exists "vehicle_dispatch_attachments_authenticated" on vehicle_dispatch_attachments;
create policy "vehicle_authenticated" on official_vehicles
  for all to authenticated using (true) with check (true);
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
    foreach table_name in array array['official_vehicles','vehicle_dispatch_requests','vehicle_dispatch_logs','vehicle_dispatch_attachments'] loop
      execute format('drop trigger if exists trg_prevent_removal on public.%I',table_name);
      execute format('create trigger trg_prevent_removal before delete or truncate on public.%I for each statement execute function public.reject_physical_data_removal()',table_name);
    end loop;
  end if;
end $$;

commit;
