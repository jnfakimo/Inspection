-- 派車時段衝突改用看得懂的訊息。
--
-- 排除約束 vehicle_dispatch_no_time_overlap 正確擋下了同一台車的時段重疊，但它丟出的是
-- 英文的 23P01「conflicting key value violates exclusion constraint」。前端 errorMessage()
-- 的規則裡沒有這一條（它不是 unique/duplicate），於是落到最後的通用備援
-- 「操作失敗，請稍後再試」——語意上還會讓人以為是暫時性故障而一直重試。
--
-- 只改訊息，不動約束本身：不可以讓同一台車在重疊時段被派兩次。

CREATE OR REPLACE FUNCTION public.vehicle_request_action(p_request_id uuid, p_action text, p_note text DEFAULT NULL::text, p_vehicle_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid)
 RETURNS vehicle_dispatch_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid;
  v_actor_name text;
  v_req public.vehicle_dispatch_requests;
  v_from text;
  v_to text;
  v_log_action text;
  v_log_note text;
  v_plate text;
  v_driver text;
  v_now timestamptz := now();
  v_conflict text;
begin
  select u.user_id, coalesce(nullif(btrim(coalesce(u.name, '')), ''), u.username)
  into v_actor, v_actor_name
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor is null then
    raise exception using errcode = '42501', message = '找不到有效的派車系統人員帳號';
  end if;
  if not public.has_system_access('sys_vehicle') then
    raise exception using errcode = '42501', message = '目前角色沒有公務車派車系統權限';
  end if;

  select * into v_req
  from public.vehicle_dispatch_requests
  where request_id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '02000', message = '找不到這筆派車申請';
  end if;

  if not (
    v_req.applicant_id = v_actor
    or v_req.driver_id = v_actor
    or public.is_admin()
    or exists (
      select 1 from public.vehicle_dispatch_managers manager
      where manager.user_id = v_actor and manager.active
    )
    or (
      p_action in ('approve', 'return')
      and exists (
        select 1
        from public.users applicant
        join public.users actor on actor.user_id = v_actor and actor.status = 'active'
        where applicant.user_id = v_req.applicant_id
          and (
            applicant.supervisor_id = v_actor
            or (
              applicant.supervisor_id is null
              and coalesce(actor.rbac_role, case actor.role when 'supervisor' then 'unit_supervisor' else actor.role end) = 'unit_supervisor'
              and (
                (applicant.dept_id is not null and applicant.dept_id = actor.dept_id)
                or (applicant.dept_id is null and nullif(btrim(applicant.department), '') is not null
                    and btrim(applicant.department) = btrim(actor.department))
              )
            )
          )
      )
    )
  ) then
    raise exception using errcode = '42501', message = '沒有異動這筆派車申請的權限';
  end if;

  v_from := v_req.status;
  if p_action in ('approve', 'return') then
    if v_req.status <> 'pending_approval' then
      raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
    end if;
    if p_action = 'return' and coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception using errcode = '23514', message = '退回時請填寫原因';
    end if;
    v_to := case p_action when 'approve' then 'approved' else 'returned' end;
    update public.vehicle_dispatch_requests set
      status = v_to,
      supervisor_id = v_actor,
      supervisor_name = v_actor_name,
      supervisor_note = nullif(btrim(coalesce(p_note, '')), ''),
      approved_at = case when p_action = 'approve' then v_now else null end
    where request_id = p_request_id
    returning * into v_req;
    v_log_action := case p_action when 'approve' then '單位主管核可' else '單位主管退回' end;
    v_log_note := nullif(btrim(coalesce(p_note, '')), '');

  elsif p_action = 'dispatch' then
    if v_req.status <> 'approved' then
      raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
    end if;
    if p_vehicle_id is null or p_driver_id is null then
      raise exception using errcode = '23514', message = '請選擇公務車及司機';
    end if;
    select plate_no into v_plate from public.official_vehicles where vehicle_id = p_vehicle_id;
    if v_plate is null then raise exception using errcode = '02000', message = '找不到指定的公務車'; end if;
    select coalesce(nullif(btrim(coalesce(name, '')), ''), username) into v_driver
    from public.users where user_id = p_driver_id;
    if v_driver is null then raise exception using errcode = '02000', message = '找不到指定的司機'; end if;
    v_to := 'assigned';
    -- 同一台車時段重疊由排除約束 vehicle_dispatch_no_time_overlap 擋下。約束丟出的是
    -- 英文的 23P01，前端的訊息轉換對不到任何規則，只會顯示「操作失敗，請稍後再試」，
    -- 使用者完全看不出是車輛已被借走（2026-08-31 CAR-20260831-0016 就是這樣卡住的）。
    -- 這裡把它轉成講得清楚的繁中訊息，並指出是哪一張單佔用了時段。
    begin
      update public.vehicle_dispatch_requests set
        status = 'assigned', vehicle_manager_id = v_actor, vehicle_manager_name = v_actor_name,
        vehicle_id = p_vehicle_id, plate_no = v_plate, driver_id = p_driver_id,
        driver_name = v_driver, dispatch_note = nullif(btrim(coalesce(p_note, '')), ''),
        dispatched_at = v_now, driver_accepted_at = null, driver_accepted_by = null
      where request_id = p_request_id
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
        and other.request_id <> p_request_id
        and other.status in ('pending_approval', 'approved', 'assigned', 'completed')
        and tsrange(other.trip_date + other.planned_departure_time,
                    other.trip_date + other.planned_return_time, '[)')
            && tsrange(v_req.trip_date + v_req.planned_departure_time,
                       v_req.trip_date + v_req.planned_return_time, '[)');
      raise exception using errcode = '23P01',
        message = format('公務車 %s 在這個時段已被其他派車單使用%s，請改派其他車輛或調整用車時段',
                         v_plate,
                         case when v_conflict is null then '' else '：' || v_conflict end);
    end;
    v_log_action := '派車管理員完成派車';
    v_log_note := format('%s｜司機 %s%s', v_plate, v_driver,
      case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else '｜' || btrim(p_note) end);

  elsif p_action = 'accept' then
    if v_req.status <> 'assigned' then
      raise exception using errcode = '22023', message = '此派車單已被處理，請重新整理';
    end if;
    if v_req.driver_accepted_at is not null then
      raise exception using errcode = '22023', message = '此派車單已接單，請重新整理';
    end if;
    v_from := 'assigned'; v_to := 'assigned';
    update public.vehicle_dispatch_requests set driver_accepted_at = v_now, driver_accepted_by = v_actor
    where request_id = p_request_id returning * into v_req;
    v_log_action := '司機接單';
    v_log_note := format('%s｜%s → %s', coalesce(v_req.plate_no, '公務車'),
      coalesce(v_req.origin_location, ''), coalesce(v_req.destination_location, ''));

  elsif p_action = 'cancel' then
    if v_req.status in ('completed', 'cancelled') then
      raise exception using errcode = '22023', message = '已完成或已取消的派車單無法取消';
    end if;
    if coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception using errcode = '23514', message = '請填寫取消原因';
    end if;
    v_to := 'cancelled';
    update public.vehicle_dispatch_requests
    set status = 'cancelled', cancel_reason = btrim(p_note), cancelled_at = v_now
    where request_id = p_request_id returning * into v_req;
    v_log_action := '取消派車申請';
    v_log_note := btrim(p_note);
  else
    raise exception using errcode = '22023', message = '不支援的派車流程動作';
  end if;

  insert into public.vehicle_dispatch_logs
    (request_id, from_status, to_status, action, note, operator_id, operator_name)
  values (p_request_id, v_from, v_to, v_log_action, v_log_note, v_actor, v_actor_name);
  return v_req;
end;
$function$
;
