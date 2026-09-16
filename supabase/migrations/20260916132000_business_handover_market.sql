begin;

-- 業管組交接簿以組織樹的 MKT1-ADMIN／MKT2-ADMIN 歸屬分市場；既有資料由前一支
-- foundation migration 保留為一市場。本 migration 只擴充鍵值，不刪除歷史資料。
do $$ declare c record; begin
  for c in select conname from pg_constraint
    where conrelid='public.business_handover_transfers'::regclass and contype='u'
      and pg_get_constraintdef(oid) in ('UNIQUE (handover_date, shift_code)','UNIQUE (next_date, next_shift)')
  loop execute format('alter table public.business_handover_transfers drop constraint %I',c.conname); end loop;
  if exists(select 1 from pg_constraint where conrelid='public.business_handover_approvals'::regclass and conname='uq_business_handover_approval_stage') then
    alter table public.business_handover_approvals drop constraint uq_business_handover_approval_stage;
  end if;
end $$;
create unique index if not exists business_transfer_market_outgoing on public.business_handover_transfers(market_code,handover_date,shift_code);
create unique index if not exists business_transfer_market_incoming on public.business_handover_transfers(market_code,next_date,next_shift);
create unique index if not exists business_approval_market_stage on public.business_handover_approvals(market_code,handover_date,stage);

