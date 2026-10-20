-- 水果組電子交接簿（SYS-04 子系統 fruit）：值勤紀錄、班次交接、三階批核。
-- 表與函式以 group_code 區分組別（fruit／vegetable），蔬菜組日後只需在 produce_group_enabled 開啟並補子系統入口。
--
-- 規則（使用者 2026-10-21 決定）：
--  1. 三班沿用業管組：早班 01-09、中班 09-17、晚班 17-01；現場移交事項為自由文字。
--  2. 目前只啟用一市場（market_1）水果組；二市場資料表與畫面已備，待二市場人員與主管鏈定義後再啟用。
--  3. 批核三階：組(副)長 → 市場副主任 → 市場主任。副主任與主任沿用業管組同一市場的同一批人
--     （直接呼叫 business_market_approval_allowed），不另設一套；組(副)長為水果組內的 unit_supervisor。
--     可於交接日當日或之後任何一天批核，後一階須在前一階批核之後；系統管理員可批核任一階。
--  4. 不實體刪除：事項刪除為 is_deleted 標記；交班、完成、批核紀錄不可刪改。
--  5. 子系統預設拒絕（role_module_access deny），須在權限頁明確對組員、組(副)長、副主任、主任設為「允許」。
-- 業管組的資料表、函式與其鎖檔雜湊檔案完全不動。
begin;

-- 舊版個人交接子系統清單的檢查條件加入 fruit；任何名稱的舊檢查一併換掉，避免新鍵被擋下。
do $$
declare c record;
begin
  if to_regclass('public.user_handover_module_access') is not null then
    for c in select conname from pg_constraint
      where conrelid='public.user_handover_module_access'::regclass and contype='c'
        and pg_get_constraintdef(oid) like '%mechanical-schedule%' loop
      execute format('alter table public.user_handover_module_access drop constraint %I',c.conname);
    end loop;
    alter table public.user_handover_module_access add constraint user_handover_module_key_check
      check(module_key in ('records','mechanical','business','guard','guard-approve','open-items','equipment','mechanical-schedule','fruit'));
  end if;
end $$;

create table if not exists public.produce_handover_entries (
  entry_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  handover_date date not null,
  shift_code text not null check (shift_code in ('01-09','09-17','17-01')),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  created_by uuid not null references public.users(user_id),
  created_name text not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_by uuid references public.users(user_id),
  deleted_at timestamptz
);
create index if not exists produce_entries_group_date on public.produce_handover_entries(group_code,market_code,handover_date desc,shift_code);

-- 事項只有一份正本；完成紀錄另存，歷史簽認不受日後續辦影響。
create table if not exists public.produce_handover_completions (
  entry_id uuid primary key references public.produce_handover_entries(entry_id),
  completed_date date not null,
  completed_shift text not null check (completed_shift in ('01-09','09-17','17-01')),
  completed_by uuid not null references public.users(user_id),
  completed_name text not null,
  completed_at timestamptz not null default now()
);

create table if not exists public.produce_handover_transfers (
  transfer_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
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
  check (handed_by <> receiver_id),
  check ((received_by is null and received_at is null and received_name is null)
    or (received_by=receiver_id and received_at is not null and received_name is not null))
);
create unique index if not exists produce_transfer_outgoing on public.produce_handover_transfers(group_code,market_code,handover_date,shift_code);
create unique index if not exists produce_transfer_incoming on public.produce_handover_transfers(group_code,market_code,next_date,next_shift);

