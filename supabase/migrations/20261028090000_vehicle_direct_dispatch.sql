-- 公務車「臨時直接派車」：長官臨時急需用車時，由派車管理員代為建單並直接指派車輛與司機，
-- 免走「申請人 -> 課長 -> 部門經理」兩層核准。
--
-- 設計原則（不新增子系統，沿用派車申請的同一張單、同一套狀態）：
--   1. 繞過核准是例外，不是捷徑：必須填「臨時急用事由」，單上永久標記為 direct，
--      歷程寫明由誰、因何事由、免核准派車；標記建立後不得修改。
--   2. 單據仍走 approved -> assigned，因此既有的派車管理員檢查、司機名單檢查、
--      同車時段重疊排除約束、LINE 派車通知（after update trigger）、司機接單與行車回報
--      全部照舊生效，不另開旁路。
--   3. 只有啟用中的派車管理員或系統管理員能呼叫；一般申請人無法利用此入口。
--   4. 預計出發時間仍須晚於目前時間（既有 guard_vehicle_dispatch_time_window 不放寬）。

begin;

alter table public.vehicle_dispatch_requests
  add column if not exists dispatch_source text not null default 'normal',
  add column if not exists direct_dispatch_reason text,
  add column if not exists direct_dispatch_by uuid references public.users(user_id),
  add column if not exists direct_dispatch_by_name text;

alter table public.vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_source_check;
alter table public.vehicle_dispatch_requests add constraint vehicle_dispatch_source_check
  check (
    (dispatch_source = 'normal'
      and direct_dispatch_reason is null and direct_dispatch_by is null and direct_dispatch_by_name is null)
    or (dispatch_source = 'direct'
      and nullif(btrim(coalesce(direct_dispatch_reason, '')), '') is not null
      and direct_dispatch_by is not null)
  );

-- 建單守門：直接派車的單只能由派車管理員／系統管理員以「待派車」狀態建立；
-- 建立後來源與事由欄位不得被改寫（SQL Editor、migration 與 service role 不帶 auth.uid，由受信任端自行管理）。
create or replace function public.guard_vehicle_direct_dispatch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_actor_role text;
begin
  if auth.uid() is null then return new; end if;

  if tg_op = 'UPDATE' then
    if new.dispatch_source is distinct from old.dispatch_source
      or new.direct_dispatch_reason is distinct from old.direct_dispatch_reason
      or new.direct_dispatch_by is distinct from old.direct_dispatch_by
      or new.direct_dispatch_by_name is distinct from old.direct_dispatch_by_name then
      raise exception using errcode = '42501', message = '臨時直接派車的來源與事由建立後不得修改';
    end if;
    return new;
  end if;

  if new.dispatch_source = 'direct' then
    select u.user_id,
      coalesce(u.rbac_role, case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end)
    into v_actor, v_actor_role
    from public.users u
    where u.auth_id = auth.uid() and u.status = 'active'
    limit 1;
    if v_actor is null then
      raise exception using errcode = '42501', message = '找不到有效的派車系統人員帳號';
    end if;
    if v_actor_role <> 'sysadmin' and not exists (
      select 1 from public.vehicle_dispatch_managers m where m.user_id = v_actor and m.active
    ) then
      raise exception using errcode = '42501', message = '只有派車管理員可以建立臨時直接派車單';
    end if;
    if new.status <> 'approved' then
      raise exception using errcode = '42501', message = '臨時直接派車單必須以待派車狀態建立';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_vehicle_direct_dispatch() from public, anon, authenticated;

drop trigger if exists trg_guard_vehicle_direct_dispatch on public.vehicle_dispatch_requests;
create trigger trg_guard_vehicle_direct_dispatch
  before insert or update of dispatch_source, direct_dispatch_reason, direct_dispatch_by, direct_dispatch_by_name
  on public.vehicle_dispatch_requests
  for each row execute function public.guard_vehicle_direct_dispatch();

