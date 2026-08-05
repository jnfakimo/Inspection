begin;

-- 派車預計時段必須在未來；完成行車回報時，實際時間不得晚於現在。
create or replace function guard_vehicle_dispatch_time_window()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  schedule_changed boolean := tg_op='INSERT';
begin
  if tg_op='UPDATE' then
    schedule_changed := new.trip_date is distinct from old.trip_date
      or new.planned_departure_time is distinct from old.planned_departure_time
      or new.planned_return_time is distinct from old.planned_return_time;
  end if;

  if (
    new.status in ('draft','pending_approval','approved','assigned')
    or (new.status='returned' and schedule_changed)
  ) and ((new.trip_date+new.planned_departure_time) at time zone 'Asia/Taipei')<=now() then
    raise exception using errcode='22023',message='預計出發時間已經過去，請選擇目前時間之後的時段';
  end if;

  if new.status='completed' and (
    (new.actual_departure_at is not null and new.actual_departure_at>now())
    or (new.actual_return_at is not null and new.actual_return_at>now())
  ) then
    raise exception using errcode='22023',message='實際出發與回程時間不得晚於目前時間';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_time_window on vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_time_window
  before insert or update of trip_date,planned_departure_time,planned_return_time,status,actual_departure_at,actual_return_at
  on vehicle_dispatch_requests
  for each row execute function guard_vehicle_dispatch_time_window();

-- 依系統班別設定計算交接班結束時間；設定異常時使用標準三班制。
create or replace function handover_shift_end_at(p_shift_date date,p_shift_type text)
returns timestamptz
language plpgsql
stable
set search_path=public
as $$
declare
  v_start text;
  v_end text;
  v_config text;
begin
  v_start:=case p_shift_type when 'morning' then '06:00' when 'afternoon' then '14:00' when 'night' then '22:00' else null end;
  v_end:=case p_shift_type when 'morning' then '14:00' when 'afternoon' then '22:00' when 'night' then '06:00' else null end;
  begin
    select value into v_config from system_settings where key='shifts';
    if nullif(v_config,'') is not null then
      select item->>'start',item->>'end' into v_start,v_end
      from jsonb_array_elements(v_config::jsonb) item
      where item->>'id'=p_shift_type limit 1;
    end if;
  exception when others then
    null;
  end;
  if v_start is null or v_end is null or v_start!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode='22023',message='找不到有效的交接班別時間設定';
  end if;
  return ((p_shift_date+case when v_end::time<=v_start::time then 1 else 0 end)+v_end::time) at time zone 'Asia/Taipei';
end;
$$;

create or replace function guard_handover_time_window()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if handover_shift_end_at(new.shift_date,new.shift_type)<=now() then
    raise exception using errcode='22023',message='所選交接日期與班別已經結束，不能建立過去班次的交接單';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_handover_time_window on handover_records;
create trigger trg_guard_handover_time_window
  before insert or update of shift_date,shift_type,status on handover_records
  for each row execute function guard_handover_time_window();

create or replace function guard_handover_incident_time()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.incident_time is not null and new.incident_time>now() then
    raise exception using errcode='22023',message='發生時間不得晚於目前時間';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_handover_incident_time on handover_cases;
create trigger trg_guard_handover_incident_time
  before insert or update of incident_time on handover_cases
  for each row execute function guard_handover_incident_time();

commit;
