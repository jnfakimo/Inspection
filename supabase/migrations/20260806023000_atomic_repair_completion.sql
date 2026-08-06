-- Complete a maintenance order and its related records in one transaction.
-- Storage uploads happen first; callers remove those objects if this RPC fails.

create or replace function public.complete_repair_order(
  p_order_id uuid,
  p_description text,
  p_completion_note text,
  p_has_cost boolean,
  p_cost_amount numeric,
  p_cost_note text,
  p_attachments jsonb default '[]'::jsonb
) returns void
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_order public.maintenance_orders%rowtype;
  v_now timestamptz := now();
  v_name text;
begin
  if nullif(btrim(p_description),'') is null then
    raise exception 'completion description is required' using errcode='22023';
  end if;
  select * into v_order from public.maintenance_orders where order_id=p_order_id for update;
  if not found then raise exception 'maintenance order not found' using errcode='P0002'; end if;
  if p_has_cost and (coalesce(p_cost_amount,0)<=0 or v_order.equipment_id is null) then
    raise exception 'valid equipment and cost are required' using errcode='22023';
  end if;
  select name into v_name from public.users where user_id=public.active_user_id();

  update public.maintenance_orders set
    status='pending_review', finish_time=v_now, result_desc=p_description,
    handle_method=p_description, note=p_completion_note
  where order_id=p_order_id;

  update public.repair_requests set status='pending_review',updated_at=v_now
  where request_id=v_order.request_id;

  insert into public.repair_attachments(request_id,order_id,kind,file_path,file_name,uploaded_by)
  select v_order.request_id,v_order.order_id,'photo',a.file_path,a.file_name,public.active_user_id()
  from jsonb_to_recordset(coalesce(p_attachments,'[]'::jsonb)) as a(file_path text,file_name text);

  if p_has_cost then
    insert into public.cost_records(equipment_id,order_id,cost_type,amount,cost_date,note,created_by)
    values(v_order.equipment_id,v_order.order_id,'other',p_cost_amount,(v_now at time zone 'Asia/Taipei')::date,
      nullif(btrim(p_cost_note),''),public.active_user_id());
  end if;

  insert into public.case_status_log(request_id,order_id,from_status,to_status,operator_id,operator_name,note)
  values(v_order.request_id,v_order.order_id,v_order.status,'pending_review',public.active_user_id(),coalesce(v_name,'維修人員'),
    '維修說明：'||p_description||'｜'||case when p_has_cost then '維修費用 NT$ '||p_cost_amount::text else '本次無維修費用' end);
end;
$$;

revoke all on function public.complete_repair_order(uuid,text,text,boolean,numeric,text,jsonb) from public,anon;
grant execute on function public.complete_repair_order(uuid,text,text,boolean,numeric,text,jsonb) to authenticated;
