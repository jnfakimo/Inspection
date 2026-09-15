begin;

-- 每班交班保存不可變快照；交班人與指定接班人各以自己的登入身分簽認。
create table if not exists public.mechanical_handover_transfers (
  transfer_id uuid primary key default gen_random_uuid(),
  handover_date date not null,
  shift_code text not null check (shift_code in ('01-09','09-17','17-01')),
  next_date date not null,
  next_shift text not null check (next_shift in ('01-09','09-17','17-01')),
  items jsonb not null check (jsonb_typeof(items)='array'),
  revision text not null,
  handed_by uuid not null references public.users(user_id),
  handed_name text not null,
  handed_at timestamptz not null default now(),
  receiver_id uuid not null references public.users(user_id),
  receiver_name text not null,
  received_by uuid references public.users(user_id),
  received_name text,
  received_at timestamptz,
  unique(handover_date,shift_code),
  unique(next_date,next_shift),
  check (handed_by<>receiver_id),
  check ((received_by is null and received_at is null and received_name is null)
    or (received_by=receiver_id and received_at is not null and received_name is not null))
);

-- 接班人必須是在職機電課、第二批發市場範圍內，且具有本子系統權限。
create or replace function public.mechanical_receiver_allowed(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select (r.role_id='sysadmin' or (
    coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_system_access where user_id=u.user_id and system_key='handover'),
      (select allowed from public.role_permissions where role_id=r.role_id and perm='sys_handover'),false)
    and coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_module_access where user_id=u.user_id and system_key='handover' and module_key='mechanical'),
      (select case mode when 'allow' then true when 'deny' then false end from public.role_module_access where role_id=r.role_id and system_key='handover' and module_key='mechanical'),true)
    ))
    from public.users u
    join public.departments d on d.dept_id=u.dept_id and d.name='機電課' and d.level=2 and d.status='active'
    join public.mechanical_staff_market_scopes ms on ms.user_id=u.user_id and ms.market_code='market_2' and ms.is_active
    cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else u.role end) as role_id) r
    where u.user_id=p_user and u.status='active'
      and lower(trim(coalesce(u.username,''))) not like 'deidentified-%'
      and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
      and trim(coalesce(u.name,'')) not like '已離職人員-%'),false)
$$;

create or replace function public.mechanical_handover_receivers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.active_user_id() is null or not coalesce(public.has_handover_module_access('mechanical'),false) then
    raise exception using errcode='42501',message='目前帳號未開放機電課交接簿';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,'department',u.department,'status',u.status) order by u.name),'[]'::jsonb)
    from public.users u where public.mechanical_receiver_allowed(u.user_id) and u.user_id<>public.active_user_id());
end $$;

alter table public.mechanical_handover_transfers enable row level security;
alter table public.mechanical_handover_transfers force row level security;
revoke all on public.mechanical_handover_transfers from anon,authenticated;
grant select on public.mechanical_handover_transfers to authenticated;
drop policy if exists mechanical_transfer_read on public.mechanical_handover_transfers;
create policy mechanical_transfer_read on public.mechanical_handover_transfers for select to authenticated
  using(public.has_handover_module_access('mechanical'));

create or replace function public.mechanical_shift_start(p_date date,p_shift text)
returns timestamptz language sql immutable set search_path='' as $$
  select (p_date+case p_shift when '01-09' then time '01:00' when '09-17' then time '09:00' when '17-01' then time '17:00' end) at time zone 'Asia/Taipei'
$$;

-- 未完成來源在下一班直接投影；建立續辦子紀錄後改由子紀錄接手，完成結果即停止往後續帶。
create or replace function public.mechanical_shift_items(p_date date,p_shift text)
returns jsonb language sql stable security definer set search_path='' as $$
  with target as (
    select (p_date-date '2000-01-01')::bigint*3+array_position(array['01-09','09-17','17-01'],p_shift)-1 as slot
  ), rows_with_slot as (
    select e.*, (e.work_date-date '2000-01-01')::bigint*3+array_position(array['01-09','09-17','17-01'],e.shift_code)-1 as slot
    from public.mechanical_handover_entries e where not e.is_deleted
  )
  select coalesce(jsonb_agg(to_jsonb(e)-'slot'||jsonb_build_object(
    'is_completed',e.result not in ('處理中','待料','待廠商','交下班續辦','無法處理'),
    'carried',e.slot<t.slot,
    'content_locked',exists(select 1 from public.mechanical_handover_transfers x where x.items @> jsonb_build_array(jsonb_build_object('entry_id',e.entry_id)))
  ) order by e.slot,e.sort_order,e.created_at,e.entry_id),'[]'::jsonb)
  from rows_with_slot e cross join target t
  where e.slot<=t.slot and (
    e.slot=t.slot or (
      e.result in ('處理中','待料','待廠商','交下班續辦','無法處理')
      and not exists(select 1 from rows_with_slot child where child.carry_source_id=e.entry_id and child.slot<=t.slot)
    )
  )
$$;

-- 與工作新增／修改、續辦和交班共用同一把交易鎖；已進入快照的內容不可回頭竄改。
create or replace function public.lock_mechanical_handover_after_transfer()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(609151600);
  if tg_op='INSERT' and exists(select 1 from public.mechanical_handover_transfers t
    where t.handover_date=new.work_date and t.shift_code=new.shift_code) then
    raise exception using errcode='23514',message='本班已交班，工作內容已鎖定';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.mechanical_handover_transfers t
    where t.items @> jsonb_build_array(jsonb_build_object('entry_id',old.entry_id))) then
    raise exception using errcode='23514',message='工作已列入交班快照，原始內容已鎖定；請由目前班別建立續辦紀錄';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_mechanical_handover_after_transfer on public.mechanical_handover_entries;
