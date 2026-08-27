-- 公務車派車逾期回報與里程卡控。
--
-- 1. 行程已出車但缺少起始／回程里程時，禁止完成回報。
-- 2. 同一車輛有前一趟未補里程的已出車／逾期已接單行程時，禁止再次派車。
-- 3. 車輛管理人開啟派車頁時，建立去重的站內通知給司機、申請人與車輛管理人。

begin;

create or replace function public.guard_vehicle_dispatch_mileage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_now_time time := (now() at time zone 'Asia/Taipei')::time;
begin
  if new.status = 'cancelled'
     and nullif(btrim(coalesce(new.cancel_reason, '')), '') is null then
    raise exception using
      errcode = '23514',
      message = '取消派車申請前，必須填寫取消原因';
  end if;

  if new.status = 'completed'
     and (new.odometer_start is null or new.odometer_end is null) then
    raise exception using
      errcode = '23514',
      message = '完成行車回報前，必須填寫起始與回程里程';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'approved'
       and new.status = 'assigned'
       and new.vehicle_id is not null
       and exists (
         select 1
         from public.vehicle_dispatch_requests prior
         where prior.request_id <> old.request_id
           and prior.vehicle_id = new.vehicle_id
           and prior.status in ('assigned', 'completed')
           and (prior.odometer_start is null or prior.odometer_end is null)
           and (
             prior.actual_departure_at is not null
             or (
               prior.driver_accepted_at is not null
               and (
                 prior.trip_date < v_today
                 or (prior.trip_date = v_today and prior.planned_return_time <= v_now_time)
               )
             )
           )
       ) then
      raise exception using
        errcode = '23514',
        message = '該車輛上一趟行程已出車但尚未填寫完整里程，暫停派車，請先完成司機回報';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_mileage on public.vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_mileage
before insert or update of status, vehicle_id, odometer_start, odometer_end, actual_departure_at, driver_accepted_at, cancel_reason
on public.vehicle_dispatch_requests
for each row execute function public.guard_vehicle_dispatch_mileage();

create or replace function public.notify_vehicle_dispatch_followups()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_today date := (now() at time zone 'Asia/Taipei')::date;
  v_now_time time := (now() at time zone 'Asia/Taipei')::time;
  v_request record;
  v_recipient uuid;
  v_body text;
  v_sent integer := 0;
begin
  select u.user_id
  into v_actor
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor is null then
    raise exception using errcode = '42501', message = '找不到有效的派車系統人員帳號';
  end if;
  if not public.has_system_access('sys_vehicle') then
    raise exception using errcode = '42501', message = '目前角色沒有公務車派車系統權限';
  end if;
  if not (public.is_admin() or exists(
    select 1 from public.vehicle_dispatch_managers m
    where m.user_id = v_actor and m.active
  )) then
    raise exception using errcode = '42501', message = '只有車輛管理人可以建立派車回報提醒';
  end if;

  for v_request in
    select r.*
    from public.vehicle_dispatch_requests r
    where r.status in ('assigned', 'completed', 'cancelled')
      and (
        (r.status = 'cancelled' and nullif(btrim(coalesce(r.cancel_reason, '')), '') is null)
        or
        (r.status = 'completed' and (r.odometer_start is null or r.odometer_end is null))
        or (r.status = 'assigned' and r.actual_departure_at is not null
            and (r.odometer_start is null or r.odometer_end is null))
        or (r.status = 'assigned' and r.actual_departure_at is not null and r.actual_return_at is null)
        or (r.status = 'assigned' and r.trip_date < v_today)
      )
    order by r.trip_date, r.created_at
  loop
    v_body := case
      when v_request.status = 'cancelled'
           and nullif(btrim(coalesce(v_request.cancel_reason, '')), '') is null
        then '派車申請已取消但沒有取消原因，請申請人或司機補登取消原因。'
      when v_request.status = 'completed'
           and (v_request.odometer_start is null or v_request.odometer_end is null)
        then '行程已出車但里程未補齊，車輛暫停再派，請司機補填起始／回程里程。'
      when v_request.actual_departure_at is not null
           and (v_request.odometer_start is null or v_request.odometer_end is null)
        then '已記錄出車但尚未填寫完整里程，請司機補填起始／回程里程。'
      when v_request.actual_departure_at is not null
           and v_request.actual_return_at is null
        then '已出車但尚未完成行車回報，請司機補填回程與里程。'
      when v_request.driver_accepted_at is null
        then '用車日期已過且沒有使用紀錄，請司機或申請人填寫取消原因後取消。'
      else '司機已接單但沒有出車回報，請司機填寫取消原因或完成行車回報。'
    end;

    for v_recipient in
      select distinct recipients.recipient_id
      from (
        select v_request.driver_id as recipient_id
        union all select v_request.applicant_id
        union all select m.user_id from public.vehicle_dispatch_managers m where m.active
      ) recipients
      where recipients.recipient_id is not null
        and exists (
          select 1 from public.users u
          where u.user_id = recipients.recipient_id and u.status = 'active'
        )
    loop
      insert into public.notifications(recipient_id, event, title, body, request_id)
      select v_recipient,
             'vehicle_dispatch_followup',
             '公務車派車回報提醒',
             left(format('%s｜用車日 %s｜%s', v_request.request_no, v_request.trip_date, v_body), 500),
             v_request.request_id
      where not exists (
        select 1
        from public.notifications n
        where n.recipient_id = v_recipient
          and n.event = 'vehicle_dispatch_followup'
          and n.request_id = v_request.request_id
          and n.created_at > now() - interval '1 day'
      );
      if found then v_sent := v_sent + 1; end if;
    end loop;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.guard_vehicle_dispatch_mileage() from public, anon, authenticated;
revoke all on function public.notify_vehicle_dispatch_followups() from public, anon;
grant execute on function public.notify_vehicle_dispatch_followups() to authenticated;

notify pgrst, 'reload schema';

commit;
