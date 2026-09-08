-- Safe deployment: no retention purge, no blanket role grants; preserve all records.
-- ============================================================
-- SYS-13 公務車定位追蹤系統
-- BLE 標籤綁定、手機定位工作階段、原始定位點、每日摘要、圍籬與告警。
-- 可重複執行；車輛沿用 official_vehicles，不建立第二份車輛主檔。
-- ============================================================

begin;

create or replace function public.can_manage_vehicle_tracking()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.active_user_id() is not null
    and coalesce(public.has_system_access('sys_vehicletracking'),false)
    and (coalesce(public.is_admin(),false) or exists(
      select 1 from public.vehicle_dispatch_managers
      where user_id=public.active_user_id() and active
    ));
$$;
revoke all on function public.can_manage_vehicle_tracking() from public,anon;
grant execute on function public.can_manage_vehicle_tracking() to authenticated;

create table if not exists vehicle_tracking_devices (
  device_id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references official_vehicles(vehicle_id),
  display_name text not null,
  advertised_name text,
  device_fingerprint text not null unique,
  service_uuid text,
  characteristic_uuid text,
  platform_identifiers jsonb not null default '{}'::jsonb,
  adapter_type text not null default 'ble_tag',
  verification_status text not null default 'untested',
  status text not null default 'active',
  battery_level integer,
  last_seen_at timestamptz,
  last_latitude double precision,
  last_longitude double precision,
  last_accuracy_m double precision,
  last_speed_kmh double precision,
  last_heading_deg double precision,
  last_recorded_at timestamptz,
  note text,
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vehicle_tracking_devices add column if not exists vehicle_id uuid references official_vehicles(vehicle_id);
alter table vehicle_tracking_devices add column if not exists display_name text;
alter table vehicle_tracking_devices add column if not exists advertised_name text;
alter table vehicle_tracking_devices add column if not exists device_fingerprint text;
alter table vehicle_tracking_devices add column if not exists service_uuid text;
alter table vehicle_tracking_devices add column if not exists characteristic_uuid text;
alter table vehicle_tracking_devices add column if not exists platform_identifiers jsonb default '{}'::jsonb;
alter table vehicle_tracking_devices add column if not exists adapter_type text default 'ble_tag';
alter table vehicle_tracking_devices add column if not exists verification_status text default 'untested';
alter table vehicle_tracking_devices add column if not exists status text default 'active';
alter table vehicle_tracking_devices add column if not exists battery_level integer;
alter table vehicle_tracking_devices add column if not exists last_seen_at timestamptz;
alter table vehicle_tracking_devices add column if not exists last_latitude double precision;
alter table vehicle_tracking_devices add column if not exists last_longitude double precision;
alter table vehicle_tracking_devices add column if not exists last_accuracy_m double precision;
alter table vehicle_tracking_devices add column if not exists last_speed_kmh double precision;
alter table vehicle_tracking_devices add column if not exists last_heading_deg double precision;
alter table vehicle_tracking_devices add column if not exists last_recorded_at timestamptz;
alter table vehicle_tracking_devices add column if not exists note text;
alter table vehicle_tracking_devices add column if not exists created_by uuid references users(user_id);
alter table vehicle_tracking_devices add column if not exists created_at timestamptz default now();
alter table vehicle_tracking_devices add column if not exists updated_at timestamptz default now();

alter table vehicle_tracking_devices drop constraint if exists vehicle_tracking_devices_status_check;
alter table vehicle_tracking_devices add constraint vehicle_tracking_devices_status_check
  check (status in ('active','inactive','retired'));
alter table vehicle_tracking_devices drop constraint if exists vehicle_tracking_devices_verification_check;
alter table vehicle_tracking_devices add constraint vehicle_tracking_devices_verification_check
  check (verification_status in ('untested','scanning','verified','incompatible'));
alter table vehicle_tracking_devices drop constraint if exists vehicle_tracking_devices_battery_check;
alter table vehicle_tracking_devices add constraint vehicle_tracking_devices_battery_check
  check (battery_level is null or battery_level between 0 and 100);
alter table vehicle_tracking_devices drop constraint if exists vehicle_tracking_devices_last_coordinate_check;
alter table vehicle_tracking_devices add constraint vehicle_tracking_devices_last_coordinate_check
  check ((last_latitude is null and last_longitude is null) or
         (last_latitude between -90 and 90 and last_longitude between -180 and 180));
create unique index if not exists idx_vehicle_tracking_device_fingerprint
  on vehicle_tracking_devices(device_fingerprint);
create unique index if not exists idx_vehicle_tracking_one_active_device_per_vehicle
  on vehicle_tracking_devices(vehicle_id) where vehicle_id is not null and status='active';
create index if not exists idx_vehicle_tracking_devices_last_seen
  on vehicle_tracking_devices(last_seen_at desc);

create table if not exists vehicle_tracking_sessions (
  session_id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references official_vehicles(vehicle_id),
  device_id uuid not null references vehicle_tracking_devices(device_id),
  driver_id uuid not null references users(user_id),
  dispatch_request_id uuid references vehicle_dispatch_requests(request_id),
  status text not null default 'active',
  platform text not null,
  app_version text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vehicle_tracking_sessions add column if not exists vehicle_id uuid references official_vehicles(vehicle_id);
alter table vehicle_tracking_sessions add column if not exists device_id uuid references vehicle_tracking_devices(device_id);
alter table vehicle_tracking_sessions add column if not exists driver_id uuid references users(user_id);
alter table vehicle_tracking_sessions add column if not exists dispatch_request_id uuid references vehicle_dispatch_requests(request_id);
alter table vehicle_tracking_sessions add column if not exists status text default 'active';
alter table vehicle_tracking_sessions add column if not exists platform text;
alter table vehicle_tracking_sessions add column if not exists app_version text;
alter table vehicle_tracking_sessions add column if not exists started_at timestamptz default now();
alter table vehicle_tracking_sessions add column if not exists ended_at timestamptz;
alter table vehicle_tracking_sessions add column if not exists ended_reason text;
alter table vehicle_tracking_sessions add column if not exists created_at timestamptz default now();
alter table vehicle_tracking_sessions add column if not exists updated_at timestamptz default now();
alter table vehicle_tracking_sessions drop constraint if exists vehicle_tracking_sessions_status_check;
alter table vehicle_tracking_sessions add constraint vehicle_tracking_sessions_status_check
  check (status in ('active','ended','interrupted'));
alter table vehicle_tracking_sessions drop constraint if exists vehicle_tracking_sessions_platform_check;
alter table vehicle_tracking_sessions add constraint vehicle_tracking_sessions_platform_check
  check (platform in ('android','ios','simulator'));
create unique index if not exists idx_vehicle_tracking_one_active_session_per_vehicle
  on vehicle_tracking_sessions(vehicle_id) where status='active';
create index if not exists idx_vehicle_tracking_sessions_driver
  on vehicle_tracking_sessions(driver_id,started_at desc);

create table if not exists vehicle_location_points (
  point_id bigint generated by default as identity primary key,
  client_event_id uuid not null unique,
  session_id uuid not null references vehicle_tracking_sessions(session_id),
  vehicle_id uuid not null references official_vehicles(vehicle_id),
  device_id uuid not null references vehicle_tracking_devices(device_id),
  recorded_by uuid not null references users(user_id),
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  speed_kmh double precision,
  heading_deg double precision,
  altitude_m double precision,
  source text not null default 'phone_gps',
  activity text,
  is_mocked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
);

alter table vehicle_location_points add column if not exists client_event_id uuid;
alter table vehicle_location_points add column if not exists session_id uuid references vehicle_tracking_sessions(session_id);
alter table vehicle_location_points add column if not exists vehicle_id uuid references official_vehicles(vehicle_id);
alter table vehicle_location_points add column if not exists device_id uuid references vehicle_tracking_devices(device_id);
alter table vehicle_location_points add column if not exists recorded_by uuid references users(user_id);
alter table vehicle_location_points add column if not exists recorded_at timestamptz;
alter table vehicle_location_points add column if not exists received_at timestamptz default now();
alter table vehicle_location_points add column if not exists latitude double precision;
alter table vehicle_location_points add column if not exists longitude double precision;
alter table vehicle_location_points add column if not exists accuracy_m double precision;
alter table vehicle_location_points add column if not exists speed_kmh double precision;
alter table vehicle_location_points add column if not exists heading_deg double precision;
alter table vehicle_location_points add column if not exists altitude_m double precision;
alter table vehicle_location_points add column if not exists source text default 'phone_gps';
alter table vehicle_location_points add column if not exists activity text;
alter table vehicle_location_points add column if not exists is_mocked boolean default false;
alter table vehicle_location_points add column if not exists metadata jsonb default '{}'::jsonb;
alter table vehicle_location_points drop constraint if exists vehicle_location_points_coordinate_check;
alter table vehicle_location_points add constraint vehicle_location_points_coordinate_check
  check (latitude between -90 and 90 and longitude between -180 and 180);
alter table vehicle_location_points drop constraint if exists vehicle_location_points_accuracy_check;
alter table vehicle_location_points add constraint vehicle_location_points_accuracy_check
  check (accuracy_m is null or accuracy_m between 0 and 10000);
alter table vehicle_location_points drop constraint if exists vehicle_location_points_speed_check;
alter table vehicle_location_points add constraint vehicle_location_points_speed_check
  check (speed_kmh is null or speed_kmh between 0 and 400);
alter table vehicle_location_points drop constraint if exists vehicle_location_points_heading_check;
alter table vehicle_location_points add constraint vehicle_location_points_heading_check
  check (heading_deg is null or heading_deg between 0 and 360);
alter table vehicle_location_points drop constraint if exists vehicle_location_points_source_check;
alter table vehicle_location_points add constraint vehicle_location_points_source_check
  check (source in ('phone_gps','network','simulator'));
create unique index if not exists idx_vehicle_location_client_event
  on vehicle_location_points(client_event_id);
create index if not exists idx_vehicle_location_vehicle_time
  on vehicle_location_points(vehicle_id,recorded_at desc);
create index if not exists idx_vehicle_location_session_time
  on vehicle_location_points(session_id,recorded_at);
create index if not exists idx_vehicle_location_recorded_brin
  on vehicle_location_points using brin(recorded_at);

create table if not exists vehicle_location_daily_summaries (
  vehicle_id uuid not null references official_vehicles(vehicle_id),
  summary_date date not null,
  point_count integer not null default 0,
  distance_km numeric(12,3) not null default 0,
  moving_minutes integer not null default 0,
  stopped_minutes integer not null default 0,
  first_recorded_at timestamptz,
  last_recorded_at timestamptz,
  data_gap_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(vehicle_id,summary_date)
);

create table if not exists vehicle_geofences (
  geofence_id uuid primary key default gen_random_uuid(),
  name text not null,
  shape_type text not null default 'circle',
  center_latitude double precision,
  center_longitude double precision,
  radius_m double precision,
  polygon_geojson jsonb,
  notify_on_enter boolean not null default true,
  notify_on_exit boolean not null default true,
  status text not null default 'active',
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table vehicle_geofences drop constraint if exists vehicle_geofences_shape_check;
alter table vehicle_geofences add constraint vehicle_geofences_shape_check
  check (shape_type in ('circle','polygon'));
alter table vehicle_geofences drop constraint if exists vehicle_geofences_status_check;
alter table vehicle_geofences add constraint vehicle_geofences_status_check
  check (status in ('active','inactive'));
alter table vehicle_geofences drop constraint if exists vehicle_geofences_geometry_check;
alter table vehicle_geofences add constraint vehicle_geofences_geometry_check check (
  (shape_type='circle' and center_latitude between -90 and 90 and
   center_longitude between -180 and 180 and radius_m between 10 and 100000) or
  (shape_type='polygon' and polygon_geojson is not null)
);
create index if not exists idx_vehicle_geofences_status on vehicle_geofences(status,name);

create table if not exists vehicle_tracking_events (
  event_id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references official_vehicles(vehicle_id),
  device_id uuid references vehicle_tracking_devices(device_id),
  session_id uuid references vehicle_tracking_sessions(session_id),
  geofence_id uuid references vehicle_geofences(geofence_id),
  event_type text not null,
  severity text not null default 'info',
  title text not null,
  message text,
  occurred_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(user_id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table vehicle_tracking_events drop constraint if exists vehicle_tracking_events_type_check;
alter table vehicle_tracking_events add constraint vehicle_tracking_events_type_check
  check (event_type in ('geofence_enter','geofence_exit','location_stale','ble_disconnected','ble_reconnected','session_started','session_ended','battery_low'));
alter table vehicle_tracking_events drop constraint if exists vehicle_tracking_events_severity_check;
alter table vehicle_tracking_events add constraint vehicle_tracking_events_severity_check
  check (severity in ('info','warning','critical'));
create index if not exists idx_vehicle_tracking_events_time
  on vehicle_tracking_events(occurred_at desc);
create index if not exists idx_vehicle_tracking_events_vehicle_time
  on vehicle_tracking_events(vehicle_id,occurred_at desc);

create or replace function touch_vehicle_tracking_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;

drop trigger if exists trg_vehicle_tracking_devices_updated_at on vehicle_tracking_devices;
create trigger trg_vehicle_tracking_devices_updated_at before update on vehicle_tracking_devices
  for each row execute function touch_vehicle_tracking_updated_at();
drop trigger if exists trg_vehicle_tracking_sessions_updated_at on vehicle_tracking_sessions;
create trigger trg_vehicle_tracking_sessions_updated_at before update on vehicle_tracking_sessions
  for each row execute function touch_vehicle_tracking_updated_at();
drop trigger if exists trg_vehicle_geofences_updated_at on vehicle_geofences;
create trigger trg_vehicle_geofences_updated_at before update on vehicle_geofences
  for each row execute function touch_vehicle_tracking_updated_at();

create or replace function update_vehicle_tracking_last_location()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  update vehicle_tracking_devices
  set last_seen_at=greatest(coalesce(last_seen_at,new.recorded_at),new.recorded_at),
      last_latitude=new.latitude,
      last_longitude=new.longitude,
      last_accuracy_m=new.accuracy_m,
      last_speed_kmh=new.speed_kmh,
      last_heading_deg=new.heading_deg,
      last_recorded_at=new.recorded_at,
      updated_at=now()
  where device_id=new.device_id
    and (last_recorded_at is null or new.recorded_at>=last_recorded_at);
  return new;
end;
$$;
revoke all on function update_vehicle_tracking_last_location() from public,anon,authenticated;

drop trigger if exists trg_vehicle_location_update_device on vehicle_location_points;
create trigger trg_vehicle_location_update_device after insert on vehicle_location_points
  for each row execute function update_vehicle_tracking_last_location();

create or replace function process_vehicle_location_point()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  previous_point vehicle_location_points%rowtype;
  elapsed_minutes integer:=0;
  distance_metres double precision:=0;
  summary_day date;
  fence vehicle_geofences%rowtype;
  was_inside boolean;
  is_inside boolean;
begin
  select * into previous_point
  from vehicle_location_points
  where vehicle_id=new.vehicle_id and recorded_at<new.recorded_at
  order by recorded_at desc limit 1;

  summary_day=(new.recorded_at at time zone 'Asia/Taipei')::date;
  -- 每日摘要以臺北時區切日；跨午夜的第一個點不把前一天最後一段
  -- 里程／時間灌入新的一天，但仍保留 previous_point 供圍籬進出判斷。
  if previous_point.point_id is not null
     and (previous_point.recorded_at at time zone 'Asia/Taipei')::date=summary_day then
    elapsed_minutes=greatest(0,least(60,floor(extract(epoch from (new.recorded_at-previous_point.recorded_at))/60)::integer));
    distance_metres=2*6371000*asin(sqrt(
      power(sin(radians(new.latitude-previous_point.latitude)/2),2)+
      cos(radians(previous_point.latitude))*cos(radians(new.latitude))*
      power(sin(radians(new.longitude-previous_point.longitude)/2),2)
    ));
  end if;

  insert into vehicle_location_daily_summaries(
    vehicle_id,summary_date,point_count,distance_km,moving_minutes,stopped_minutes,
    first_recorded_at,last_recorded_at,data_gap_count,updated_at
  ) values (
    new.vehicle_id,summary_day,1,round((distance_metres/1000)::numeric,3),
    case when coalesce(new.speed_kmh,0)>=3 then elapsed_minutes else 0 end,
    case when coalesce(new.speed_kmh,0)<3 then elapsed_minutes else 0 end,
    new.recorded_at,new.recorded_at,
    case when previous_point.point_id is not null
              and (previous_point.recorded_at at time zone 'Asia/Taipei')::date=summary_day
              and new.recorded_at-previous_point.recorded_at>interval '5 minutes' then 1 else 0 end,
    now()
  )
  on conflict(vehicle_id,summary_date) do update set
    point_count=vehicle_location_daily_summaries.point_count+1,
    distance_km=vehicle_location_daily_summaries.distance_km+excluded.distance_km,
    moving_minutes=vehicle_location_daily_summaries.moving_minutes+excluded.moving_minutes,
    stopped_minutes=vehicle_location_daily_summaries.stopped_minutes+excluded.stopped_minutes,
    first_recorded_at=least(vehicle_location_daily_summaries.first_recorded_at,excluded.first_recorded_at),
    last_recorded_at=greatest(vehicle_location_daily_summaries.last_recorded_at,excluded.last_recorded_at),
    data_gap_count=vehicle_location_daily_summaries.data_gap_count+excluded.data_gap_count,
    updated_at=now();

  -- 離線補傳較舊的點不重新觸發圍籬事件，避免歷史資料製造假告警。
  if exists(select 1 from vehicle_location_points p where p.vehicle_id=new.vehicle_id and p.recorded_at>new.recorded_at) then
    return new;
  end if;

  for fence in select * from vehicle_geofences where status='active' and shape_type='circle' loop
    is_inside=(2*6371000*asin(sqrt(
      power(sin(radians(new.latitude-fence.center_latitude)/2),2)+
      cos(radians(fence.center_latitude))*cos(radians(new.latitude))*
      power(sin(radians(new.longitude-fence.center_longitude)/2),2)
    )))<=fence.radius_m;
    if previous_point.point_id is null then
      was_inside=false;
    else
      was_inside=(2*6371000*asin(sqrt(
        power(sin(radians(previous_point.latitude-fence.center_latitude)/2),2)+
        cos(radians(fence.center_latitude))*cos(radians(previous_point.latitude))*
        power(sin(radians(previous_point.longitude-fence.center_longitude)/2),2)
      )))<=fence.radius_m;
    end if;
    if is_inside and not was_inside and fence.notify_on_enter then
      insert into vehicle_tracking_events(vehicle_id,device_id,session_id,geofence_id,event_type,severity,title,message,occurred_at,details)
      values(new.vehicle_id,new.device_id,new.session_id,fence.geofence_id,'geofence_enter','info','車輛進入電子圍籬',format('已進入「%s」',fence.name),new.recorded_at,jsonb_build_object('point_id',new.point_id));
    elsif not is_inside and was_inside and fence.notify_on_exit then
      insert into vehicle_tracking_events(vehicle_id,device_id,session_id,geofence_id,event_type,severity,title,message,occurred_at,details)
      values(new.vehicle_id,new.device_id,new.session_id,fence.geofence_id,'geofence_exit','warning','車輛離開電子圍籬',format('已離開「%s」',fence.name),new.recorded_at,jsonb_build_object('point_id',new.point_id));
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function process_vehicle_location_point() from public,anon,authenticated;

drop trigger if exists trg_vehicle_location_process_point on vehicle_location_points;
create trigger trg_vehicle_location_process_point after insert on vehicle_location_points
  for each row execute function process_vehicle_location_point();

create or replace function detect_stale_vehicle_tracking(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare inserted_count integer;
begin
  if auth.role()<>'service_role' then
    raise exception '只有系統排程可以執行定位逾時檢查';
  end if;
  insert into vehicle_tracking_events(vehicle_id,device_id,event_type,severity,title,message,occurred_at,details)
  select d.vehicle_id,d.device_id,'location_stale','warning','車輛定位逾時',
         '超過15分鐘沒有收到定位資料',p_now,
         jsonb_build_object('last_recorded_at',d.last_recorded_at)
  from vehicle_tracking_devices d
  where d.status='active' and d.vehicle_id is not null
    and (d.last_recorded_at is null or d.last_recorded_at<p_now-interval '15 minutes')
    and not exists(
      select 1 from vehicle_tracking_events e
      where e.device_id=d.device_id and e.event_type='location_stale'
        and e.occurred_at>=coalesce(d.last_recorded_at,d.created_at)
    );
  get diagnostics inserted_count=row_count;
  return inserted_count;
end;
$$;
revoke all on function detect_stale_vehicle_tracking(timestamptz) from public,anon,authenticated;
grant execute on function detect_stale_vehicle_tracking(timestamptz) to service_role;

create or replace function bind_vehicle_tracking_ble_device(
  p_device_id uuid,
  p_platform text,
  p_platform_identifier text,
  p_advertised_name text default null,
  p_service_uuid text default null
)
returns vehicle_tracking_devices
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_device vehicle_tracking_devices%rowtype;
  v_existing_identifier text;
begin
  if not public.has_system_access('sys_vehicletracking') or public.active_user_id() is null then
    raise exception '目前帳號沒有公務車定位追蹤系統權限';
  end if;
  if p_platform is null or p_platform not in ('ios','android') then
    raise exception '手機平台必須是 iOS 或 Android';
  end if;
  if nullif(trim(p_platform_identifier),'') is null or length(trim(p_platform_identifier)) > 512 then
    raise exception '藍牙設備識別碼格式不正確';
  end if;

  select * into v_device from vehicle_tracking_devices
  where device_id=p_device_id and status='active' for update;
  if not found then raise exception '找不到可綁定的啟用中藍牙設備'; end if;

  v_existing_identifier := nullif(v_device.platform_identifiers->>p_platform,'');
  if v_existing_identifier is not null
     and v_existing_identifier <> trim(p_platform_identifier)
     and not (public.can_manage_vehicle_tracking()) then
    raise exception '此藍牙設備已綁定其他手機識別碼，請由管理員確認';
  end if;
  if exists(
    select 1 from vehicle_tracking_devices d
    where d.device_id<>p_device_id and d.status='active'
      and d.platform_identifiers->>p_platform=trim(p_platform_identifier)
  ) then
    raise exception '此手機掃描到的藍牙設備已綁定其他車輛';
  end if;

  update vehicle_tracking_devices set
    platform_identifiers=jsonb_set(coalesce(platform_identifiers,'{}'::jsonb),array[p_platform],to_jsonb(trim(p_platform_identifier)),true),
    advertised_name=coalesce(nullif(advertised_name,''),nullif(trim(p_advertised_name),'')),
    service_uuid=coalesce(nullif(service_uuid,''),nullif(trim(p_service_uuid),'')),
    verification_status=case when verification_status='untested' then 'scanning' else verification_status end,
    last_seen_at=now()
  where device_id=p_device_id
  returning * into v_device;
  return v_device;
end $$;
revoke all on function bind_vehicle_tracking_ble_device(uuid,text,text,text,text) from public,anon;
grant execute on function bind_vehicle_tracking_ble_device(uuid,text,text,text,text) to authenticated;

alter table vehicle_tracking_devices enable row level security;
alter table vehicle_tracking_sessions enable row level security;
alter table vehicle_location_points enable row level security;
alter table vehicle_location_daily_summaries enable row level security;
alter table vehicle_geofences enable row level security;
alter table vehicle_tracking_events enable row level security;

drop policy if exists vehicle_tracking_devices_read on vehicle_tracking_devices;
drop policy if exists vehicle_tracking_devices_manage_insert on vehicle_tracking_devices;
drop policy if exists vehicle_tracking_devices_manage_update on vehicle_tracking_devices;
create policy vehicle_tracking_devices_read on vehicle_tracking_devices for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));
create policy vehicle_tracking_devices_manage_insert on vehicle_tracking_devices for insert to authenticated
  with check (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()));
create policy vehicle_tracking_devices_manage_update on vehicle_tracking_devices for update to authenticated
  using (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()))
  with check (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()));

drop policy if exists vehicle_tracking_sessions_read on vehicle_tracking_sessions;
drop policy if exists vehicle_tracking_sessions_start on vehicle_tracking_sessions;
drop policy if exists vehicle_tracking_sessions_finish on vehicle_tracking_sessions;
create policy vehicle_tracking_sessions_read on vehicle_tracking_sessions for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));
create policy vehicle_tracking_sessions_start on vehicle_tracking_sessions for insert to authenticated
  with check (public.has_system_access('sys_vehicletracking') and
    (driver_id=public.active_user_id() or public.can_manage_vehicle_tracking()));
