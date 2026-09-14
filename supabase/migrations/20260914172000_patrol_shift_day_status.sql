-- 明確記錄每日巡檢班表是否停用，避免清除每日覆寫後又由固定範本自動遞補。

begin;

create table if not exists public.patrol_shift_day_status (
  duty_date date primary key,
  status text not null default 'active' check (status in ('active','suspended')),
  reason text,
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now()
);

alter table public.patrol_shift_day_status enable row level security;
alter table public.patrol_shift_day_status force row level security;
drop policy if exists patrol_shift_day_status_read on public.patrol_shift_day_status;
create policy patrol_shift_day_status_read on public.patrol_shift_day_status
  for select to authenticated using (public.active_user_id() is not null);
revoke all on table public.patrol_shift_day_status from public, anon;
grant select on table public.patrol_shift_day_status to authenticated;

drop trigger if exists trg_prevent_removal on public.patrol_shift_day_status;
create trigger trg_prevent_removal before delete or truncate on public.patrol_shift_day_status
  for each statement execute function public.reject_physical_data_removal();

create or replace function public.set_patrol_shift_day_status(
  p_duty_date date,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operator uuid;
  v_before record;
  v_status text := case when p_suspended then 'suspended' else 'active' end;
  v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  if not public.is_admin() then
    raise exception using errcode='42501', message='只有系統管理者可以調整當日班表狀態';
  end if;
  if p_duty_date is null or p_duty_date < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode='22023', message='只能調整今天或未來的班表狀態';
  end if;
  if p_suspended and v_reason is null then
    raise exception using errcode='22023', message='停用當日班表時必須填寫原因';
  end if;
  select user_id into v_operator from public.users where auth_id=auth.uid() and status='active';
  if v_operator is null then raise exception using errcode='42501', message='找不到有效的操作人員'; end if;
  select * into v_before from public.patrol_shift_day_status where duty_date=p_duty_date;

  insert into public.patrol_shift_day_status(duty_date,status,reason,updated_by,updated_at)
  values(p_duty_date,v_status,v_reason,v_operator,now())
  on conflict(duty_date) do update set status=excluded.status,reason=excluded.reason,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
  values('patrol_shift_day_status',p_duty_date::text,'status_change',
    jsonb_build_object('before',case when v_before.duty_date is null then null else jsonb_build_object('status',v_before.status,'reason',v_before.reason) end,
      'after',jsonb_build_object('status',v_status,'reason',v_reason)),v_operator,'v2-patrol-day-status');
  return jsonb_build_object('duty_date',p_duty_date,'status',v_status,'reason',v_reason);
end;
$$;

create or replace function public.reset_patrol_shifts_from_date(
  p_from date,
  p_duty_shift_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_operator uuid;
  v_until date;
  v_count integer;
  v_days integer;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='只有系統管理者可以清除巡檢班別'; end if;
  if p_from is null or p_from < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode='22023',message='只能清除今天或未來的班別，過去班表必須保留';
  end if;
  select user_id into v_operator from public.users where auth_id=auth.uid() and status='active';
  if v_operator is null then raise exception using errcode='42501',message='找不到有效的操作人員'; end if;

  select greatest(p_from,coalesce(max(case when replace(coalesce(name,''),' ','') ~* '(夜班|night)'
    then shift_date-1 else shift_date end),p_from)) into v_until
  from public.patrol_shifts where shift_date>=p_from and name not like '[已刪除]%';
  v_count := public.soft_delete_patrol_shifts_from_date(p_from,p_duty_shift_ids);

  insert into public.patrol_shift_day_status(duty_date,status,reason,updated_by,updated_at)
  select day::date,'suspended','批次清除每日班別，等待重新套用範本',v_operator,now()
  from generate_series(p_from,v_until,'1 day'::interval) day
  on conflict(duty_date) do update set status='suspended',reason=excluded.reason,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  v_days := v_until-p_from+1;
  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
  values('patrol_shift_day_status',p_from::text||'..'||v_until::text,'status_change',
    jsonb_build_object('status','suspended','from',p_from,'to',v_until,'days',v_days,'deleted_shifts',v_count),
    v_operator,'v2-patrol-bulk-reset');
  return jsonb_build_object('count',v_count,'from_date',p_from,'to_date',v_until,'suspended_days',v_days);
end;
$$;

create or replace function public.apply_all_patrol_shift_templates_and_activate(p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb; v_operator uuid;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='只有系統管理者可以套用巡檢班別範本'; end if;
  v_result := public.apply_all_patrol_shift_templates_range(p_from,p_to);
  select user_id into v_operator from public.users where auth_id=auth.uid() and status='active';
  insert into public.patrol_shift_day_status(duty_date,status,reason,updated_by,updated_at)
  select day::date,'active','已重新套用全部班別範本',v_operator,now()
  from generate_series(p_from,p_to,'1 day'::interval) day
  on conflict(duty_date) do update set status='active',reason=excluded.reason,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
  values('patrol_shift_day_status',p_from::text||'..'||p_to::text,'status_change',
    jsonb_build_object('status','active','from',p_from,'to',p_to,'apply_result',v_result),v_operator,'v2-patrol-activate-range');
  return v_result;
end;
$$;

revoke all on function public.set_patrol_shift_day_status(date,boolean,text) from public,anon;
revoke all on function public.reset_patrol_shifts_from_date(date,uuid[]) from public,anon;
revoke all on function public.apply_all_patrol_shift_templates_and_activate(date,date) from public,anon;
grant execute on function public.set_patrol_shift_day_status(date,boolean,text) to authenticated;
grant execute on function public.reset_patrol_shifts_from_date(date,uuid[]) to authenticated;
grant execute on function public.apply_all_patrol_shift_templates_and_activate(date,date) to authenticated;

notify pgrst,'reload schema';
commit;
