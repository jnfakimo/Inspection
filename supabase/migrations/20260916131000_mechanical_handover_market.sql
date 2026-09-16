-- 機電課交接簿以 market_code 隔離一、二市場；舊資料由前一支基礎移轉歸入二市。
-- 本檔與 app-api／前端市場參數版本須同版發佈。
begin;

alter table public.mechanical_handover_signatures drop constraint if exists mechanical_handover_signatures_work_date_shift_code_key;
alter table public.mechanical_handover_daily_approvals drop constraint if exists mechanical_handover_daily_approvals_work_date_key;
alter table public.mechanical_handover_transfers drop constraint if exists mechanical_handover_transfers_handover_date_shift_code_key;
alter table public.mechanical_handover_transfers drop constraint if exists mechanical_handover_transfers_next_date_next_shift_key;
drop index if exists public.uq_mechanical_handover_daily_approval_date;
create unique index if not exists mechanical_signature_market_shift on public.mechanical_handover_signatures(market_code,work_date,shift_code);
create unique index if not exists mechanical_approval_market_date on public.mechanical_handover_daily_approvals(market_code,work_date);
create unique index if not exists mechanical_transfer_market_outgoing on public.mechanical_handover_transfers(market_code,handover_date,shift_code);
create unique index if not exists mechanical_transfer_market_incoming on public.mechanical_handover_transfers(market_code,next_date,next_shift);

create or replace function public.mechanical_market_allowed(p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_market in ('market_1','market_2')
    and coalesce(public.has_handover_module_access('mechanical'),false)
    and (public.active_rbac_role()='sysadmin'
      or exists(select 1 from jsonb_array_elements_text(public.handover_staff_markets(public.active_user_id(),'mechanical')) m(value) where m.value=p_market))
$$;
revoke all on function public.mechanical_market_allowed(text) from public,anon;
grant execute on function public.mechanical_market_allowed(text) to authenticated,service_role;

create or replace function public.mechanical_market_receiver_allowed(p_user uuid,p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_market in ('market_1','market_2') and coalesce((select (r.role_id='sysadmin' or (
    coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_system_access
      where user_id=u.user_id and system_key='handover'),
      (select allowed from public.role_permissions where role_id=r.role_id and perm='sys_handover'),false)
    and coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_module_access
      where user_id=u.user_id and system_key='handover' and module_key='mechanical'),
      (select case mode when 'allow' then true when 'deny' then false end from public.role_module_access
        where role_id=r.role_id and system_key='handover' and module_key='mechanical'),true)))
    from public.users u
    join public.departments d on d.dept_id=u.dept_id and d.name='機電課' and d.level=2 and d.status='active'
    join public.mechanical_staff_market_scopes ms on ms.user_id=u.user_id and ms.market_code=p_market and ms.is_active
    cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin'
      when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician'
      when 'inspector' then 'reporter' else u.role end) role_id) r
    where u.user_id=p_user and u.status='active'
      and lower(trim(coalesce(u.username,''))) not like 'deidentified-%'
      and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
      and trim(coalesce(u.name,'')) not like '已離職人員-%'),false)
$$;
revoke all on function public.mechanical_market_receiver_allowed(uuid,text) from public,anon,authenticated;

create or replace function public.mechanical_market_receivers(p_market text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.mechanical_market_allowed(p_market) then
    raise exception using errcode='42501',message='目前帳號沒有本市場機電課交接權限';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,
    'department',u.department,'status',u.status) order by u.name),'[]'::jsonb)
    from public.users u where public.mechanical_market_receiver_allowed(u.user_id,p_market)
      and u.user_id<>public.active_user_id());
end $$;
revoke all on function public.mechanical_market_receivers(text) from public,anon;
grant execute on function public.mechanical_market_receivers(text) to authenticated;

