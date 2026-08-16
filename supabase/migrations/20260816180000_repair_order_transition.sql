-- 維修派工狀態轉移改為單一交易。
--
-- workorder.html 與 dispatch.html 各自實作了一份幾乎逐行相同的狀態轉移邏輯，
-- 每個轉移都分別寫 maintenance_orders、repair_requests 與 case_status_log 三次，
-- 且兩檔合計 49 個寫入點中有 41 個完全不接回傳值。任一步失敗時前面已經 commit，
-- 兩張表的狀態會永久不一致（例如工單已接單、報修單仍停在待處理），畫面不會有
-- 任何徵兆，使用者也不會收到錯誤。
--
-- 本函式把「工單更新 + 報修單更新 + 歷程寫入」收斂為單一交易，並回到伺服器端
-- 統一判定各轉移的目標狀態，前端不再自行決定要把哪張表寫成什麼。
--
-- 授權：security definer 會繞過 RLS，故函式內逐條重作兩張表的更新條件——
--   repair_requests_managed_update    : sys_workorder 且（is_admin／有 dispatch
--                                       權限／建案者／該案工單的受指派技師）
--   maintenance_orders_managed_update : sys_workorder 且（is_admin／有 dispatch
--                                       權限／technician 且為自己的工單）
-- 另依動作檢查對應的 app permission，對應前端 hasPerm 的 update/close/sign/delete。

begin;

