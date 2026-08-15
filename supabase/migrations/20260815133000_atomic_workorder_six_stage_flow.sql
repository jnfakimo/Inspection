-- V2 維修六階段流程的單一原子入口。
-- 保留既有 V1 樣板與狀態名稱，只確保案件、工單與歷程同步更新。

alter table if exists public.maintenance_orders
  add column if not exists updated_at timestamptz default now();

-- 既有保護觸發器未允許 start_time / updated_at，造成工程師按下
-- 「開始維修」時被誤擋；報修人驗收則需要只同步工單狀態。
create or replace function public.protect_technician_order_columns()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if public.can_manage_workorder() then return new; end if;

  if public.active_rbac_role()='technician' then
    if (to_jsonb(new)-array[
      'status','start_time','finish_time','result_desc','handle_method','note','accept_status',
      'arrival_time','fault_cause','parts_used','labor_hours','materials','updated_at'
    ]) is distinct from (to_jsonb(old)-array[
      'status','start_time','finish_time','result_desc','handle_method','note','accept_status',
      'arrival_time','fault_cause','parts_used','labor_hours','materials','updated_at'
    ]) then
      raise exception 'order assignment fields are immutable for technicians' using errcode='42501';
    end if;
    return new;
  end if;

  if public.active_rbac_role()='reporter'
     and old.status='pending_review' and new.status='completed'
     and exists(
       select 1 from public.repair_requests r
       where r.request_id=new.request_id and r.created_by=public.active_user_id()
     )
     and (to_jsonb(new)-array['status','updated_at']) is not distinct from
         (to_jsonb(old)-array['status','updated_at']) then
    return new;
  end if;

  raise exception 'order update is not allowed for this role' using errcode='42501';