create policy vehicle_tracking_sessions_finish on vehicle_tracking_sessions for update to authenticated
  using (public.has_system_access('sys_vehicletracking') and
    (driver_id=public.active_user_id() or public.can_manage_vehicle_tracking()))
  with check (public.has_system_access('sys_vehicletracking') and
    (driver_id=public.active_user_id() or public.can_manage_vehicle_tracking()));

drop policy if exists vehicle_location_points_read on vehicle_location_points;
drop policy if exists vehicle_location_points_ingest on vehicle_location_points;
create policy vehicle_location_points_read on vehicle_location_points for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));
create policy vehicle_location_points_ingest on vehicle_location_points for insert to authenticated
  with check (public.has_system_access('sys_vehicletracking') and recorded_by=public.active_user_id() and
    exists(select 1 from vehicle_tracking_sessions s where s.session_id=vehicle_location_points.session_id and s.status='active'
      and s.vehicle_id=vehicle_location_points.vehicle_id and s.device_id=vehicle_location_points.device_id
      and s.driver_id=public.active_user_id()));

drop policy if exists vehicle_location_daily_summaries_read on vehicle_location_daily_summaries;
create policy vehicle_location_daily_summaries_read on vehicle_location_daily_summaries for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));

drop policy if exists vehicle_geofences_read on vehicle_geofences;
drop policy if exists vehicle_geofences_manage_insert on vehicle_geofences;
drop policy if exists vehicle_geofences_manage_update on vehicle_geofences;
create policy vehicle_geofences_read on vehicle_geofences for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));
create policy vehicle_geofences_manage_insert on vehicle_geofences for insert to authenticated
  with check (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()));
