begin;

-- 事項只有一份正本；完成紀錄與每班雙方點交另存，歷史簽章不受日後續辦影響。
create table if not exists public.business_handover_completions (
  entry_id uuid primary key references public.business_handover_entries(entry_id),
  completed_date date not null,
  completed_shift text not null check (completed_shift in ('01-09','09-17','17-01')),
  completed_by uuid not null references public.users(user_id),
  completed_name text not null,
  completed_at timestamptz not null default now()
);
create table if not exists public.business_handover_transfers (
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
  check (handed_by <> receiver_id),
  check ((received_by is null and received_at is null and received_name is null)
    or (received_by=receiver_id and received_at is not null and received_name is not null))
);
create index if not exists business_handover_completion_shift on public.business_handover_completions(completed_date,completed_shift);

-- 與 has_system_access / has_module_access 相同的四層規則，限定用於檢查指定接班人。
create or replace function public.business_receiver_allowed(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select r.role_id='sysadmin' or (
    coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_system_access where user_id=u.user_id and system_key='handover'),
      (select allowed from public.role_permissions where role_id=r.role_id and perm='sys_handover'),false)
    and coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_module_access where user_id=u.user_id and system_key='handover' and module_key='business'),
      (select case mode when 'allow' then true when 'deny' then false end from public.role_module_access where role_id=r.role_id and system_key='handover' and module_key='business'),true)
    ) from public.users u cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else u.role end) as role_id) r
    where u.user_id=p_user and u.status='active'
      and lower(trim(coalesce(u.username,''))) not like 'deidentified-%' and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
      and trim(coalesce(u.name,'')) not like '已離職人員-%'),false)
$$;

create or replace function public.business_handover_receivers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.active_user_id() is null or not coalesce(public.has_handover_module_access('business'),false) then
    raise exception using errcode='42501',message='目前帳號未開放業管組交接簿';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'name',name,'department',department,'status',status) order by name),'[]'::jsonb)
    from public.users where public.business_receiver_allowed(user_id) and user_id<>public.active_user_id());
end $$;

alter table public.business_handover_completions enable row level security;
alter table public.business_handover_completions force row level security;
alter table public.business_handover_transfers enable row level security;
alter table public.business_handover_transfers force row level security;
revoke all on public.business_handover_completions,public.business_handover_transfers from anon,authenticated;
grant select on public.business_handover_completions,public.business_handover_transfers to authenticated;
drop policy if exists business_completion_read on public.business_handover_completions;
create policy business_completion_read on public.business_handover_completions for select to authenticated
  using(public.has_handover_module_access('business'));
drop policy if exists business_transfer_read on public.business_handover_transfers;
create policy business_transfer_read on public.business_handover_transfers for select to authenticated
  using(public.has_handover_module_access('business'));

create or replace function public.business_shift_start(p_date date,p_shift text)
returns timestamptz language sql immutable set search_path='' as $$
  select (p_date + case p_shift when '01-09' then time '01:00' when '09-17' then time '09:00' when '17-01' then time '17:00' end) at time zone 'Asia/Taipei'
$$;

create or replace function public.business_shift_items(p_date date,p_shift text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
    'is_completed',c.entry_id is not null and (c.completed_date,c.completed_shift)<=(p_date,p_shift),
    'completed_by',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_by end,
    'completed_name',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_name end,
    'completed_at',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_at end,
    'carried', (e.handover_date,e.shift_code)<(p_date,p_shift),
    'content_locked',exists(select 1 from public.business_handover_transfers t where t.items @> jsonb_build_array(jsonb_build_object('entry_id',e.entry_id)))
  ) order by e.handover_date,e.shift_code,e.created_at,e.entry_id),'[]'::jsonb)
  from public.business_handover_entries e
  left join public.business_handover_completions c on c.entry_id=e.entry_id
  where (e.handover_date,e.shift_code)<=(p_date,p_shift)
    and position('【崗位勤務點檢紀錄】' in e.description)=0
    and ((e.handover_date,e.shift_code)=(p_date,p_shift) or not e.is_deleted)
    and (c.entry_id is null or (c.completed_date,c.completed_shift)>=(p_date,p_shift))