create or replace function public.mechanical_market_shift_items(p_market text,p_date date,p_shift text)
returns jsonb language sql stable security definer set search_path='' as $$
  with target as (
    select (p_date-date '2000-01-01')::bigint*3+array_position(array['01-09','09-17','17-01'],p_shift)-1 as slot
  ), rows_with_slot as (
    select e.*, (e.work_date-date '2000-01-01')::bigint*3+array_position(array['01-09','09-17','17-01'],e.shift_code)-1 as slot
    from public.mechanical_handover_entries e where e.market_code=p_market and not e.is_deleted
  )
  select coalesce(jsonb_agg(to_jsonb(e)-'slot'||jsonb_build_object(
    'is_completed',e.result not in ('處理中','待料','待廠商','交下班續辦','無法處理'),
    'carried',e.slot<t.slot,
    'content_locked',exists(select 1 from public.mechanical_handover_transfers x
      where x.market_code=p_market and x.items @> jsonb_build_array(jsonb_build_object('entry_id',e.entry_id)))
  ) order by e.slot,e.sort_order,e.created_at,e.entry_id),'[]'::jsonb)
  from rows_with_slot e cross join target t
  where e.slot<=t.slot and (e.slot=t.slot or (
    e.result in ('處理中','待料','待廠商','交下班續辦','無法處理')
    and not exists(select 1 from rows_with_slot child where child.carry_source_id=e.entry_id and child.slot<=t.slot)))
$$;
revoke all on function public.mechanical_market_shift_items(text,date,text) from public,anon,authenticated;

create or replace function public.lock_mechanical_handover_after_transfer()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('mechanical:'||new.market_code,0));
  if tg_op='UPDATE' and new.market_code is distinct from old.market_code then
    raise exception using errcode='23514',message='已建立工作不可變更市場';
  end if;
  if tg_op='INSERT' and exists(select 1 from public.mechanical_handover_transfers t
    where t.market_code=new.market_code and t.handover_date=new.work_date and t.shift_code=new.shift_code) then
    raise exception using errcode='23514',message='本班已交班，工作內容已鎖定';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.mechanical_handover_transfers t
    where t.market_code=old.market_code and t.items @> jsonb_build_array(jsonb_build_object('entry_id',old.entry_id))) then
    raise exception using errcode='23514',message='工作已列入交班快照，原始內容已鎖定；請由目前班別建立續辦紀錄';
  end if;
  return new;
end $$;

create or replace function public.guard_mechanical_handover_entry()
returns trigger language plpgsql security definer set search_path='' as $$
declare source_row public.mechanical_handover_entries%rowtype; source_slot bigint; target_slot bigint;
begin
  if exists(select 1 from public.mechanical_handover_daily_approvals a
      where a.market_code=new.market_code and a.work_date=new.work_date) then
    raise exception using errcode='23514',message='approved mechanical handover day is locked';
  end if;
  if new.carry_source_id is not null then
    select * into source_row from public.mechanical_handover_entries where entry_id=new.carry_source_id for update;
    if not found or source_row.market_code<>new.market_code then
      raise exception using errcode='23503',message='續辦來源不存在或不屬於同一市場';
    end if;
    if source_row.result not in ('處理中','待料','待廠商','交下班續辦','無法處理') then
      raise exception using errcode='23514',message='completed mechanical work cannot be carried';
    end if;
    source_slot:=(source_row.work_date-date '2000-01-01')::bigint*3+array_position(array['01-09','09-17','17-01'],source_row.shift_code)-1;
    target_slot:=(new.work_date-date '2000-01-01')::bigint*3+array_position(array['01-09','09-17','17-01'],new.shift_code)-1;
    if target_slot<=source_slot then raise exception using errcode='23514',message='mechanical carry target must be a later shift'; end if;
  end if;
  return new;
end $$;

create or replace function public.guard_mechanical_handover_signature()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.market_code is distinct from old.market_code then
    raise exception using errcode='23514',message='已建立簽名不可變更市場';
  end if;
  if exists(select 1 from public.mechanical_handover_daily_approvals a
      where a.market_code=new.market_code and a.work_date=new.work_date) then
    raise exception using errcode='23514',message='approved mechanical handover day is locked';
  end if;
  return new;