create or replace function public.business_market_allowed(p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_market in ('market_1','market_2') and coalesce(public.active_rbac_role()='sysadmin'
    or exists(select 1 from jsonb_array_elements_text(public.handover_staff_markets(public.active_user_id(),'business')) m(value) where m.value=p_market),false)
$$;

create or replace function public.business_market_receiver_allowed(p_user uuid,p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.business_receiver_allowed(p_user)
    and public.handover_staff_market(p_user,'business')=p_market
$$;

create or replace function public.business_market_receivers(p_market text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.business_market_allowed(p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的業管組交接簿';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,'department',u.department,'status',u.status) order by u.name),'[]'::jsonb)
    from public.users u where public.business_market_receiver_allowed(u.user_id,p_market)
      and u.user_id<>public.active_user_id());
end $$;

create or replace function public.business_market_shift_items(p_market text,p_date date,p_shift text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
    'is_completed',c.entry_id is not null and (c.completed_date,c.completed_shift)<=(p_date,p_shift),
    'completed_by',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_by end,
    'completed_name',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_name end,
    'completed_at',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_at end,
    'carried',(e.handover_date,e.shift_code)<(p_date,p_shift),
    'content_locked',exists(select 1 from public.business_handover_transfers t where t.market_code=p_market and t.items @> jsonb_build_array(jsonb_build_object('entry_id',e.entry_id)))
  ) order by e.handover_date,e.shift_code,e.created_at,e.entry_id),'[]'::jsonb)
  from public.business_handover_entries e
  left join public.business_handover_completions c on c.entry_id=e.entry_id
  where e.market_code=p_market and (e.handover_date,e.shift_code)<=(p_date,p_shift)
    and position('【崗位勤務點檢紀錄】' in e.description)=0
    and ((e.handover_date,e.shift_code)=(p_date,p_shift) or not e.is_deleted)
    and (c.entry_id is null or (c.completed_date,c.completed_shift)>=(p_date,p_shift))
$$;

create or replace function public.lock_business_handover_entry()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(6091613,hashtext(new.market_code));
  if tg_op='UPDATE' and new.market_code is distinct from old.market_code then
    raise exception using errcode='23514',message='交接紀錄的市場歸屬不可變更';
  end if;
  if position('【崗位勤務點檢紀錄】' in new.description)>0
    and (tg_op='INSERT' or position('【崗位勤務點檢紀錄】' in old.description)>0) then return new; end if;
  if exists(select 1 from public.business_handover_transfers t where t.market_code=new.market_code
      and (t.handover_date,t.shift_code)>=(new.handover_date,new.shift_code))
    or exists(select 1 from public.business_handover_completions c where c.entry_id=new.entry_id) then
    raise exception using errcode='23514',message='事項已交班或完成，原始內容已鎖定；請在目前班別新增補充事項';
  end if;
  return new;
end $$;

create or replace function public.business_market_day(p_market text,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.business_market_allowed(p_market) then raise exception using errcode='42501',message='目前帳號未開放所選市場的業管組交接簿'; end if;
  if p_date is null then raise exception '請選擇交接日期'; end if;
  select jsonb_agg(jsonb_build_object('shift_code',s.code,
    'items',coalesce(t.items,public.business_market_shift_items(p_market,p_date,s.code)),
    'revision',coalesce(t.revision,md5(public.business_market_shift_items(p_market,p_date,s.code)::text)),
    'outgoing',to_jsonb(t),'incoming',to_jsonb(prev)) order by s.code) into result
  from (values('01-09'),('09-17'),('17-01')) s(code)
  left join public.business_handover_transfers t on t.market_code=p_market and t.handover_date=p_date and t.shift_code=s.code
  left join public.business_handover_transfers prev on prev.market_code=p_market and prev.next_date=p_date and prev.next_shift=s.code;
  return result;
end $$;

create or replace function public.business_market_action(p_market text,p_action text,p_date date,p_shift text,
  p_entry uuid default null,p_receiver uuid default null,p_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; receiver_name text;
  items jsonb; t public.business_handover_transfers; prev public.business_handover_transfers;
  target_date date; target_shift text; e public.business_handover_entries;
  taipei timestamp:=now() at time zone 'Asia/Taipei'; current_date_tw date; current_shift text;
begin
  if actor is null or not public.business_market_allowed(p_market) then raise exception using errcode='42501',message='目前帳號未開放所選市場的業管組交接簿'; end if;
  if p_date is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.business_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可交接或完成事項'; end if;
  perform pg_advisory_xact_lock(6091613,hashtext(p_market));
  select name into actor_name from public.users where user_id=actor;
  select * into t from public.business_handover_transfers where market_code=p_market and handover_date=p_date and shift_code=p_shift;
  select * into prev from public.business_handover_transfers where market_code=p_market and next_date=p_date and next_shift=p_shift;
  if p_action='receive' then
    if prev.transfer_id is null then raise exception '上一班尚未送出交班，無法確認接班'; end if;
    if prev.receiver_id<>actor then raise exception using errcode='42501',message='僅指定接班人本人可確認接班'; end if;
    if p_revision is distinct from prev.revision then raise exception '交班內容已變更，請重新載入後確認'; end if;
    if prev.received_at is not null then return to_jsonb(prev); end if;
    update public.business_handover_transfers set received_by=actor,received_name=actor_name,received_at=now()
      where transfer_id=prev.transfer_id and market_code=p_market returning * into prev;
    return to_jsonb(prev);
  elsif p_action='submit' then
    if t.transfer_id is not null then raise exception '本班已交班，不可重複送出'; end if;
    if prev.transfer_id is null and exists(select 1 from public.business_handover_transfers where market_code=p_market and (handover_date,shift_code)<(p_date,p_shift)) then raise exception '上一班尚未交班，請先完成上一班交接，不能跳過班別勾稽'; end if;
    if prev.transfer_id is not null and prev.received_at is null then raise exception '請先由指定接班人完成上一班的接班確認'; end if;
    if prev.transfer_id is not null and prev.received_by<>actor then raise exception using errcode='42501',message='本班須由已確認接班的人員送出交班'; end if;
    if p_receiver is null or p_receiver=actor then raise exception '請指定另一位人員接班，交班與接班不可為同一人'; end if;
    select name into receiver_name from public.users where user_id=p_receiver and public.business_market_receiver_allowed(user_id,p_market);
    if receiver_name is null then raise exception '指定接班人必須是同一市場、在職且具業管組交接權限的人員'; end if;
    items:=public.business_market_shift_items(p_market,p_date,p_shift);
    if p_revision is distinct from md5(items::text) then raise exception '交接事項剛被修改，請重新載入並重新確認'; end if;
    target_date:=p_date+case when p_shift='17-01' then 1 else 0 end;
    target_shift:=case p_shift when '01-09' then '09-17' when '09-17' then '17-01' else '01-09' end;
    insert into public.business_handover_transfers(market_code,handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
      values(p_market,p_date,p_shift,target_date,target_shift,items,p_revision,actor,actor_name,p_receiver,receiver_name) returning * into t;
    return to_jsonb(t);
  elsif p_action='complete' then
    current_date_tw:=taipei::date-case when taipei::time<time '01:00' then 1 else 0 end;
    current_shift:=case when taipei::time<time '01:00' or taipei::time>=time '17:00' then '17-01' when taipei::time<time '09:00' then '01-09' else '09-17' end;
    if (p_date,p_shift)<>(current_date_tw,current_shift) then raise exception '請在目前當班紀錄完成事項，不可回填其他班別'; end if;
    if t.transfer_id is not null then raise exception '本班已交班，請由下一班接續處理'; end if;
    if prev.transfer_id is null and exists(select 1 from public.business_handover_transfers where market_code=p_market and (handover_date,shift_code)<(p_date,p_shift)) then raise exception '上一班尚未交班，請先完成接班確認再登記完成'; end if;
    if prev.transfer_id is not null and (prev.received_at is null or prev.received_by<>actor) then raise exception '請由本班指定接班人先確認接班，再登記完成'; end if;
    select * into e from public.business_handover_entries where entry_id=p_entry and market_code=p_market;
    if e.entry_id is null or e.is_deleted or position('【崗位勤務點檢紀錄】' in e.description)>0 or (e.handover_date,e.shift_code)>(p_date,p_shift) then raise exception '找不到本班可完成的交接事項'; end if;
    if exists(select 1 from public.business_handover_completions where entry_id=p_entry) then return (select to_jsonb(c) from public.business_handover_completions c where entry_id=p_entry); end if;
    insert into public.business_handover_completions(entry_id,completed_date,completed_shift,completed_by,completed_name) values(p_entry,p_date,p_shift,actor,actor_name);
    return (select to_jsonb(c) from public.business_handover_completions c where entry_id=p_entry);
  end if;
  raise exception '不支援的交接動作';
end $$;

-- 主任依所屬市場；副理與經理依 users.supervisor_id 的組織鍊逐層勾稽。
create or replace function public.business_market_approval_allowed(p_user uuid,p_market text,p_stage text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select
    r.role_id='sysadmin' or (r.role_id='unit_supervisor' and public.business_receiver_allowed(u.user_id) and case p_stage
      when 'director' then public.handover_staff_market(u.user_id,'business')=p_market
      when 'deputy_manager' then exists(select 1 from public.users d where d.supervisor_id=u.user_id and d.status='active'
        and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
        and public.handover_staff_market(d.user_id,'business')=p_market)
      when 'manager' then exists(select 1 from public.users d join public.users dp on dp.user_id=d.supervisor_id
        where dp.supervisor_id=u.user_id and d.status='active' and dp.status='active'
          and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
          and public.handover_staff_market(d.user_id,'business')=p_market)
      else false end)
    from public.users u cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end) role_id) r
    where u.user_id=p_user and u.status='active'),false)
$$;

create or replace function public.business_market_can_approve(p_market text,p_stage text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.business_market_approval_allowed(public.active_user_id(),p_market,p_stage)
$$;

drop policy if exists business_handover_entries_read on public.business_handover_entries;
drop policy if exists business_handover_entries_insert on public.business_handover_entries;
drop policy if exists business_handover_entries_update on public.business_handover_entries;
create policy business_handover_entries_read on public.business_handover_entries for select to authenticated using(public.business_market_allowed(market_code));
create policy business_handover_entries_insert on public.business_handover_entries for insert to authenticated with check(public.business_market_allowed(market_code) and created_by=public.active_user_id());
create policy business_handover_entries_update on public.business_handover_entries for update to authenticated using(public.business_market_allowed(market_code)) with check(public.business_market_allowed(market_code) and updated_by=public.active_user_id());
drop policy if exists business_transfer_read on public.business_handover_transfers;
create policy business_transfer_read on public.business_handover_transfers for select to authenticated using(public.business_market_allowed(market_code));
drop policy if exists business_completion_read on public.business_handover_completions;
create policy business_completion_read on public.business_handover_completions for select to authenticated using(exists(select 1 from public.business_handover_entries e where e.entry_id=business_handover_completions.entry_id and public.business_market_allowed(e.market_code)));
drop policy if exists business_handover_approvals_read on public.business_handover_approvals;
drop policy if exists business_handover_approvals_insert on public.business_handover_approvals;
drop policy if exists business_handover_approvals_update on public.business_handover_approvals;
create policy business_handover_approvals_read on public.business_handover_approvals for select to authenticated using(public.business_market_allowed(market_code));
create policy business_handover_approvals_insert on public.business_handover_approvals for insert to authenticated with check(approver_id=public.active_user_id() and public.business_market_approval_allowed(approver_id,market_code,stage));
create policy business_handover_approvals_update on public.business_handover_approvals for update to authenticated using(public.business_market_allowed(market_code)) with check(approver_id=public.active_user_id() and public.business_market_approval_allowed(approver_id,market_code,stage));

revoke all on function public.business_market_allowed(text),public.business_market_receiver_allowed(uuid,text),public.business_market_shift_items(text,date,text),public.business_market_approval_allowed(uuid,text,text) from public,anon,authenticated;
revoke all on function public.business_market_can_approve(text,text) from public,anon,authenticated;
revoke all on function public.business_market_receivers(text),public.business_market_day(text,date),public.business_market_action(text,text,date,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.business_market_receivers(text),public.business_market_day(text,date),public.business_market_action(text,text,date,text,uuid,uuid,text) to authenticated;
grant execute on function public.business_market_can_approve(text,text) to authenticated;

commit;
