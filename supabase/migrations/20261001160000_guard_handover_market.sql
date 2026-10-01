-- 駐警隊交接簿依市場隔離；既有交接與附件由基礎移轉保留為一市場。
begin;

-- 兩市可有同日同名班別與獨立簽核。
drop index if exists public.idx_guard_handover_logs_duty_shift;
drop index if exists public.idx_guard_handover_approval_date;
create unique index if not exists guard_log_market_date_shift on public.guard_handover_logs(market_code,duty_date,shift_name);
create unique index if not exists guard_approval_market_date on public.guard_handover_daily_approvals(market_code,duty_date);
create index if not exists guard_log_market_date on public.guard_handover_logs(market_code,duty_date desc,shift_order);

-- 二市先建立空白班別範本，僅複製班名與時段，不複製一市排定人員。
insert into public.patrol_shift_template(name,start_time,end_time,sort_order,status,assigned_user_ids,market_code)
select name,start_time,end_time,sort_order,status,'{}'::uuid[],'market_2'
from public.patrol_shift_template
where market_code='market_1' and status='active'
  and not exists(select 1 from public.patrol_shift_template where market_code='market_2');

create or replace function public.guard_market_allowed(p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_market in ('market_1','market_2')
    and (public.has_handover_module_access('guard') or public.has_handover_module_access('guard-approve'))
    and (public.active_rbac_role()='sysadmin' or exists(
      select 1 from jsonb_array_elements_text(public.handover_staff_markets(public.active_user_id(),'guard')) m(value)
      where m.value=p_market))
$$;
revoke all on function public.guard_market_allowed(text) from public,anon;
grant execute on function public.guard_market_allowed(text) to authenticated,service_role;

create or replace function public.guard_market_receiver_allowed(p_user uuid,p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_market in ('market_1','market_2') and public.guard_receiver_allowed(p_user)
    and (public.handover_staff_market(p_user,'guard')=p_market or
      exists(select 1 from public.users u where u.user_id=p_user and u.status='active' and u.rbac_role='sysadmin'))
$$;
revoke all on function public.guard_market_receiver_allowed(uuid,text) from public,anon,authenticated;
grant execute on function public.guard_market_receiver_allowed(uuid,text) to service_role;

create or replace function public.guard_market_receivers(p_market text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,'department',u.department,'status',u.status) order by u.name),'[]'::jsonb)
  from public.users u where public.guard_market_receiver_allowed(u.user_id,p_market)
$$;
revoke all on function public.guard_market_receivers(text) from public,anon,authenticated;
grant execute on function public.guard_market_receivers(text) to service_role;

create or replace function public.protect_guard_handover_log()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  content_keys text[] := array['status','handover_by','handover_at','receiver_id','takeover_by','takeover_at','patrol_snapshot','updated_by','updated_at'];
begin
  if tg_op='INSERT' then
    if exists(select 1 from public.guard_handover_daily_approvals a where a.market_code=new.market_code and a.duty_date=new.duty_date) then
      raise exception using errcode='23514',message='guard handover day has been approved and is locked';
    end if;
    if new.status<>'draft' then raise exception using errcode='23514',message='guard handover must start as draft'; end if;
    new.handover_by:=null; new.handover_at:=null; new.receiver_id:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
    new.updated_by:=new.created_by; new.created_at:=now(); new.updated_at:=now();
    return new;
  end if;

  if new.log_id is distinct from old.log_id or new.market_code is distinct from old.market_code or new.duty_date is distinct from old.duty_date or new.shift_name is distinct from old.shift_name
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='guard handover identity fields are immutable';
  end if;
  if exists(select 1 from public.guard_handover_daily_approvals a where a.market_code=old.market_code and a.duty_date=old.duty_date) then
    raise exception using errcode='23514',message='guard handover day has been approved and is locked';
  end if;
  if old.status='received' then raise exception using errcode='23514',message='received guard handover is immutable'; end if;
  if old.status='submitted' and (to_jsonb(new)-content_keys) is distinct from (to_jsonb(old)-content_keys) then
    raise exception using errcode='23514',message='submitted guard handover content is locked';
  end if;

  if old.status='draft' and new.status='draft' then
    new.handover_by:=null; new.handover_at:=null; new.receiver_id:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='draft' and new.status='submitted' then
    if new.handover_by is distinct from new.updated_by then raise exception using errcode='23514',message='handover signer must be the acting user'; end if;
    if new.receiver_id is null or new.receiver_id=new.handover_by then raise exception using errcode='23514',message='a different designated receiver is required'; end if;
    if not public.guard_market_receiver_allowed(new.receiver_id,new.market_code) then raise exception using errcode='23514',message='designated receiver must belong to the handover market'; end if;
    new.handover_at:=now(); new.takeover_by:=null; new.takeover_at:=null;
  elsif old.status='submitted' and new.status='draft' then
    if new.updated_by is distinct from old.handover_by then raise exception using errcode='23514',message='only the handover signer can withdraw'; end if;
    new.handover_by:=null; new.handover_at:=null; new.receiver_id:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='submitted' and new.status='received' then
    if old.receiver_id is null or new.takeover_by is distinct from old.receiver_id or new.takeover_by is distinct from new.updated_by then
      raise exception using errcode='23514',message='only the designated receiver can sign for takeover';
    end if;
    new.handover_by:=old.handover_by; new.handover_at:=old.handover_at; new.receiver_id:=old.receiver_id; new.patrol_snapshot:=old.patrol_snapshot; new.takeover_at:=now();
  else
    raise exception using errcode='23514',message='invalid guard handover status transition';
  end if;
  new.updated_at:=now();
  return new;
