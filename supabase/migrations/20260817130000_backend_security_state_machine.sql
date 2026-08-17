-- 後端安全基線：限流、RLS、通知來源與維修狀態機。
-- 僅新增保護與稽核規則，不刪除既有業務資料，也不修改 V1 畫面。
begin;

-- 1) 以登入帳號為主的 API 限流。Edge Function 透過 authenticated RPC 呼叫，
--    因此同一帳號無法靠重複 POST 把整個資料表批次抓走。
create table if not exists public.api_rate_limits (
  rate_key text primary key,
  window_started timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;
revoke all on table public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_scope text default 'app-api',
  p_window_seconds integer default 60,
  p_max_requests integer default 120
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
  v_scope text := regexp_replace(coalesce(p_scope,'app-api'), '[^a-zA-Z0-9:_-]', '', 'g');
  v_key text;
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception using errcode='42501', message='未登入'; end if;
  if p_window_seconds not between 10 and 3600 or p_max_requests not between 10 and 1000 then
    raise exception using errcode='22023', message='限流參數無效';
  end if;
  v_key := v_uid || ':' || left(v_scope,40);
  insert into public.api_rate_limits(rate_key,window_started,request_count,updated_at)
  values(v_key,v_now,1,v_now)
  on conflict(rate_key) do update set
    window_started = case when v_now - api_rate_limits.window_started >= make_interval(secs => p_window_seconds) then v_now else api_rate_limits.window_started end,
    request_count = case when v_now - api_rate_limits.window_started >= make_interval(secs => p_window_seconds) then 1 else api_rate_limits.request_count + 1 end,
    updated_at = v_now
  returning * into v_row;
  return v_row.request_count <= p_max_requests;
end;
$$;
revoke all on function public.consume_api_rate_limit(text,integer,integer) from public,anon;
grant execute on function public.consume_api_rate_limit(text,integer,integer) to authenticated;

-- 2) 一般登入者只能讀自己的帳號與自身角色權限；管理資料由 admin-api
--    以 service role 讀取，避免 PostgREST 被拿來整表爬取。
drop policy if exists users_active_read on public.users;
create policy users_active_read on public.users for select to authenticated
  using (user_id=public.active_user_id() or public.is_admin());
drop policy if exists rbac_active_read_roles on public.roles;
create policy rbac_active_read_roles on public.roles for select to authenticated
  using (public.is_admin());
drop policy if exists rbac_active_read_permissions on public.role_permissions;
create policy rbac_active_read_permissions on public.role_permissions for select to authenticated
  using (public.is_admin() or role_id=public.active_rbac_role());

-- 3) 通知不可由瀏覽器任意指定收件人、標題或內容；只允許受控的後端
--    觸發器產生，使用者仍可讀取/標記自己的通知。
drop policy if exists notifications_managed_insert on public.notifications;
drop policy if exists authenticated_only on public.notifications;
create policy notifications_backend_insert on public.notifications for insert to authenticated
  with check (false);
revoke insert on public.notifications from authenticated;

create or replace function public.emit_workorder_notification()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_event text;
  v_title text;
  v_body text;
  v_req public.repair_requests%rowtype;
  v_order public.maintenance_orders%rowtype;
  v_recipient uuid;
begin
  if new.request_id is null then return new; end if;
  select * into v_req from public.repair_requests where request_id=new.request_id;
  if not found then return new; end if;
  if new.order_id is not null then select * into v_order from public.maintenance_orders where order_id=new.order_id; end if;
  v_event := case new.to_status
    when 'assigned' then 'dispatch' when 'accepted' then 'accept'
    when 'in_progress' then 'start' when 'pending_review' then 'complete'
    when 'completed' then 'sign' when 'closed' then 'close'
    when 'cancelled' then 'cancel' else null end;
  if v_event is null then return new; end if;
  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
  values('repair_workflow',new.request_id::text,'status_change',
    jsonb_build_object('from_status',new.from_status,'to_status',new.to_status,'event',v_event,'order_id',new.order_id),
    new.operator_id,'workflow-db');
  v_title := case v_event
    when 'dispatch' then '報修案件已派工' when 'accept' then '工程師已接單'
    when 'start' then '維修已開始' when 'complete' then '維修已完工，待驗收'
    when 'sign' then '報修人已驗收，待主管驗收' when 'close' then '案件已結案'
    else '報修案件狀態更新' end;
  v_body := coalesce(v_req.req_no, v_req.request_id::text) || '：' || v_title;
  for v_recipient in
    select distinct x.user_id from (values (v_req.created_by), (v_req.assignee_id), (v_order.assignee_id)) x(user_id)
    where x.user_id is not null
      and exists(select 1 from public.users u where u.user_id=x.user_id and u.status='active')
  loop
    insert into public.notifications(recipient_id,event,title,body,request_id,order_id)
    select v_recipient,v_event,v_title,left(v_body,500),new.request_id,new.order_id
    where not exists(
      select 1 from public.notifications n where n.recipient_id=v_recipient
        and n.event=v_event and n.request_id=new.request_id and coalesce(n.order_id,'00000000-0000-0000-0000-000000000000')=coalesce(new.order_id,'00000000-0000-0000-0000-000000000000')
        and n.created_at > now()-interval '5 seconds'
    );
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_case_status_log_notification on public.case_status_log;
create trigger trg_case_status_log_notification after insert on public.case_status_log
for each row execute function public.emit_workorder_notification();
revoke all on function public.emit_workorder_notification() from public,anon,authenticated;