create table if not exists public.produce_handover_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  handover_date date not null,
  stage text not null check (stage in ('group_leader','deputy_director','director')),
  stage_label text not null,
  approver_id uuid not null references public.users(user_id),
  approver_name text not null,
  approved_at timestamptz not null default now(),
  note text check (note is null or char_length(note)<=500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists produce_approval_stage on public.produce_handover_approvals(group_code,market_code,handover_date,stage);

/* ───────────── 基礎判斷（不開放給前端直接呼叫） ───────────── */

-- 目前只開放一市場水果組；蔬菜組與二市場要啟用時，只改這一支。
create or replace function public.produce_group_enabled(p_group text,p_market text)
returns boolean language sql immutable set search_path='' as $$
  select p_group='fruit' and p_market='market_1'
$$;

create or replace function public.produce_module_key(p_group text)
returns text language sql immutable set search_path='' as $$
  select case p_group when 'fruit' then 'fruit' when 'vegetable' then 'vegetable' end
$$;

create or replace function public.produce_shift_start(p_date date,p_shift text)
returns timestamptz language sql immutable set search_path='' as $$
  select (p_date + case p_shift when '01-09' then time '01:00' when '09-17' then time '09:00' when '17-01' then time '17:00' end) at time zone 'Asia/Taipei'
$$;

-- 組織樹是市場歸屬正本：人員必須在 MKT1／MKT2 底下對應的組（水果組 -FRUIT、蔬菜組 -VEG）。
create or replace function public.produce_staff_market(p_user uuid,p_group text)
returns text language sql stable security definer set search_path='' as $$
  select case parent.code when 'MKT1' then 'market_1' when 'MKT2' then 'market_2' end
  from public.users u
  join public.departments child on child.dept_id=u.dept_id and child.status='active'
  join public.departments parent on parent.dept_id=child.parent_id and parent.status='active'
  where u.user_id=p_user and u.status='active'
    and lower(trim(coalesce(u.username,''))) not like 'deidentified-%'
    and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
    and trim(coalesce(u.name,'')) not like '已離職人員-%'
    and parent.code in ('MKT1','MKT2')
    and child.code=parent.code||case p_group when 'fruit' then '-FRUIT' when 'vegetable' then '-VEG' end
  limit 1
$$;

-- 與 has_system_access／has_module_access 相同的四層規則，用於檢查指定使用者（接班人、批核人）。
create or replace function public.produce_user_allowed(p_user uuid,p_group text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select r.role_id='sysadmin' or (
    coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_system_access where user_id=u.user_id and system_key='handover'),
      (select allowed from public.role_permissions where role_id=r.role_id and perm='sys_handover'),false)
    and coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_module_access where user_id=u.user_id and system_key='handover' and module_key=public.produce_module_key(p_group)),
      (select case mode when 'allow' then true when 'deny' then false end from public.role_module_access where role_id=r.role_id and system_key='handover' and module_key=public.produce_module_key(p_group)),true)
    ) from public.users u cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else u.role end) as role_id) r
    where u.user_id=p_user and u.status='active'
      and lower(trim(coalesce(u.username,''))) not like 'deidentified-%' and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
      and trim(coalesce(u.name,'')) not like '已離職人員-%'),false)
$$;

-- 批核資格：組(副)長＝水果組內的單位主管；副主任、主任＝業管組同一市場的同一批人；sysadmin 可批任一階。
create or replace function public.produce_approval_allowed(p_user uuid,p_group text,p_market text,p_stage text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select
    public.produce_group_enabled(p_group,p_market) and p_stage in ('group_leader','deputy_director','director') and (
      r.role_id='sysadmin' or (r.role_id='unit_supervisor' and public.produce_user_allowed(u.user_id,p_group) and case p_stage
        when 'group_leader' then public.produce_staff_market(u.user_id,p_group)=p_market
        else public.business_market_approval_allowed(u.user_id,p_market,p_stage) end))
    from public.users u cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end) as role_id) r
    where u.user_id=p_user and u.status='active'),false)
$$;

-- 目前登入者能否使用該組別的該市場：組內人員、能批副主任／主任階段的主管、系統管理員。
-- RLS 規則以查詢者身分呼叫，必須授權給 authenticated（只回答「目前使用者」，不外洩他人資訊）。
create or replace function public.produce_market_allowed(p_group text,p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.produce_group_enabled(p_group,p_market)
    and public.has_handover_module_access(public.produce_module_key(p_group))
    and (public.active_rbac_role()='sysadmin'
      or public.produce_staff_market(public.active_user_id(),p_group)=p_market
      or public.produce_approval_allowed(public.active_user_id(),p_group,p_market,'deputy_director')
      or public.produce_approval_allowed(public.active_user_id(),p_group,p_market,'director')),false)
$$;