-- 兩層核准守門：一般單仍須課長與部門經理核准才能派車；直接派車單以事由與建單人取代。
create or replace function public.guard_vehicle_two_level_dispatch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'pending_manager_approval' and old.status <> 'pending_approval' then
    raise exception using errcode = '42501', message = '必須先由課長核准，才能送交部門經理';
  end if;
  if new.status = 'assigned' and old.status <> 'assigned' then
    if old.status <> 'approved' then
      raise exception using errcode = '42501', message = '課長與部門經理尚未完成核准，不得派車';
    end if;
    if old.dispatch_source = 'direct' then
      if old.direct_dispatch_by is null or nullif(btrim(coalesce(old.direct_dispatch_reason, '')), '') is null then
        raise exception using errcode = '42501', message = '臨時直接派車必須記錄建單人與臨時急用事由';
      end if;
    elsif old.supervisor_id is null or old.approved_at is null
      or old.department_manager_id is null or old.department_manager_approved_at is null then
      raise exception using errcode = '42501', message = '課長與部門經理尚未完成核准，不得派車';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_vehicle_two_level_dispatch() from public, anon, authenticated;

-- 派車管理員直接建單並派車：單一交易完成「建單 -> 指派車輛與司機 -> 寫流程歷程」。
create or replace function public.vehicle_direct_dispatch(
  p_requester_name text,
  p_requester_department text,
  p_trip_date date,
  p_departure time,
  p_return time,
  p_origin text,
  p_destination text,
  p_purpose text,
  p_passenger_count integer,
  p_reason text,
  p_vehicle_id uuid,
  p_driver_id uuid,
  p_requester_phone text default null,
  p_note text default null
)
returns public.vehicle_dispatch_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_actor_role text;
  v_req public.vehicle_dispatch_requests;
  v_plate text;
  v_vehicle_status text;
  v_driver text;
  v_requester text := nullif(btrim(coalesce(p_requester_name, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_conflict text;
begin
  select u.user_id, coalesce(nullif(btrim(coalesce(u.name, '')), ''), u.username),
    coalesce(u.rbac_role, case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end)
  into v_actor, v_actor_name, v_actor_role
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor is null then
    raise exception using errcode = '42501', message = '找不到有效的派車系統人員帳號';
  end if;
  if not public.has_system_access('sys_vehicle') then
    raise exception using errcode = '42501', message = '目前角色沒有公務車派車系統權限';
  end if;
  if v_actor_role <> 'sysadmin' and not exists (
    select 1 from public.vehicle_dispatch_managers m where m.user_id = v_actor and m.active
  ) then
    raise exception using errcode = '42501', message = '只有派車管理員可以直接派車';
  end if;

  if v_requester is null then
    raise exception using errcode = '23514', message = '請填寫用車人（長官姓名或單位）';
  end if;
  if v_reason is null then
    raise exception using errcode = '23514', message = '請填寫臨時急用事由';
  end if;
  if p_trip_date is null or p_departure is null or p_return is null or p_return <= p_departure then
    raise exception using errcode = '23514', message = '用車日期與起訖時間必須有效，且回程晚於出發';
  end if;
  if nullif(btrim(coalesce(p_origin, '')), '') is null
    or nullif(btrim(coalesce(p_destination, '')), '') is null
    or nullif(btrim(coalesce(p_purpose, '')), '') is null then
    raise exception using errcode = '23514', message = '出發地、目的地與用途皆為必填';
  end if;
  if p_passenger_count is null or p_passenger_count < 1 or p_passenger_count > 99 then
    raise exception using errcode = '23514', message = '搭乘人數必須為 1–99 的整數';
  end if;
  if p_vehicle_id is null or p_driver_id is null then
    raise exception using errcode = '23514', message = '請選擇公務車及司機';
  end if;

  select plate_no, status into v_plate, v_vehicle_status from public.official_vehicles where vehicle_id = p_vehicle_id;
  if v_plate is null then raise exception using errcode = '02000', message = '找不到指定的公務車'; end if;
  if v_vehicle_status <> 'active' then
    raise exception using errcode = '22023', message = '指定的公務車目前不可派用';
  end if;
  select coalesce(nullif(btrim(coalesce(u.name, '')), ''), u.username) into v_driver
  from public.vehicle_dispatch_drivers d
  join public.users u on u.user_id = d.user_id and u.status = 'active'
  where d.user_id = p_driver_id and d.active;
  if v_driver is null then
    raise exception using errcode = '42501', message = '所選人員尚未被指派為公務車司機';
  end if;

  -- 先以「待派車」建單（不帶車輛，不佔時段），再走既有的 approved -> assigned 路徑，
  -- 讓管理員檢查、司機名單檢查、時段重疊約束與 LINE 派車通知全部照舊觸發。
  insert into public.vehicle_dispatch_requests (
    applicant_id, applicant_name, applicant_department, applicant_phone,
    trip_date, planned_departure_time, planned_return_time,
    origin_location, destination_location, trip_purpose, passenger_count,
    status, dispatch_source, direct_dispatch_reason, direct_dispatch_by, direct_dispatch_by_name
  ) values (
    v_actor, v_requester, nullif(btrim(coalesce(p_requester_department, '')), ''),
    nullif(btrim(coalesce(p_requester_phone, '')), ''),
    p_trip_date, p_departure, p_return,
    btrim(p_origin), btrim(p_destination), btrim(p_purpose), p_passenger_count,
    'approved', 'direct', v_reason, v_actor, v_actor_name
  ) returning * into v_req;

  insert into public.vehicle_dispatch_logs
    (request_id, from_status, to_status, action, note, operator_id, operator_name)
  values (v_req.request_id, null, 'approved', '臨時直接建單（免課長與部門經理核准）',
    format('用車人 %s｜事由：%s', v_requester, v_reason), v_actor, v_actor_name);

  begin
    update public.vehicle_dispatch_requests set
      status = 'assigned', vehicle_manager_id = v_actor, vehicle_manager_name = v_actor_name,
      vehicle_id = p_vehicle_id, plate_no = v_plate, driver_id = p_driver_id,
      driver_name = v_driver, dispatch_note = nullif(btrim(coalesce(p_note, '')), ''),
      dispatched_at = v_now, driver_accepted_at = null, driver_accepted_by = null
    where request_id = v_req.request_id
    returning * into v_req;
  exception when exclusion_violation then
    select string_agg(
             format('%s（%s %s–%s）', other.request_no, other.trip_date,
                    to_char(other.planned_departure_time, 'HH24:MI'),
                    to_char(other.planned_return_time, 'HH24:MI')),
             '、' order by other.planned_departure_time)
      into v_conflict
    from public.vehicle_dispatch_requests other
    where other.vehicle_id = p_vehicle_id
      and other.request_id <> v_req.request_id
      and other.status in ('pending_approval', 'pending_manager_approval', 'approved', 'assigned', 'completed')
      and tsrange(other.trip_date + other.planned_departure_time,
                  other.trip_date + other.planned_return_time, '[)')
          && tsrange(p_trip_date + p_departure, p_trip_date + p_return, '[)');
    raise exception using errcode = '23P01',
      message = format('公務車 %s 在這個時段已被其他派車單使用%s，請改派其他車輛或調整用車時段',
                       v_plate,
                       case when v_conflict is null then '' else '：' || v_conflict end);
  end;

  insert into public.vehicle_dispatch_logs
    (request_id, from_status, to_status, action, note, operator_id, operator_name)
  values (v_req.request_id, 'approved', 'assigned', '派車管理員完成派車',
    format('%s｜司機 %s%s', v_plate, v_driver,
      case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else '｜' || btrim(p_note) end),
    v_actor, v_actor_name);

  return v_req;
end;
$$;

revoke all on function public.vehicle_direct_dispatch(text, text, date, time, time, text, text, text, integer, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.vehicle_direct_dispatch(text, text, date, time, time, text, text, text, integer, text, uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