end $$;
create or replace function public.apply_repair_workflow(
  p_request_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor public.users%rowtype;
  v_request public.repair_requests%rowtype;
  v_order public.maintenance_orders%rowtype;
  v_has_order boolean := false;
  v_role text;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_now timestamptz := now();
  v_assignee uuid;
  v_vendor text;
  v_note text;
  v_labor numeric;
begin
  select * into v_actor
  from public.users
  where auth_id=auth.uid() and status='active'
  limit 1;
  if not found then raise exception '找不到啟用中的系統帳號' using errcode='42501'; end if;

  v_role := coalesce(v_actor.rbac_role,case v_actor.role
    when 'admin' then 'sysadmin'
    when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician'
    when 'inspector' then 'reporter'
    else v_actor.role end,'reporter');

  select * into v_request
  from public.repair_requests
  where request_id=p_request_id
  for update;
  if not found then raise exception '找不到報修案件' using errcode='P0002'; end if;

  select * into v_order
  from public.maintenance_orders
  where request_id=p_request_id
  order by created_at desc
  limit 1
  for update;
  v_has_order := found;

  if v_action='dispatch' then
    if v_role not in ('sysadmin','unit_supervisor','mgmt_supervisor','dispatcher','duty') then
      raise exception '僅限主管或派工管理人員派工' using errcode='42501';
    end if;
    if v_request.status not in ('pending','transferred','returned','rejected') then
      raise exception '目前案件狀態不可派工：%' , v_request.status using errcode='22023';
    end if;

    begin
      v_assignee := nullif(btrim(coalesce(p_payload->>'technician','')),'')::uuid;
    exception when invalid_text_representation then
      raise exception '維修人員識別碼格式錯誤' using errcode='22023';
    end;
    v_vendor := nullif(btrim(coalesce(p_payload->>'vendor','')),'');
    if v_assignee is null and v_vendor is null then
      raise exception '請選擇維修人員或填寫委外廠商' using errcode='22023';
    end if;
    if v_assignee is not null and not exists(
      select 1 from public.users u
      where u.user_id=v_assignee and u.status='active'
        and coalesce(u.rbac_role,case u.role when 'maintenance' then 'technician' else u.role end)='technician'
    ) then
      raise exception '指派人員必須是啟用中的工程師' using errcode='22023';
    end if;

    if v_has_order then
      update public.maintenance_orders set
        equipment_id=v_request.equipment_id,
        assignee_id=v_assignee,
        vendor=v_vendor,
        expected_arrival=nullif(p_payload->>'expected_arrival','')::timestamptz,
        expected_finish=nullif(p_payload->>'expected_finish','')::timestamptz,
        work_content=nullif(btrim(coalesce(p_payload->>'work_content','')),''),
        need_shutdown=coalesce((p_payload->>'need_shutdown')::boolean,false),
        need_approval=coalesce((p_payload->>'need_approval')::boolean,false),
        status='assigned',accept_status='pending',arrival_time=null,start_time=null,finish_time=null,
        updated_at=v_now
      where order_id=v_order.order_id
      returning * into v_order;
    else
      insert into public.maintenance_orders(
        request_id,equipment_id,assignee_id,vendor,expected_arrival,expected_finish,
        work_content,need_shutdown,need_approval,status,accept_status
      ) values(
        p_request_id,v_request.equipment_id,v_assignee,v_vendor,
        nullif(p_payload->>'expected_arrival','')::timestamptz,
        nullif(p_payload->>'expected_finish','')::timestamptz,
        nullif(btrim(coalesce(p_payload->>'work_content','')),''),
        coalesce((p_payload->>'need_shutdown')::boolean,false),
        coalesce((p_payload->>'need_approval')::boolean,false),'assigned','pending'
      ) returning * into v_order;
      v_has_order := true;
    end if;

    update public.repair_requests
    set status='assigned',assignee_id=v_assignee,updated_at=v_now
    where request_id=p_request_id;
    v_note := '主管派工'||case when v_assignee is not null then '｜工程師：'||coalesce((select name from public.users where user_id=v_assignee),'未命名') else '' end
      ||case when v_vendor is not null then '｜委外：'||v_vendor else '' end;

  elsif v_action='engineer_accept' then
    if not v_has_order then raise exception '尚未建立維修工單' using errcode='22023'; end if;
    if v_role<>'sysadmin' and (v_role<>'technician' or v_order.assignee_id is distinct from v_actor.user_id) then
      raise exception '僅限已指派工程師接單' using errcode='42501';
    end if;
    if v_request.status<>'assigned' or v_order.status<>'assigned' then
      raise exception '目前狀態不可接單' using errcode='22023';
    end if;
    update public.maintenance_orders set status='accepted',accept_status='accepted',arrival_time=coalesce(arrival_time,v_now),updated_at=v_now where order_id=v_order.order_id;
    update public.repair_requests set updated_at=v_now where request_id=p_request_id;
    v_note := '工程師接單';

  elsif v_action='engineer_start' then
    if not v_has_order then raise exception '尚未建立維修工單' using errcode='22023'; end if;
    if v_role<>'sysadmin' and (v_role<>'technician' or v_order.assignee_id is distinct from v_actor.user_id) then
      raise exception '僅限已指派工程師開始維修' using errcode='42501';
    end if;
    if v_request.status<>'assigned' or v_order.status<>'accepted' then
      raise exception '請先完成工程師接單' using errcode='22023';
    end if;
    update public.maintenance_orders set status='in_progress',start_time=coalesce(start_time,v_now),arrival_time=coalesce(arrival_time,v_now),updated_at=v_now where order_id=v_order.order_id;
    update public.repair_requests set status='in_progress',updated_at=v_now where request_id=p_request_id;
    v_note := '工程師開始維修';

  elsif v_action='engineer_complete' then
    if not v_has_order then raise exception '尚未建立維修工單' using errcode='22023'; end if;
    if v_role<>'sysadmin' and (v_role<>'technician' or v_order.assignee_id is distinct from v_actor.user_id) then
      raise exception '僅限已指派工程師回報完工' using errcode='42501';
    end if;
    if v_request.status<>'in_progress' or v_order.status<>'in_progress' then
      raise exception '案件尚未進入維修中' using errcode='22023';
    end if;
    if nullif(btrim(coalesce(p_payload->>'fault_cause','')),'') is null then raise exception '請填寫故障原因' using errcode='22023'; end if;
    if nullif(btrim(coalesce(p_payload->>'handle_method','')),'') is null then raise exception '請填寫處理方式' using errcode='22023'; end if;
    begin
      v_labor := nullif(btrim(coalesce(p_payload->>'labor_hours','')),'')::numeric;
    exception when invalid_text_representation then
      raise exception '工時必須是零以上的數字' using errcode='22023';
    end;
    if v_labor is not null and v_labor<0 then raise exception '工時必須是零以上的數字' using errcode='22023'; end if;
    update public.maintenance_orders set
      status='pending_review',finish_time=v_now,
      fault_cause=btrim(p_payload->>'fault_cause'),
      handle_method=btrim(p_payload->>'handle_method'),result_desc=btrim(p_payload->>'handle_method'),
      parts_used=nullif(btrim(coalesce(p_payload->>'parts_used','')),''),
      materials=nullif(btrim(coalesce(p_payload->>'materials','')),''),
      labor_hours=v_labor,note=nullif(btrim(coalesce(p_payload->>'note','')),''),updated_at=v_now
    where order_id=v_order.order_id;
    update public.repair_requests set status='pending_review',updated_at=v_now where request_id=p_request_id;
    v_note := '工程師完工，待報修人驗收｜'||btrim(p_payload->>'handle_method');

  elsif v_action='reporter_accept' then
    if not v_has_order then raise exception '尚未建立維修工單' using errcode='22023'; end if;
    if v_role<>'sysadmin' and v_request.created_by is distinct from v_actor.user_id then
      raise exception '僅限原報修人進行本階段驗收' using errcode='42501';
    end if;
    if v_request.status<>'pending_review' or v_order.status<>'pending_review' then
      raise exception '案件尚未等待報修人驗收' using errcode='22023';
    end if;
    update public.maintenance_orders set status='completed',updated_at=v_now where order_id=v_order.order_id;
    update public.repair_requests set status='completed',updated_at=v_now where request_id=p_request_id;
    v_note := '報修人驗收通過，送主管驗收';

  elsif v_action='supervisor_accept' then
    if not v_has_order then raise exception '尚未建立維修工單' using errcode='22023'; end if;
    if v_role not in ('sysadmin','unit_supervisor','mgmt_supervisor') then
      raise exception '僅限主管進行最終驗收' using errcode='42501';
    end if;
    if v_request.status<>'completed' or v_order.status<>'completed' then
      raise exception '請先完成報修人驗收' using errcode='22023';
    end if;
    update public.maintenance_orders set status='closed',accept_status='accepted',approved_by=v_actor.user_id,approved_at=v_now,updated_at=v_now where order_id=v_order.order_id;
    update public.repair_requests set status='closed',updated_at=v_now where request_id=p_request_id;
    v_note := '主管驗收通過，案件結案';

  elsif v_action='cancel' then
    if v_role not in ('sysadmin','unit_supervisor','mgmt_supervisor','dispatcher','duty') then
      raise exception '僅限主管取消案件' using errcode='42501';
    end if;
    if v_request.status in ('pending_review','completed','closed','cancelled') then
      raise exception '目前案件狀態不可取消' using errcode='22023';
    end if;
    if v_has_order then update public.maintenance_orders set status='cancelled',updated_at=v_now where order_id=v_order.order_id; end if;
    update public.repair_requests set status='cancelled',assignee_id=null,updated_at=v_now where request_id=p_request_id;
    v_note := '主管取消案件';
  else
    raise exception '不支援的維修流程動作：%',coalesce(p_action,'') using errcode='22023';
  end if;

  insert into public.case_status_log(request_id,order_id,from_status,to_status,note,operator_id,operator_name)
  values(
    p_request_id,case when v_has_order then v_order.order_id else null end,
    v_request.status,
    case v_action
      when 'dispatch' then 'assigned'
      when 'engineer_accept' then 'accepted'
      when 'engineer_start' then 'in_progress'
      when 'engineer_complete' then 'pending_review'
      when 'reporter_accept' then 'completed'
      when 'supervisor_accept' then 'closed'
      when 'cancel' then 'cancelled'
    end,
    v_note,v_actor.user_id,v_actor.name
  );

  return jsonb_build_object(
    'request_id',p_request_id,
    'order_id',case when v_has_order then v_order.order_id else null end,
    'action',v_action
  );
end;
$$;

revoke all on function public.apply_repair_workflow(uuid,text,jsonb) from public,anon;
grant execute on function public.apply_repair_workflow(uuid,text,jsonb) to authenticated;