-- 歷程同樣不可由客戶端偽造；流程 RPC 以 SECURITY DEFINER 寫入。
drop policy if exists case_status_log_own_insert on public.case_status_log;
create policy case_status_log_backend_insert on public.case_status_log for insert to authenticated with check (false);
revoke insert on public.case_status_log from authenticated;

-- 4) 任何直接 UPDATE 都必須符合 V1 六階段合法順序；RPC 仍可在同一交易內更新。
create or replace function public.enforce_workorder_state_transition()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $$
declare r text := public.active_rbac_role(); a uuid := public.active_user_id();
begin
  if old.status is not distinct from new.status then return new; end if;
  if old.status='closed' or old.status='cancelled' then raise exception '已結案或已取消的案件不可再修改' using errcode='22023'; end if;
  if tg_table_name='repair_requests' then
    if not ((old.status in ('pending','transferred','returned','rejected') and new.status='assigned')
      or (old.status='assigned' and new.status in ('in_progress','pending','cancelled'))
      or (old.status='in_progress' and new.status in ('waiting_parts','waiting_vendor','pending_review','cancelled'))
      or (old.status in ('waiting_parts','waiting_vendor') and new.status in ('in_progress','cancelled'))
      or (old.status='pending_review' and new.status in ('completed','in_progress'))
      or (old.status='completed' and new.status='closed')) then
      raise exception '報修案件狀態轉移不合法：% -> %',old.status,new.status using errcode='22023';
    end if;
    if r not in ('sysadmin','unit_supervisor','mgmt_supervisor','dispatcher','duty') and not (r='technician' and new.status in ('in_progress','waiting_parts','waiting_vendor','pending_review')) and not (r='reporter' and old.status='pending_review' and new.status='completed' and new.created_by=a) then
      raise exception '目前角色不可執行此報修狀態轉移' using errcode='42501';
    end if;
  else
    if not ((old.status in ('pending','assigned') and new.status in ('accepted','returned','rejected','cancelled'))
      or (old.status='accepted' and new.status='in_progress')
      or (old.status='in_progress' and new.status in ('waiting_parts','waiting_vendor','pending_review','cancelled'))
      or (old.status in ('waiting_parts','waiting_vendor') and new.status in ('in_progress','cancelled'))
      or (old.status='pending_review' and new.status in ('completed','in_progress'))
      or (old.status='completed' and new.status='closed')) then
      raise exception '維修工單狀態轉移不合法：% -> %',old.status,new.status using errcode='22023';
    end if;
    if r not in ('sysadmin','unit_supervisor','mgmt_supervisor','dispatcher','duty') and not (r='technician' and old.assignee_id=a and new.status in ('accepted','in_progress','waiting_parts','waiting_vendor','pending_review')) and not (r='reporter' and old.status='pending_review' and new.status='completed') then
      raise exception '目前角色不可執行此工單狀態轉移' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_repair_request_state_guard on public.repair_requests;
create trigger trg_repair_request_state_guard before update of status on public.repair_requests for each row execute function public.enforce_workorder_state_transition();
drop trigger if exists trg_maintenance_order_state_guard on public.maintenance_orders;
create trigger trg_maintenance_order_state_guard before update of status on public.maintenance_orders for each row execute function public.enforce_workorder_state_transition();
revoke all on function public.enforce_workorder_state_transition() from public,anon;

-- 防止同一案件被建立多張進行中的工單（保留既有歷史資料）。
create or replace function public.prevent_duplicate_active_workorder()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status not in ('closed','cancelled','rejected') and exists(select 1 from public.maintenance_orders m where m.request_id=new.request_id and m.order_id<>coalesce(new.order_id,'00000000-0000-0000-0000-000000000000') and m.status not in ('closed','cancelled','rejected')) then
    raise exception '此報修案件已有進行中的維修工單' using errcode='23505';
  end if;
  return new;
end; $$;
drop trigger if exists trg_no_duplicate_active_workorder on public.maintenance_orders;
create trigger trg_no_duplicate_active_workorder before insert on public.maintenance_orders for each row execute function public.prevent_duplicate_active_workorder();
revoke all on function public.prevent_duplicate_active_workorder() from public,anon;

commit;