end
$$;

create or replace function public.protect_guard_handover_approval()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    raise exception using errcode='23514',message='guard handover approval is immutable';
  end if;
  if new.duty_date>=(now() at time zone 'Asia/Taipei')::date then
    raise exception using errcode='23514',message='guard handover can only be approved from the next day';
  end if;
  if exists(select 1 from public.guard_handover_logs l where l.market_code=new.market_code and l.duty_date=new.duty_date and l.status<>'received') then
    raise exception using errcode='23514',message='all guard handovers of the day must be received before approval';
  end if;
  new.approved_at:=now(); new.created_at:=now();
  return new;
end
$$;

create or replace function public.protect_guard_handover_attachment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from public.guard_handover_daily_approvals a where a.market_code=new.market_code and a.duty_date=new.duty_date) then
    raise exception using errcode='23514',message='guard handover day has been approved and is locked';
  end if;
  if exists(select 1 from public.guard_handover_logs l where l.market_code=new.market_code and l.duty_date=new.duty_date and l.shift_name=new.shift_name and l.status<>'draft') then
    raise exception using errcode='23514',message='guard handover attachments are locked after the handover is signed';
  end if;
  if tg_op='INSERT' then
    new.is_deleted:=false; new.deleted_by:=null; new.deleted_at:=null; new.uploaded_at:=now();
    return new;
  end if;
  if old.is_deleted then
    raise exception using errcode='23514',message='deleted guard handover attachment is immutable';
  end if;
  if not new.is_deleted or (to_jsonb(new)-array['is_deleted','deleted_by','deleted_at']) is distinct from (to_jsonb(old)-array['is_deleted','deleted_by','deleted_at']) then
    raise exception using errcode='23514',message='guard handover attachment can only be soft-deleted';
  end if;
  new.deleted_at:=now();
  return new;
end
$$;

-- 直接以登入權杖讀表時也必須遵守市場範圍。
drop policy if exists guard_handover_logs_read on public.guard_handover_logs;
create policy guard_handover_logs_read on public.guard_handover_logs for select to authenticated
  using(public.guard_market_allowed(market_code));
drop policy if exists guard_handover_approvals_read on public.guard_handover_daily_approvals;
create policy guard_handover_approvals_read on public.guard_handover_daily_approvals for select to authenticated
  using(public.guard_market_allowed(market_code));
drop policy if exists guard_handover_attachments_read on public.guard_handover_attachments;
create policy guard_handover_attachments_read on public.guard_handover_attachments for select to authenticated
  using(public.guard_market_allowed(market_code));

notify pgrst, 'reload schema';
commit;