end $$;

create or replace function public.require_mechanical_reconciliation_before_approval()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select count(*) from public.mechanical_handover_transfers
      where market_code=new.market_code and handover_date=new.work_date and received_at is not null)<>3 then
    raise exception using errcode='23514',message='本市場三個班別都必須完成交班與接班雙方勾稽後，才能進行每日簽核';
  end if;
  return new;
end $$;

create or replace function public.mechanical_market_day(p_market text,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.mechanical_market_allowed(p_market) then
    raise exception using errcode='42501',message='目前帳號沒有本市場機電課交接權限';
  end if;
  if p_date is null then raise exception '請選擇交接日期'; end if;
  select jsonb_agg(jsonb_build_object('shift_code',s.code,
    'items',coalesce(t.items,public.mechanical_market_shift_items(p_market,p_date,s.code)),
    'revision',coalesce(t.revision,md5(public.mechanical_market_shift_items(p_market,p_date,s.code)::text)),
    'outgoing',to_jsonb(t),'incoming',to_jsonb(prev)) order by s.code) into result
  from (values('01-09'),('09-17'),('17-01')) s(code)
  left join public.mechanical_handover_transfers t on t.market_code=p_market and t.handover_date=p_date and t.shift_code=s.code
  left join public.mechanical_handover_transfers prev on prev.market_code=p_market and prev.next_date=p_date and prev.next_shift=s.code;
  return result;
end $$;

create or replace function public.mechanical_market_action(p_market text,p_action text,p_date date,p_shift text,
  p_receiver uuid default null,p_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; receiver_name text; items jsonb;
  t public.mechanical_handover_transfers; prev public.mechanical_handover_transfers; target_date date; target_shift text;
begin
  if not public.mechanical_market_allowed(p_market) then
    raise exception using errcode='42501',message='目前帳號沒有本市場機電課交接權限';
  end if;
  if p_date is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.mechanical_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可交接'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mechanical:'||p_market,0));
  select name into actor_name from public.users where user_id=actor;
  select * into t from public.mechanical_handover_transfers where market_code=p_market and handover_date=p_date and shift_code=p_shift;
  select * into prev from public.mechanical_handover_transfers where market_code=p_market and next_date=p_date and next_shift=p_shift;
  if p_action='receive' then
    if prev.transfer_id is null then raise exception '上一班尚未送出交班，無法確認接班'; end if;
    if prev.receiver_id<>actor then raise exception using errcode='42501',message='僅指定接班人本人可確認接班'; end if;
    if p_revision is distinct from prev.revision then raise exception '交班內容已變更，請重新載入後確認'; end if;
    if prev.received_at is not null then return to_jsonb(prev); end if;
    update public.mechanical_handover_transfers set received_by=actor,received_name=actor_name,received_at=now()
      where transfer_id=prev.transfer_id returning * into prev;
    return to_jsonb(prev);
  end if;
  if p_action='submit' then
    if t.transfer_id is not null then raise exception '本班已交班，不可重複送出'; end if;
    if prev.transfer_id is null and exists(select 1 from public.mechanical_handover_transfers
      where market_code=p_market and (handover_date,shift_code)<(p_date,p_shift)) then
      raise exception '上一班尚未交班，請先完成上一班交接，不能跳過班別勾稽';
    end if;
    if prev.transfer_id is not null and prev.received_at is null then raise exception '請先由指定接班人完成上一班的接班確認'; end if;
    if prev.transfer_id is not null and prev.received_by<>actor then raise exception using errcode='42501',message='本班須由已確認接班的人員送出交班'; end if;
    if p_receiver is null or p_receiver=actor then raise exception '請指定另一位人員接班，交班與接班不可為同一人'; end if;
    select name into receiver_name from public.users where user_id=p_receiver
      and public.mechanical_market_receiver_allowed(user_id,p_market);
    if receiver_name is null then raise exception '指定接班人必須是在職機電課、屬本市場且具交接權限'; end if;
    items:=public.mechanical_market_shift_items(p_market,p_date,p_shift);
    if p_revision is distinct from md5(items::text) then raise exception '交接工作剛被修改，請重新載入並重新確認'; end if;
    target_date:=p_date+case when p_shift='17-01' then 1 else 0 end;
    target_shift:=case p_shift when '01-09' then '09-17' when '09-17' then '17-01' else '01-09' end;
    insert into public.mechanical_handover_transfers(market_code,handover_date,shift_code,next_date,next_shift,items,revision,
      handed_by,handed_name,receiver_id,receiver_name)
      values(p_market,p_date,p_shift,target_date,target_shift,items,p_revision,actor,actor_name,p_receiver,receiver_name)
      returning * into t;
    return to_jsonb(t);
  end if;
  raise exception '不支援的交接動作';