$$;

-- 同一交易鎖序列化新增／修改、完成及交班，避免簽章快照漏掉同時寫入的事項。
create or replace function public.lock_business_handover_entry()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(609151200);
  if position('【崗位勤務點檢紀錄】' in new.description)>0
    and (tg_op='INSERT' or position('【崗位勤務點檢紀錄】' in old.description)>0) then return new; end if;
  if exists(select 1 from public.business_handover_transfers t
      where (t.handover_date,t.shift_code)>=(new.handover_date,new.shift_code))
    or exists(select 1 from public.business_handover_completions c where c.entry_id=new.entry_id) then
    raise exception using errcode='23514',message='事項已交班或完成，原始內容已鎖定；請在目前班別新增補充事項';
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_business_handover_entry on public.business_handover_entries;
create trigger trg_lock_business_handover_entry before insert or update on public.business_handover_entries
  for each row execute function public.lock_business_handover_entry();

create or replace function public.business_handover_day(p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if public.active_user_id() is null or not coalesce(public.has_handover_module_access('business'),false) then
    raise exception using errcode='42501',message='目前帳號未開放業管組交接簿';
  end if;
  if p_date is null then raise exception '請選擇交接日期'; end if;
  select jsonb_agg(jsonb_build_object('shift_code',s.code,'items',coalesce(t.items,public.business_shift_items(p_date,s.code)),
    'revision',coalesce(t.revision,md5(public.business_shift_items(p_date,s.code)::text)),
    'outgoing',to_jsonb(t),'incoming',to_jsonb(prev)) order by s.code) into result
  from (values('01-09'),('09-17'),('17-01')) s(code)
  left join public.business_handover_transfers t on t.handover_date=p_date and t.shift_code=s.code
  left join public.business_handover_transfers prev on prev.next_date=p_date and prev.next_shift=s.code;
  return result;
end $$;

create or replace function public.business_handover_action(p_action text,p_date date,p_shift text,
  p_entry uuid default null,p_receiver uuid default null,p_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; receiver_name text;
  items jsonb; t public.business_handover_transfers; prev public.business_handover_transfers;
  target_date date; target_shift text; e public.business_handover_entries;
  taipei timestamp:=now() at time zone 'Asia/Taipei'; current_date_tw date; current_shift text;
begin
  if actor is null or not coalesce(public.has_handover_module_access('business'),false) then
    raise exception using errcode='42501',message='目前帳號未開放業管組交接簿';
  end if;
  if p_date is null or p_shift is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.business_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可交接或完成事項'; end if;
  perform pg_advisory_xact_lock(609151200);
  select name into actor_name from public.users where user_id=actor;
  select * into t from public.business_handover_transfers where handover_date=p_date and shift_code=p_shift;
  select * into prev from public.business_handover_transfers where next_date=p_date and next_shift=p_shift;

  if p_action='receive' then
    if prev.transfer_id is null then raise exception '上一班尚未送出交班，無法確認接班'; end if;
    if prev.receiver_id<>actor then raise exception using errcode='42501',message='僅指定接班人本人可確認接班'; end if;
    if p_revision is distinct from prev.revision then raise exception '交班內容已變更，請重新載入後確認'; end if;
    if prev.received_at is not null then return to_jsonb(prev); end if;
    update public.business_handover_transfers set received_by=actor,received_name=actor_name,received_at=now()
      where transfer_id=prev.transfer_id returning * into prev;
    return to_jsonb(prev);
  end if;

  if p_action='submit' then
    if t.transfer_id is not null then raise exception '本班已交班，不可重複送出'; end if;
    if prev.transfer_id is null and exists(select 1 from public.business_handover_transfers
      where (handover_date,shift_code)<(p_date,p_shift)) then
      raise exception '上一班尚未交班，請先完成上一班交接，不能跳過班別勾稽';
    end if;
    if prev.transfer_id is not null and prev.received_at is null then raise exception '請先由指定接班人完成上一班的接班確認'; end if;
    if prev.transfer_id is not null and prev.received_by<>actor then raise exception using errcode='42501',message='本班須由已確認接班的人員送出交班'; end if;
    if p_receiver is null or p_receiver=actor then raise exception '請指定另一位人員接班，交班與接班不可為同一人'; end if;
    select name into receiver_name from public.users where user_id=p_receiver and public.business_receiver_allowed(user_id);
    if receiver_name is null then raise exception '指定接班人必須是在職且具業管組交接權限的人員'; end if;
    items:=public.business_shift_items(p_date,p_shift);
    if p_revision is distinct from md5(items::text) then raise exception '交接事項剛被修改，請重新載入並重新確認'; end if;
    target_date:=p_date+case when p_shift='17-01' then 1 else 0 end;
    target_shift:=case p_shift when '01-09' then '09-17' when '09-17' then '17-01' else '01-09' end;
    insert into public.business_handover_transfers(handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
      values(p_date,p_shift,target_date,target_shift,items,p_revision,actor,actor_name,p_receiver,receiver_name) returning * into t;
    return to_jsonb(t);
  end if;

  if p_action='complete' then
    current_date_tw:=taipei::date-case when taipei::time<time '01:00' then 1 else 0 end;
    current_shift:=case when taipei::time<time '01:00' or taipei::time>=time '17:00' then '17-01' when taipei::time<time '09:00' then '01-09' else '09-17' end;
    if (p_date,p_shift)<>(current_date_tw,current_shift) then raise exception '請在目前當班紀錄完成事項，不可回填其他班別'; end if;
    if t.transfer_id is not null then raise exception '本班已交班，請由下一班接續處理'; end if;
    if prev.transfer_id is null and exists(select 1 from public.business_handover_transfers
      where (handover_date,shift_code)<(p_date,p_shift)) then
      raise exception '上一班尚未交班，請先完成接班確認再登記完成';
    end if;
    if prev.transfer_id is not null and (prev.received_at is null or prev.received_by<>actor) then
      raise exception '請由本班指定接班人先確認接班，再登記完成';
    end if;
    select * into e from public.business_handover_entries where entry_id=p_entry;
    if e.entry_id is null or e.is_deleted or position('【崗位勤務點檢紀錄】' in e.description)>0
      or (e.handover_date,e.shift_code)>(p_date,p_shift) then raise exception '找不到本班可完成的交接事項'; end if;
    if exists(select 1 from public.business_handover_completions where entry_id=p_entry) then
      return (select to_jsonb(c) from public.business_handover_completions c where entry_id=p_entry);
    end if;
    insert into public.business_handover_completions(entry_id,completed_date,completed_shift,completed_by,completed_name)
      values(p_entry,p_date,p_shift,actor,actor_name);
    return (select to_jsonb(c) from public.business_handover_completions c where entry_id=p_entry);
  end if;
  raise exception '不支援的交接動作';
end $$;

revoke all on function public.business_shift_start(date,text),public.business_shift_items(date,text),public.lock_business_handover_entry() from public,anon,authenticated;
revoke all on function public.business_receiver_allowed(uuid) from public,anon,authenticated;
revoke all on function public.business_handover_receivers() from public,anon,authenticated;
grant execute on function public.business_handover_receivers() to authenticated;
revoke all on function public.business_handover_day(date),public.business_handover_action(text,date,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.business_handover_day(date),public.business_handover_action(text,date,text,uuid,uuid,text) to authenticated;
comment on table public.business_handover_transfers is '業管組交班內容快照與交班／指定接班人雙方的伺服器簽認時間';
comment on table public.business_handover_completions is '業管組事項完成紀錄；未完成事項依來源班別持續續帶，完成班別後停止';

commit;
