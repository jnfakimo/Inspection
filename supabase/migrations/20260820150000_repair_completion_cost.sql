-- 完工回報介接費用系統。
--
-- 完工表單（apply_repair_workflow 的 engineer_complete 分支）只記故障原因、處理方式、
-- 更換零件、使用材料、工時與備註，沒有任何費用欄位；cost_records 一直只能靠費用統計
-- 頁手動輸入。結果是設備生命週期成本永遠不會自動累積維修費用——與根規格「每筆費用
-- 綁 equipment_id、由系統彙總設備自購置到報廢的成本」的設計不符。
--
-- 這裡不動 apply_repair_workflow（那是一支兩百多行的 security definer 函式，為了加兩個
-- 欄位重寫整份風險過高），改用獨立函式，由 app-api 在流程推進成功後接著呼叫。
-- 費用寫入失敗不會回滾完工——完工是現場事實，費用可以事後補登。

begin;

create or replace function public.record_repair_completion_cost(
  p_request_id uuid,
  p_parts_cost numeric,
  p_labor_cost numeric
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid;
  v_role    text;
  v_order   record;
  v_written integer := 0;

  procedure_note constant text := '完工回報自動產生';
begin
  select u.user_id,
         coalesce(u.rbac_role, case when u.role = 'admin' then 'sysadmin' else u.role end)
  into v_actor, v_role
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active';
  if v_actor is null then
    raise exception '登入狀態無效' using errcode = '42501';
  end if;

  select o.order_id, o.equipment_id, o.assignee_id, o.status
  into v_order
  from public.maintenance_orders o
  where o.request_id = p_request_id
  order by o.created_at desc
  limit 1;
  if v_order.order_id is null then
    raise exception '尚未建立維修工單' using errcode = '22023';
  end if;
  -- 與 apply_repair_workflow 的 engineer_complete 同一套授權條件。
  if v_role <> 'sysadmin' and v_order.assignee_id is distinct from v_actor then
    raise exception '僅限已指派工程師回報完工費用' using errcode = '42501';
  end if;

  -- 逐項寫入。金額為 null 或 0 就不留紀錄，避免整張表塞滿零元列。
  -- cost_records 受資料保護無法 DELETE，重複回報時改為更新同一筆，不會越積越多。
  declare
    v_item record;
  begin
    for v_item in
      select 'parts'::text as cost_type, p_parts_cost as amount
      union all
      select 'labor'::text, p_labor_cost
    loop
      if v_item.amount is null or v_item.amount <= 0 then
        continue;
      end if;
      if v_item.amount > 9999999999 then
        raise exception '金額超出可接受範圍' using errcode = '22023';
      end if;

      update public.cost_records
      set amount = v_item.amount, cost_date = current_date, note = procedure_note
      where order_id = v_order.order_id and cost_type = v_item.cost_type;

      if not found then
        insert into public.cost_records
          (equipment_id, order_id, cost_type, amount, cost_date, note, created_by)
        values
          (v_order.equipment_id, v_order.order_id, v_item.cost_type, v_item.amount,
           current_date, procedure_note, v_actor);
      end if;
      v_written := v_written + 1;
    end loop;
  end;

  return v_written;
end;
$$;

revoke all on function public.record_repair_completion_cost(uuid, numeric, numeric) from public, anon;
grant execute on function public.record_repair_completion_cost(uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';

commit;