create or replace function public.produce_receiver_allowed(p_user uuid,p_group text,p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.produce_user_allowed(p_user,p_group) and public.produce_staff_market(p_user,p_group)=p_market
$$;

-- 某班要顯示與交班的事項：本班新增＋前面各班未完成而續帶的事項。
create or replace function public.produce_shift_items(p_group text,p_market text,p_date date,p_shift text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
    'is_completed',c.entry_id is not null and (c.completed_date,c.completed_shift)<=(p_date,p_shift),
    'completed_by',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_by end,
    'completed_name',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_name end,
    'completed_at',case when (c.completed_date,c.completed_shift)<=(p_date,p_shift) then c.completed_at end,
    'carried',(e.handover_date,e.shift_code)<(p_date,p_shift),
    'content_locked',exists(select 1 from public.produce_handover_transfers t where t.group_code=p_group and t.market_code=p_market
      and t.items @> jsonb_build_array(jsonb_build_object('entry_id',e.entry_id)))
  ) order by e.handover_date,e.shift_code,e.created_at,e.entry_id),'[]'::jsonb)
  from public.produce_handover_entries e
  left join public.produce_handover_completions c on c.entry_id=e.entry_id
  where e.group_code=p_group and e.market_code=p_market and (e.handover_date,e.shift_code)<=(p_date,p_shift)
    and ((e.handover_date,e.shift_code)=(p_date,p_shift) or not e.is_deleted)
    and (c.entry_id is null or (c.completed_date,c.completed_shift)>=(p_date,p_shift))
$$;

-- 同一交易鎖序列化新增／修改、完成及交班，避免簽認快照漏掉同時寫入的事項。
create or replace function public.produce_lock_entry()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(6091621,hashtext(new.group_code||new.market_code));
  if tg_op='UPDATE' and (new.group_code is distinct from old.group_code or new.market_code is distinct from old.market_code) then
    raise exception using errcode='23514',message='交接紀錄的組別與市場歸屬不可變更';
  end if;
  if exists(select 1 from public.produce_handover_transfers t where t.group_code=new.group_code and t.market_code=new.market_code
      and (t.handover_date,t.shift_code)>=(new.handover_date,new.shift_code))
    or (tg_op='UPDATE' and exists(select 1 from public.produce_handover_completions c where c.entry_id=new.entry_id)) then
    raise exception using errcode='23514',message='事項已交班或完成，原始內容已鎖定；請在目前班別新增補充事項';
  end if;
  return new;
end $$;
drop trigger if exists trg_produce_lock_entry on public.produce_handover_entries;
create trigger trg_produce_lock_entry before insert or update on public.produce_handover_entries
  for each row execute function public.produce_lock_entry();

-- 批核關卡：副主任須在組(副)長之後、主任須在副主任之後（同組別、市場、交接日）。
create or replace function public.produce_approval_gate()
returns trigger language plpgsql security definer set search_path='' as $$
declare need text;
begin
  need:=case new.stage when 'deputy_director' then 'group_leader' when 'director' then 'deputy_director' end;
  if need is not null and not exists(select 1 from public.produce_handover_approvals a
      where a.group_code=new.group_code and a.market_code=new.market_code and a.handover_date=new.handover_date and a.stage=need) then
    raise exception '請先由%批核，%才能批核',
      case need when 'group_leader' then '組(副)長' else '市場副主任' end,
      case new.stage when 'deputy_director' then '市場副主任' else '市場主任' end
      using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_produce_approval_gate on public.produce_handover_approvals;
create trigger trg_produce_approval_gate before insert on public.produce_handover_approvals
  for each row execute function public.produce_approval_gate();

-- 批核紀錄不可刪除；只能由原批核人更新說明，批核人與時間不可改。
create or replace function public.produce_protect_approval()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='批核紀錄不可刪除'; end if;
  if new.group_code is distinct from old.group_code or new.market_code is distinct from old.market_code
    or new.handover_date is distinct from old.handover_date or new.stage is distinct from old.stage
    or new.approver_id is distinct from old.approver_id or new.approved_at is distinct from old.approved_at then
    raise exception using errcode='23514',message='批核紀錄的批核人、階段與時間不可變更';
  end if;
  return new;
end $$;
drop trigger if exists trg_produce_protect_approval on public.produce_handover_approvals;
create trigger trg_produce_protect_approval before update or delete on public.produce_handover_approvals
  for each row execute function public.produce_protect_approval();

/* ───────────── 前端呼叫的 RPC ───────────── */

create or replace function public.produce_receivers(p_group text,p_market text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,'department',u.department,'status',u.status) order by u.name),'[]'::jsonb)
    from public.users u where public.produce_receiver_allowed(u.user_id,p_group,p_market) and u.user_id<>public.active_user_id());
end $$;