create policy vehicle_geofences_manage_update on vehicle_geofences for update to authenticated
  using (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()))
  with check (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()));

drop policy if exists vehicle_tracking_events_read on vehicle_tracking_events;
drop policy if exists vehicle_tracking_events_report_ble on vehicle_tracking_events;
drop policy if exists vehicle_tracking_events_acknowledge on vehicle_tracking_events;
create policy vehicle_tracking_events_read on vehicle_tracking_events for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));
create policy vehicle_tracking_events_report_ble on vehicle_tracking_events for insert to authenticated
  with check (
    public.has_system_access('sys_vehicletracking')
    and event_type in ('ble_disconnected','ble_reconnected')
    and acknowledged_at is null and acknowledged_by is null
    and occurred_at between now()-interval '24 hours' and now()+interval '5 minutes'
    and exists(
      select 1 from vehicle_tracking_sessions s
      where s.session_id=vehicle_tracking_events.session_id and s.status='active'
        and s.driver_id=public.active_user_id()
        and s.vehicle_id=vehicle_tracking_events.vehicle_id
        and s.device_id=vehicle_tracking_events.device_id
    )
  );
create policy vehicle_tracking_events_acknowledge on vehicle_tracking_events for update to authenticated
  using (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()))
  with check (public.has_system_access('sys_vehicletracking') and (public.can_manage_vehicle_tracking()));