create or replace function public.repair_order_transition(
  p_request_id uuid,
  p_action     text,
  p_order_id   uuid  default null,
  p_note       text  default null,
  p_payload    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor        uuid;
  v_req          public.repair_requests;
  v_ord          public.maintenance_orders;
  v_has_order    boolean := false;
  v_effective    text;
  v_from         text;
  v_to           text;
  v_perm         text;
  v_ord_status   text := null;   -- null 表示不動工單狀態
  v_req_status   text := null;   -- null 表示不動報修單狀態
  v_accept       text := null;
  v_clear_assign boolean := false;
  v_touch_order  boolean := false;
  v_now          timestamptz := now();
begin
  select u.user_id into v_actor
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor is null then
    raise exception using errcode = '42501', message = '找不到有效的維修系統人員帳號';
  end if;

  if not public.has_system_access('sys_workorder') then
    raise exception using errcode = '42501', message = '目前角色沒有維修派工系統權限';
  end if;

  select * into v_req from public.repair_requests where request_id = p_request_id for update;
  if not found then
    raise exception using errcode = '02000', message = '找不到這筆報修案件';
  end if;

  if p_order_id is not null then
    select * into v_ord from public.maintenance_orders where order_id = p_order_id for update;
    if not found then
      raise exception using errcode = '02000', message = '找不到這張維修工單';
    end if;
    if v_ord.request_id <> p_request_id then
      raise exception using errcode = '22023', message = '工單與報修案件不符';
    end if;
    v_has_order := true;
  end if;

  -- driver(r)：有工單取工單狀態，否則取報修單狀態。
  v_effective := case when v_has_order then v_ord.status else v_req.status end;

  v_perm := case p_action
              when 'close'        then 'close'
              when 'cancel'       then 'delete'
              when 'confirm_unit' then 'sign'
              else 'update'
            end;
  if not public.has_app_permission(v_perm) then
    raise exception using errcode = '42501', message = '沒有執行此操作的權限';
  end if;

  if p_action = 'accept' then
    v_ord_status := 'accepted'; v_accept := 'accepted'; v_req_status := 'assigned';
    v_from := 'assigned'; v_to := 'accepted';
  elsif p_action = 'return' then
    v_ord_status := 'returned'; v_accept := 'returned';
    v_req_status := 'pending'; v_clear_assign := true;
    v_from := v_effective; v_to := 'returned';
  elsif p_action = 'reject' then
    v_ord_status := 'rejected'; v_accept := 'rejected';
    v_req_status := 'pending'; v_clear_assign := true;
    v_from := v_effective; v_to := 'rejected';
  elsif p_action = 'start' then
    v_ord_status := 'in_progress'; v_req_status := 'in_progress';
    v_from := 'accepted'; v_to := 'in_progress';
  elsif p_action in ('wait_parts','wait_vendor') then
    v_ord_status := case p_action when 'wait_parts' then 'waiting_parts' else 'waiting_vendor' end;
    v_from := 'in_progress'; v_to := v_ord_status;
  elsif p_action = 'resume' then
    v_ord_status := 'in_progress';
    v_from := v_effective; v_to := 'in_progress';
  elsif p_action = 'complete' then
    v_ord_status := 'pending_review'; v_req_status := 'pending_review';
    v_from := 'in_progress'; v_to := 'pending_review';
  elsif p_action = 'close' then
    v_ord_status := 'closed'; v_req_status := 'closed';
    v_from := 'pending_review'; v_to := 'closed';
  elsif p_action = 'reopen' then
    v_ord_status := 'in_progress'; v_req_status := 'in_progress';
    v_from := 'pending_review'; v_to := 'in_progress';
  elsif p_action = 'cancel' then
    v_req_status := 'cancelled';
    v_from := v_effective; v_to := 'cancelled';
  elsif p_action = 'confirm_unit' then
    v_from := 'pending_review'; v_to := 'pending_review';
  else
    raise exception using errcode = '22023', message = '不支援的維修流程動作';
  end if;

  v_touch_order := v_has_order and v_ord_status is not null;

  -- 對應 maintenance_orders_managed_update
  if v_touch_order and not (
       public.is_admin()
       or public.has_app_permission('dispatch')
       or (public.active_rbac_role() = 'technician' and v_ord.assignee_id = v_actor)
     ) then
    raise exception using errcode = '42501', message = '只有派工人員或該工單的技師可以異動此工單';
  end if;

  -- 對應 repair_requests_managed_update
  if v_req_status is not null and not (
       public.is_admin()
       or public.has_app_permission('dispatch')
       or v_req.created_by = v_actor
       or exists(select 1 from public.maintenance_orders m
                 where m.request_id = p_request_id and m.assignee_id = v_actor)
     ) then
    raise exception using errcode = '42501', message = '沒有異動此報修案件的權限';
  end if;

  if v_touch_order then
    update public.maintenance_orders set
      status        = v_ord_status,
      accept_status = coalesce(v_accept, accept_status),
      start_time    = case when p_action = 'start' then v_now else start_time end,
      arrival_time  = case when p_action = 'start' then coalesce(arrival_time, v_now) else arrival_time end,
      finish_time   = case when p_action = 'complete' then v_now else finish_time end,
      fault_cause   = case when p_action = 'complete' then nullif(btrim(coalesce(p_payload->>'fault_cause','')),'')   else fault_cause end,
      handle_method = case when p_action = 'complete' then nullif(btrim(coalesce(p_payload->>'handle_method','')),'') else handle_method end,
      parts_used    = case when p_action = 'complete' then nullif(btrim(coalesce(p_payload->>'parts_used','')),'')    else parts_used end,
      materials     = case when p_action = 'complete' then nullif(btrim(coalesce(p_payload->>'materials','')),'')     else materials end,
      labor_hours   = case when p_action = 'complete' then (nullif(p_payload->>'labor_hours',''))::numeric            else labor_hours end
    where order_id = p_order_id;
  end if;

  if v_req_status is not null then
    update public.repair_requests set
      status      = v_req_status,
      assignee_id = case when v_clear_assign then null else assignee_id end,
      updated_at  = v_now
    where request_id = p_request_id;
  end if;

  insert into public.case_status_log
    (request_id, order_id, from_status, to_status, note, operator_id, operator_name)
  values (
    p_request_id, p_order_id, v_from, v_to,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_actor,
    (select coalesce(nullif(btrim(coalesce(u.name, '')), ''), u.username) from public.users u where u.user_id = v_actor)
  );
end;
$$;

revoke all on function public.repair_order_transition(uuid, text, uuid, text, jsonb) from public, anon;
grant execute on function public.repair_order_transition(uuid, text, uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
