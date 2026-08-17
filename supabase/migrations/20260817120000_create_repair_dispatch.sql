-- 派工建單改為單一交易。
--
-- 20260816180000 的 repair_order_transition 已收斂 12 種狀態轉移，但「派工建單」
-- 不在其中——該操作除了更新兩張表還要新增工單，需帶十餘個欄位，故當時僅為後續
-- 兩步補上錯誤回報（「工單已建立，但…失敗」），並未收斂為單一交易。
--
-- 本函式補齊最後一段：新增 maintenance_orders、更新 repair_requests、寫入
-- case_status_log 三者於同一交易完成。任一步失敗即整筆回滾，不會再出現「工單
-- 建好了但報修單還停在待處理」的不一致狀態。
--
-- 授權：security definer 會繞過 RLS，故函式內重作兩張表的條件——
--   maintenance_orders_managed_insert : sys_workorder 且（is_admin 或 dispatch 權限）
--   repair_requests_managed_update    : 建單者必然具 dispatch 權限或為管理者，
--                                       已被前者涵蓋，不另檢查。
-- 工單編號沿用資料表既有的 gen_wo_no() 預設值；技師姓名與歷程文字改由伺服器端
-- 組出，不採信前端傳值。

begin;

create or replace function public.create_repair_dispatch(
  p_request_id       uuid,
  p_assignee_id      uuid        default null,
  p_vendor           text        default null,
  p_expected_arrival timestamptz default null,
  p_expected_finish  timestamptz default null,
  p_work_content     text        default null,
  p_need_shutdown    boolean     default false,
  p_need_approval    boolean     default false
)
returns public.maintenance_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor     uuid;
  v_actor_nm  text;
  v_req       public.repair_requests;
  v_order     public.maintenance_orders;
  v_vendor    text := nullif(btrim(coalesce(p_vendor, '')), '');
  v_from      text;
  v_tech_name text;
  v_note      text;
begin
  select u.user_id, coalesce(nullif(btrim(coalesce(u.name, '')), ''), u.username)
  into v_actor, v_actor_nm
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor is null then
    raise exception using errcode = '42501', message = '找不到有效的維修系統人員帳號';
  end if;

  if not public.has_system_access('sys_workorder') then
    raise exception using errcode = '42501', message = '目前角色沒有維修派工系統權限';
  end if;

  if not (public.is_admin() or public.has_app_permission('dispatch')) then
    raise exception using errcode = '42501', message = '沒有派工權限';
  end if;

  if p_assignee_id is null and v_vendor is null then
    raise exception using errcode = '23514', message = '請選擇技師或填寫委外廠商';
  end if;

  select * into v_req
  from public.repair_requests
  where request_id = p_request_id
  for update;

  if not found then
    raise exception using errcode = '02000', message = '找不到這筆報修案件';
  end if;

  if v_req.status in ('closed','cancelled') then
    raise exception using errcode = '22023', message = '已結案或已取消的案件不可派工';
  end if;

  if p_assignee_id is not null then
    select coalesce(nullif(btrim(coalesce(name, '')), ''), username) into v_tech_name
    from public.users where user_id = p_assignee_id and status = 'active';
    if v_tech_name is null then
      raise exception using errcode = '02000', message = '找不到指定的維修人員或該帳號已停用';
    end if;
  end if;

  -- 歷程的來源狀態沿用前端 driver(r) 的語意：有既有工單取其狀態，否則取報修單狀態。
  -- 須在新增工單之前取得，否則會抓到剛建立的這一張。
  select coalesce(
    (select m.status from public.maintenance_orders m
      where m.request_id = p_request_id order by m.created_at desc limit 1),
    v_req.status)
  into v_from;

  insert into public.maintenance_orders
    (request_id, equipment_id, assignee_id, vendor, expected_arrival, expected_finish,
     work_content, need_shutdown, need_approval, status, accept_status)
  values
    (p_request_id, v_req.equipment_id, p_assignee_id, v_vendor, p_expected_arrival, p_expected_finish,
     nullif(btrim(coalesce(p_work_content, '')), ''), coalesce(p_need_shutdown, false),
     coalesce(p_need_approval, false), 'assigned', 'pending')
  returning * into v_order;

  update public.repair_requests
  set status = 'assigned', assignee_id = p_assignee_id, updated_at = now()
  where request_id = p_request_id;

  v_note := '派工 ' || coalesce(v_order.wo_no, '')
            || case when v_tech_name is not null then ' → ' || v_tech_name else '' end
            || case when v_vendor is not null then ' 委外:' || v_vendor else '' end;

  insert into public.case_status_log
    (request_id, order_id, from_status, to_status, note, operator_id, operator_name)
  values (p_request_id, v_order.order_id, v_from, 'assigned', v_note, v_actor, v_actor_nm);

  return v_order;
end;
$$;

revoke all on function public.create_repair_dispatch(
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, boolean) from public, anon;
grant execute on function public.create_repair_dispatch(
  uuid, uuid, text, timestamptz, timestamptz, text, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