drop policy if exists vehicles_tracking_read on official_vehicles;
create policy vehicles_tracking_read on official_vehicles for select to authenticated
  using (public.has_system_access('sys_vehicletracking'));

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='vehicle_location_points') then
      alter publication supabase_realtime add table public.vehicle_location_points;
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='vehicle_tracking_events') then
      alter publication supabase_realtime add table public.vehicle_tracking_events;
    end if;
  end if;
end $$;

do $$
declare table_name text;
begin
  if to_regprocedure('public.reject_physical_data_removal()') is null then
    raise exception '缺少正式資料永久保護，停止建立定位資料表';
  else
    foreach table_name in array array[
      'vehicle_tracking_devices','vehicle_tracking_sessions','vehicle_location_points','vehicle_location_daily_summaries',
      'vehicle_geofences','vehicle_tracking_events'
    ] loop
      execute format('drop trigger if exists trg_prevent_removal on public.%I',table_name);
      execute format('create trigger trg_prevent_removal before delete or truncate on public.%I for each statement execute function public.reject_physical_data_removal()',table_name);
    end loop;
  end if;
end $$;

-- Explicit privileges; RLS still gates all authenticated access.
revoke all on vehicle_tracking_devices,vehicle_tracking_sessions,vehicle_location_points,
  vehicle_location_daily_summaries,vehicle_geofences,vehicle_tracking_events from anon;
grant select on vehicle_tracking_devices,vehicle_tracking_sessions,vehicle_location_points,
  vehicle_location_daily_summaries,vehicle_geofences,vehicle_tracking_events to authenticated;
grant insert,update on vehicle_tracking_devices,vehicle_tracking_sessions,vehicle_geofences,vehicle_tracking_events to authenticated;
grant insert on vehicle_location_points to authenticated;
grant usage on sequence vehicle_location_points_point_id_seq to authenticated;
notify pgrst, 'reload schema';
commit;