end $$;

revoke all on function public.mechanical_market_day(text,date),public.mechanical_market_action(text,text,date,text,uuid,text) from public,anon;
grant execute on function public.mechanical_market_day(text,date),public.mechanical_market_action(text,text,date,text,uuid,text) to authenticated;

drop policy if exists mechanical_handover_entries_read on public.mechanical_handover_entries;
drop policy if exists mechanical_handover_entries_write on public.mechanical_handover_entries;
drop policy if exists mechanical_handover_entries_update on public.mechanical_handover_entries;
create policy mechanical_handover_entries_read on public.mechanical_handover_entries for select to authenticated using(public.mechanical_market_allowed(market_code));
create policy mechanical_handover_entries_write on public.mechanical_handover_entries for insert to authenticated with check(public.mechanical_market_allowed(market_code) and created_by=public.active_user_id());
create policy mechanical_handover_entries_update on public.mechanical_handover_entries for update to authenticated using(public.mechanical_market_allowed(market_code)) with check(public.mechanical_market_allowed(market_code) and updated_by=public.active_user_id());
drop policy if exists mechanical_handover_signatures_read on public.mechanical_handover_signatures;
drop policy if exists mechanical_handover_signatures_write on public.mechanical_handover_signatures;
drop policy if exists mechanical_handover_signatures_update on public.mechanical_handover_signatures;
create policy mechanical_handover_signatures_read on public.mechanical_handover_signatures for select to authenticated using(public.mechanical_market_allowed(market_code));
create policy mechanical_handover_signatures_write on public.mechanical_handover_signatures for insert to authenticated with check(public.mechanical_market_allowed(market_code) and updated_by=public.active_user_id());
create policy mechanical_handover_signatures_update on public.mechanical_handover_signatures for update to authenticated using(public.mechanical_market_allowed(market_code)) with check(public.mechanical_market_allowed(market_code) and updated_by=public.active_user_id());
drop policy if exists mechanical_handover_daily_approvals_read on public.mechanical_handover_daily_approvals;
drop policy if exists mechanical_handover_daily_approvals_write on public.mechanical_handover_daily_approvals;
create policy mechanical_handover_daily_approvals_read on public.mechanical_handover_daily_approvals for select to authenticated using(public.mechanical_market_allowed(market_code));
create policy mechanical_handover_daily_approvals_write on public.mechanical_handover_daily_approvals for insert to authenticated with check(public.mechanical_market_allowed(market_code) and approver_id=public.active_user_id() and public.can_approve_mechanical_handover() and work_date<(now() at time zone 'Asia/Taipei')::date);
drop policy if exists mechanical_transfer_read on public.mechanical_handover_transfers;
create policy mechanical_transfer_read on public.mechanical_handover_transfers for select to authenticated using(public.mechanical_market_allowed(market_code));

notify pgrst,'reload schema';
commit;