create trigger trg_lock_mechanical_handover_after_transfer before insert or update on public.mechanical_handover_entries
  for each row execute function public.lock_mechanical_handover_after_transfer();

create or replace function public.require_mechanical_reconciliation_before_approval()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select count(*) from public.mechanical_handover_transfers
      where handover_date=new.work_date and received_at is not null)<>3 then
    raise exception using errcode='23514',message='三個班別都必須完成交班與接班雙方勾稽後，才能進行每日簽核';
  end if;
  return new;
end $$;
drop trigger if exists trg_require_mechanical_reconciliation_before_approval on public.mechanical_handover_daily_approvals;
create trigger trg_require_mechanical_reconciliation_before_approval before insert on public.mechanical_handover_daily_approvals
  for each row execute function public.require_mechanical_reconciliation_before_approval();

create or replace function public.mechanical_handover_day(p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if public.active_user_id() is null or not coalesce(public.has_handover_module_access('mechanical'),false) then
    raise exception using errcode='42501',message='目前帳號未開放機電課交接簿';
  end if;
  if p_date is null then raise exception '請選擇交接日期'; end if;
  select jsonb_agg(jsonb_build_object('shift_code',s.code,'items',coalesce(t.items,public.mechanical_shift_items(p_date,s.code)),
    'revision',coalesce(t.revision,md5(public.mechanical_shift_items(p_date,s.code)::text)),
    'outgoing',to_jsonb(t),'incoming',to_jsonb(prev)) order by s.code) into result
  from (values('01-09'),('09-17'),('17-01')) s(code)
  left join public.mechanical_handover_transfers t on t.handover_date=p_date and t.shift_code=s.code
  left join public.mechanical_handover_transfers prev on prev.next_date=p_date and prev.next_shift=s.code;
  return result;
end $$;

create or replace function public.mechanical_handover_action(p_action text,p_date date,p_shift text,
  p_receiver uuid default null,p_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; receiver_name text;
  items jsonb; t public.mechanical_handover_transfers; prev public.mechanical_handover_transfers;
  target_date date; target_shift text;
begin
  if actor is null or not coalesce(public.has_handover_module_access('mechanical'),false) then
    raise exception using errcode='42501',message='目前帳號未開放機電課交接簿';
  end if;
  if p_date is null or p_shift is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.mechanical_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可交接'; end if;
  perform pg_advisory_xact_lock(609151600);
  select name into actor_name from public.users where user_id=actor;
  select * into t from public.mechanical_handover_transfers where handover_date=p_date and shift_code=p_shift;
  select * into prev from public.mechanical_handover_transfers where next_date=p_date and next_shift=p_shift;

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
    if prev.transfer_id is null and exists(select 1 from public.mechanical_handover_transfers where (handover_date,shift_code)<(p_date,p_shift)) then
      raise exception '上一班尚未交班，請先完成上一班交接，不能跳過班別勾稽';
    end if;
    if prev.transfer_id is not null and prev.received_at is null then raise exception '請先由指定接班人完成上一班的接班確認'; end if;
    if prev.transfer_id is not null and prev.received_by<>actor then raise exception using errcode='42501',message='本班須由已確認接班的人員送出交班'; end if;
    if p_receiver is null or p_receiver=actor then raise exception '請指定另一位人員接班，交班與接班不可為同一人'; end if;
    select name into receiver_name from public.users where user_id=p_receiver and public.mechanical_receiver_allowed(user_id);
    if receiver_name is null then raise exception '指定接班人必須是在職機電課、屬第二批發市場且具交接權限'; end if;
    items:=public.mechanical_shift_items(p_date,p_shift);
    if p_revision is distinct from md5(items::text) then raise exception '交接工作剛被修改，請重新載入並重新確認'; end if;
    target_date:=p_date+case when p_shift='17-01' then 1 else 0 end;
    target_shift:=case p_shift when '01-09' then '09-17' when '09-17' then '17-01' else '01-09' end;
    insert into public.mechanical_handover_transfers(handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
      values(p_date,p_shift,target_date,target_shift,items,p_revision,actor,actor_name,p_receiver,receiver_name) returning * into t;
    return to_jsonb(t);
  end if;
  raise exception '不支援的交接動作';
end $$;

revoke all on function public.mechanical_shift_start(date,text),public.mechanical_shift_items(date,text),public.lock_mechanical_handover_after_transfer(),public.require_mechanical_reconciliation_before_approval() from public,anon,authenticated;
revoke all on function public.mechanical_receiver_allowed(uuid),public.mechanical_handover_receivers() from public,anon,authenticated;
grant execute on function public.mechanical_handover_receivers() to authenticated;
revoke all on function public.mechanical_handover_day(date),public.mechanical_handover_action(text,date,text,uuid,text) from public,anon,authenticated;
grant execute on function public.mechanical_handover_day(date),public.mechanical_handover_action(text,date,text,uuid,text) to authenticated;
comment on table public.mechanical_handover_transfers is '機電課交班工作快照，以及交班人與指定接班人各自的伺服器簽認時間';

commit;