-- 一天的完整內容：三班（事項、修訂碼、交班與接班簽認）、各階批核紀錄與目前登入者可批核的階段。
create or replace function public.produce_day(p_group text,p_market text,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id();
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_date is null then raise exception '請選擇交接日期'; end if;
  return jsonb_build_object(
    'shifts',(select jsonb_agg(jsonb_build_object('shift_code',s.code,
        'items',coalesce(t.items,public.produce_shift_items(p_group,p_market,p_date,s.code)),
        'revision',coalesce(t.revision,md5(public.produce_shift_items(p_group,p_market,p_date,s.code)::text)),
        'outgoing',to_jsonb(t),'incoming',to_jsonb(prev)) order by s.code)
      from (values('01-09'),('09-17'),('17-01')) s(code)
      left join public.produce_handover_transfers t on t.group_code=p_group and t.market_code=p_market and t.handover_date=p_date and t.shift_code=s.code
      left join public.produce_handover_transfers prev on prev.group_code=p_group and prev.market_code=p_market and prev.next_date=p_date and prev.next_shift=s.code),
    'approvals',(select coalesce(jsonb_agg(to_jsonb(a) order by a.approved_at),'[]'::jsonb)
      from public.produce_handover_approvals a where a.group_code=p_group and a.market_code=p_market and a.handover_date=p_date),
    'can',jsonb_build_object(
      'group_leader',public.produce_approval_allowed(actor,p_group,p_market,'group_leader'),
      'deputy_director',public.produce_approval_allowed(actor,p_group,p_market,'deputy_director'),
      'director',public.produce_approval_allowed(actor,p_group,p_market,'director')));
end $$;

-- 新增、修改、刪除（標記）本班事項。已交班或已完成的事項由 produce_lock_entry 擋下。
create or replace function public.produce_entry_save(p_group text,p_market text,p_date date,p_shift text,
  p_entry uuid default null,p_description text default null,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; e public.produce_handover_entries; text_value text:=btrim(coalesce(p_description,''));
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_date is null or p_shift is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.produce_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可記載交接事項'; end if;
  if not coalesce(p_delete,false) and char_length(text_value) not between 1 and 2000 then raise exception '請填寫交接事項（至多 2000 字）'; end if;
  select name into actor_name from public.users where user_id=actor;
  if p_entry is null then
    if coalesce(p_delete,false) then raise exception '找不到要刪除的交接事項'; end if;
    insert into public.produce_handover_entries(group_code,market_code,handover_date,shift_code,description,created_by,created_name,updated_by)
      values(p_group,p_market,p_date,p_shift,text_value,actor,actor_name,actor) returning * into e;
    return to_jsonb(e);
  end if;
  select * into e from public.produce_handover_entries
    where entry_id=p_entry and group_code=p_group and market_code=p_market and handover_date=p_date and shift_code=p_shift and not is_deleted;
  if e.entry_id is null then raise exception '找不到本班可修改的交接事項'; end if;
  if coalesce(p_delete,false) then
    update public.produce_handover_entries set is_deleted=true,deleted_by=actor,deleted_at=now(),updated_by=actor,updated_at=now()
      where entry_id=p_entry returning * into e;
  else
    update public.produce_handover_entries set description=text_value,updated_by=actor,updated_at=now()
      where entry_id=p_entry returning * into e;
  end if;
  return to_jsonb(e);
end $$;

-- 交班（submit）、接班確認（receive）、登記事項完成（complete）。規則與業管組相同：
-- 交班人須指定同市場另一位人員接班；上一班已交班者須先由指定接班人確認接班才能再交班；
-- 完成事項只能在目前台灣當班登記，本班已交班後改由下一班處理。
create or replace function public.produce_action(p_group text,p_market text,p_action text,p_date date,p_shift text,
  p_entry uuid default null,p_receiver uuid default null,p_revision text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; receiver_name text;
  items jsonb; t public.produce_handover_transfers; prev public.produce_handover_transfers;
  target_date date; target_shift text; e public.produce_handover_entries;
  taipei timestamp:=now() at time zone 'Asia/Taipei'; current_date_tw date; current_shift text;
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_date is null or p_shift is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.produce_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可交接或完成事項'; end if;
  perform pg_advisory_xact_lock(6091621,hashtext(p_group||p_market));
  select name into actor_name from public.users where user_id=actor;
  select * into t from public.produce_handover_transfers where group_code=p_group and market_code=p_market and handover_date=p_date and shift_code=p_shift;
  select * into prev from public.produce_handover_transfers where group_code=p_group and market_code=p_market and next_date=p_date and next_shift=p_shift;
  if p_action='receive' then
    if prev.transfer_id is null then raise exception '上一班尚未送出交班，無法確認接班'; end if;
    if prev.receiver_id<>actor then raise exception using errcode='42501',message='僅指定接班人本人可確認接班'; end if;
    if p_revision is distinct from prev.revision then raise exception '交班內容已變更，請重新載入後確認'; end if;
    if prev.received_at is not null then return to_jsonb(prev); end if;
    update public.produce_handover_transfers set received_by=actor,received_name=actor_name,received_at=now()
      where transfer_id=prev.transfer_id returning * into prev;
    return to_jsonb(prev);
  elsif p_action='submit' then
    if t.transfer_id is not null then raise exception '本班已交班，不可重複送出'; end if;
    if prev.transfer_id is null and exists(select 1 from public.produce_handover_transfers
      where group_code=p_group and market_code=p_market and (handover_date,shift_code)<(p_date,p_shift)) then
      raise exception '上一班尚未交班，請先完成上一班交接，不能跳過班別勾稽';
    end if;
    if prev.transfer_id is not null and prev.received_at is null then raise exception '請先由指定接班人完成上一班的接班確認'; end if;
    if prev.transfer_id is not null and prev.received_by<>actor then raise exception using errcode='42501',message='本班須由已確認接班的人員送出交班'; end if;
    if p_receiver is null or p_receiver=actor then raise exception '請指定另一位人員接班，交班與接班不可為同一人'; end if;
    select name into receiver_name from public.users where user_id=p_receiver and public.produce_receiver_allowed(user_id,p_group,p_market);
    if receiver_name is null then raise exception '指定接班人必須是同一市場、在職且具水果組交接權限的人員'; end if;
    items:=public.produce_shift_items(p_group,p_market,p_date,p_shift);
    if p_revision is distinct from md5(items::text) then raise exception '交接事項剛被修改，請重新載入並重新確認'; end if;
    target_date:=p_date+case when p_shift='17-01' then 1 else 0 end;
    target_shift:=case p_shift when '01-09' then '09-17' when '09-17' then '17-01' else '01-09' end;
    insert into public.produce_handover_transfers(group_code,market_code,handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
      values(p_group,p_market,p_date,p_shift,target_date,target_shift,items,p_revision,actor,actor_name,p_receiver,receiver_name) returning * into t;
    return to_jsonb(t);
  elsif p_action='complete' then
    current_date_tw:=taipei::date-case when taipei::time<time '01:00' then 1 else 0 end;
    current_shift:=case when taipei::time<time '01:00' or taipei::time>=time '17:00' then '17-01' when taipei::time<time '09:00' then '01-09' else '09-17' end;
    if (p_date,p_shift)<>(current_date_tw,current_shift) then raise exception '請在目前當班紀錄完成事項，不可回填其他班別'; end if;
    if t.transfer_id is not null then raise exception '本班已交班，請由下一班接續處理'; end if;
    select * into e from public.produce_handover_entries where entry_id=p_entry and group_code=p_group and market_code=p_market;
    if e.entry_id is null or e.is_deleted or (e.handover_date,e.shift_code)>(p_date,p_shift) then raise exception '找不到本班可完成的交接事項'; end if;
    if exists(select 1 from public.produce_handover_completions where entry_id=p_entry) then
      return (select to_jsonb(c) from public.produce_handover_completions c where entry_id=p_entry);
    end if;
    insert into public.produce_handover_completions(entry_id,completed_date,completed_shift,completed_by,completed_name)
      values(p_entry,p_date,p_shift,actor,actor_name);
    return (select to_jsonb(c) from public.produce_handover_completions c where entry_id=p_entry);
  end if;
  raise exception '不支援的交接動作';
end $$;

-- 批核：同一階同一天只有一筆；原批核人可更新說明，其他人不可覆蓋。
create or replace function public.produce_approval_save(p_group text,p_market text,p_date date,p_stage text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); actor_name text; a public.produce_handover_approvals;
  market_name text:=case p_market when 'market_2' then '二市場' else '一市場' end;
  label text; note_value text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_stage not in ('group_leader','deputy_director','director') then raise exception '批核階段無效'; end if;
  if not public.produce_approval_allowed(actor,p_group,p_market,p_stage) then
    raise exception using errcode='42501',message='依現行角色、市場與組織層級規則，您不能批核此階段';
  end if;
  if p_date is null or p_date>(now() at time zone 'Asia/Taipei')::date then raise exception '交接日尚未到，不能批核'; end if;
  if note_value is not null and char_length(note_value)>500 then raise exception '批核說明至多 500 字'; end if;
  label:=case p_stage when 'group_leader' then '組(副)長' when 'deputy_director' then market_name||'副主任' else market_name||'主任' end;
  select name into actor_name from public.users where user_id=actor;
  perform pg_advisory_xact_lock(6091622,hashtext(p_group||p_market||p_date::text));
  select * into a from public.produce_handover_approvals where group_code=p_group and market_code=p_market and handover_date=p_date and stage=p_stage;
  if a.approval_id is null then
    insert into public.produce_handover_approvals(group_code,market_code,handover_date,stage,stage_label,approver_id,approver_name,note)
      values(p_group,p_market,p_date,p_stage,label,actor,actor_name,note_value) returning * into a;
  elsif a.approver_id<>actor then
    raise exception '本階段已由%批核，不可覆蓋',a.approver_name;
  else
    update public.produce_handover_approvals set note=note_value,updated_at=now() where approval_id=a.approval_id returning * into a;
  end if;
  return to_jsonb(a);
end $$;

/* ───────────── RLS 與授權 ───────────── */

alter table public.produce_handover_entries enable row level security;
alter table public.produce_handover_entries force row level security;
alter table public.produce_handover_completions enable row level security;
alter table public.produce_handover_completions force row level security;
alter table public.produce_handover_transfers enable row level security;
alter table public.produce_handover_transfers force row level security;
alter table public.produce_handover_approvals enable row level security;
alter table public.produce_handover_approvals force row level security;
revoke all on public.produce_handover_entries,public.produce_handover_completions,public.produce_handover_transfers,public.produce_handover_approvals from anon,authenticated;
grant select on public.produce_handover_entries,public.produce_handover_completions,public.produce_handover_transfers,public.produce_handover_approvals to authenticated;

drop policy if exists produce_entries_read on public.produce_handover_entries;
create policy produce_entries_read on public.produce_handover_entries for select to authenticated using(public.produce_market_allowed(group_code,market_code));
drop policy if exists produce_transfers_read on public.produce_handover_transfers;
create policy produce_transfers_read on public.produce_handover_transfers for select to authenticated using(public.produce_market_allowed(group_code,market_code));
drop policy if exists produce_approvals_read on public.produce_handover_approvals;
create policy produce_approvals_read on public.produce_handover_approvals for select to authenticated using(public.produce_market_allowed(group_code,market_code));
drop policy if exists produce_completions_read on public.produce_handover_completions;
create policy produce_completions_read on public.produce_handover_completions for select to authenticated
  using(exists(select 1 from public.produce_handover_entries e where e.entry_id=produce_handover_completions.entry_id and public.produce_market_allowed(e.group_code,e.market_code)));

revoke all on function public.produce_group_enabled(text,text),public.produce_module_key(text),public.produce_shift_start(date,text),
  public.produce_staff_market(uuid,text),public.produce_user_allowed(uuid,text),public.produce_approval_allowed(uuid,text,text,text),
  public.produce_market_allowed(text,text),public.produce_receiver_allowed(uuid,text,text),public.produce_shift_items(text,text,date,text),
  public.produce_lock_entry(),public.produce_approval_gate(),public.produce_protect_approval() from public,anon,authenticated;
grant execute on function public.produce_market_allowed(text,text) to authenticated;
revoke all on function public.produce_receivers(text,text),public.produce_day(text,text,date),
  public.produce_entry_save(text,text,date,text,uuid,text,boolean),
  public.produce_action(text,text,text,date,text,uuid,uuid,text),
  public.produce_approval_save(text,text,date,text,text) from public,anon,authenticated;
grant execute on function public.produce_receivers(text,text),public.produce_day(text,text,date),
  public.produce_entry_save(text,text,date,text,uuid,text,boolean),
  public.produce_action(text,text,text,date,text,uuid,uuid,text),
  public.produce_approval_save(text,text,date,text,text) to authenticated;

-- 子系統預設拒絕，避免所有交接簿使用者自動看到水果組；須在權限頁逐一設為「允許」。
insert into public.role_module_access(role_id,system_key,module_key,mode)
select r.role_id,'handover','fruit','deny' from public.roles r where r.role_id<>'sysadmin'
on conflict(role_id,system_key,module_key) do nothing;

comment on table public.produce_handover_entries is '水果組／蔬菜組交接簿現場移交事項（自由文字，標記刪除不實體刪除）';
comment on table public.produce_handover_transfers is '水果組／蔬菜組交班內容快照與交班／指定接班人雙方的伺服器簽認時間';
comment on table public.produce_handover_approvals is '水果組／蔬菜組交接簿三階批核（組(副)長、市場副主任、市場主任）';

notify pgrst, 'reload schema';
commit;
