-- 派車申請的狀態轉移改為單一交易。
--
-- 20260816120000 已處理司機行車回報；本次補上其餘四類轉移（核可／退回、派車、
-- 司機接單、取消）。這些流程原本都是「更新申請單（有檢查回傳值）」加上「另外
-- 呼叫 addLog」兩次獨立請求，而 addLog 的錯誤只有 console.warn——申請單狀態
-- 已變更但流程歷程沒寫進去時，畫面與使用者都不會察覺。
--
-- 授權設計：本函式為 security definer，會繞過 RLS。既有的三個 guard trigger
-- （approval、assignment_and_driver、time_window）仍會照常觸發，因此「限同單位
-- 主管核可且不得自核」「須為派車管理員」「只有被指派司機能接單且限用車當日」
-- 等規則不需在此重複實作。
--
-- 但「取消」沒有任何 guard trigger，其授權完全仰賴 RLS 的
-- vehicle_requests_scoped_update。因此函式內必須自行重作該列層級判斷，否則會
-- 變成任何登入者都能取消他人的派車單。下方的檢查對所有動作一律套用。
--
-- 另將 supervisor_name、vehicle_manager_name、driver_name、plate_no 等冗餘欄位
-- 改為伺服器端查表填入，不再採信前端傳入的值。

begin;

create or replace function public.vehicle_request_action(
  p_request_id uuid,
  p_action     text,
  p_note       text default null,
  p_vehicle_id uuid default null,
  p_driver_id  uuid default null
)
returns public.vehicle_dispatch_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      uuid;
  v_actor_name text;
  v_req        public.vehicle_dispatch_requests;
  v_from       text;
  v_to         text;
  v_log_action text;
  v_log_note   text;
  v_plate      text;
  v_driver     text;
  v_now        timestamptz := now();
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

  -- 對應 vehicle_requests_scoped_update：申請人、指派司機、管理者或啟用中的派車管理員。
  if not (
       v_req.applicant_id = v_actor
       or v_req.driver_id = v_actor
       or public.is_admin()
       or exists(select 1 from public.vehicle_dispatch_managers m
                 where m.user_id = v_actor and m.active)
     ) then
    raise exception using errcode = '42501', message = '沒有異動這筆派車申請的權限';
  end if;

  v_from := v_req.status;

  if p_action in ('approve','return') then
    if v_req.status <> 'pending_approval' then
      raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
    end if;
    if p_action = 'return' and coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception using errcode = '23514', message = '退回時請填寫原因';
    end if;
    v_to := case p_action when 'approve' then 'approved' else 'returned' end;

    update public.vehicle_dispatch_requests set
      status         = v_to,
      supervisor_id  = v_actor,
      supervisor_name= v_actor_name,
      supervisor_note= nullif(btrim(coalesce(p_note, '')), ''),
      approved_at    = case when p_action = 'approve' then v_now else null end
    where request_id = p_request_id
    returning * into v_req;

    v_log_action := case p_action when 'approve' then '單位主管核可' else '單位主管退回' end;
    v_log_note   := nullif(btrim(coalesce(p_note, '')), '');

  elsif p_action = 'dispatch' then
    if v_req.status <> 'approved' then
      raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
    end if;
    if p_vehicle_id is null or p_driver_id is null then
      raise exception using errcode = '23514', message = '請選擇公務車及司機';
    end if;

    select plate_no into v_plate from public.official_vehicles where vehicle_id = p_vehicle_id;
    if v_plate is null then
      raise exception using errcode = '02000', message = '找不到指定的公務車';
    end if;
    select coalesce(nullif(btrim(coalesce(name, '')), ''), username) into v_driver
    from public.users where user_id = p_driver_id;
    if v_driver is null then
      raise exception using errcode = '02000', message = '找不到指定的司機';
    end if;

    v_to := 'assigned';
    update public.vehicle_dispatch_requests set
      status              = 'assigned',
      vehicle_manager_id  = v_actor,
      vehicle_manager_name= v_actor_name,
      vehicle_id          = p_vehicle_id,
      plate_no            = v_plate,
      driver_id           = p_driver_id,
      driver_name         = v_driver,
      dispatch_note       = nullif(btrim(coalesce(p_note, '')), ''),
      dispatched_at       = v_now,
      driver_accepted_at  = null,
      driver_accepted_by  = null
    where request_id = p_request_id
    returning * into v_req;

    v_log_action := '派車管理員完成派車';
    v_log_note   := format('%s｜司機 %s%s', v_plate, v_driver,
                      case when nullif(btrim(coalesce(p_note, '')), '') is null
                        then '' else '｜' || btrim(p_note) end);

  elsif p_action = 'accept' then
    if v_req.status <> 'assigned' then
      raise exception using errcode = '22023', message = '此派車單已被處理，請重新整理';
    end if;
    if v_req.driver_accepted_at is not null then
      raise exception using errcode = '22023', message = '此派車單已接單，請重新整理';
    end if;

    v_from := 'assigned'; v_to := 'assigned';
    update public.vehicle_dispatch_requests set
      driver_accepted_at = v_now,
      driver_accepted_by = v_actor
    where request_id = p_request_id
    returning * into v_req;

    v_log_action := '司機接單';
    v_log_note   := format('%s｜%s → %s',
                      coalesce(v_req.plate_no, '公務車'),
                      coalesce(v_req.origin_location, ''),
                      coalesce(v_req.destination_location, ''));

  elsif p_action = 'cancel' then
    if v_req.status in ('completed','cancelled') then
      raise exception using errcode = '22023', message = '已完成或已取消的派車單無法取消';
    end if;
    if coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception using errcode = '23514', message = '請填寫取消原因';
    end if;

    v_to := 'cancelled';
    update public.vehicle_dispatch_requests set
      status       = 'cancelled',
      cancel_reason= btrim(p_note),
      cancelled_at = v_now
    where request_id = p_request_id
    returning * into v_req;

    v_log_action := '取消派車申請';
    v_log_note   := btrim(p_note);

  else
    raise exception using errcode = '22023', message = '不支援的派車流程動作';
  end if;

  insert into public.vehicle_dispatch_logs
    (request_id, from_status, to_status, action, note, operator_id, operator_name)
  values (p_request_id, v_from, v_to, v_log_action, v_log_note, v_actor, v_actor_name);

  return v_req;
end;
$$;

revoke all on function public.vehicle_request_action(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.vehicle_request_action(uuid, text, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
