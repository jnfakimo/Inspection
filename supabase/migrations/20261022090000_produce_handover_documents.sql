-- 水果組電子交接簿第二批：存貨交接明細表（HOL-2-09）、果菜報廢報告表（HEM-2-11）、果菜產地運回放行單。
-- 沿用 20261021090000 的組別／市場判斷（produce_group_enabled、produce_market_allowed），目前只開放一市場水果組。
--
-- 規則（使用者 2026-10-21 決定）：
--  1. 存貨交接：填表人員 → 小組長 → 組(副)長；報廢報告：拍賣員、檢驗員（先輸入姓名，不要求登入）→ 小組長 → 組(副)長 → 主(副)任。
--     後一關須在前一關之後，不限當日；送出後內容鎖定，簽核紀錄不可改刪。
--  2. 小組長：水果組內任一位有交接簿權限的同仁，但不可是該單的填表人本人；
--     組(副)長：水果組單位主管；主(副)任：業管組同一市場的副主任或主任（與批核共用同一批人）；系統管理員可簽任一階。
--  3. 存貨交接「一式三份」：自存不記；「已送核算小組」「已呈業務部」各記一次送出人與時間，須在組(副)長簽核後。
--  4. 運回放行單：系統依「組別、市場、民國年」自動編流水號，另可手填紙本單號（例如 001485）；開立後不可改，只能作廢並留原因。
--  5. 品名、供應代號自由輸入，系統由歷史紀錄提供建議。
--  6. 不實體刪除：明細以 jsonb 存在單據內（避免 DELETE）；草稿可作廢，送出後只能簽核或送出，不可刪改。
begin;

create table if not exists public.produce_stock_handovers (
  stock_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  handover_date date not null,
  area_label text check (area_label is null or char_length(area_label)<=40),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines)='array' and jsonb_array_length(lines)<=60),
  status text not null default 'draft' check (status in ('draft','submitted','void')),
  created_by uuid not null references public.users(user_id),
  created_name text not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.users(user_id),
  submitted_name text,
  submitted_at timestamptz,
  sent_accounting_by uuid references public.users(user_id),
  sent_accounting_name text,
  sent_accounting_at timestamptz,
  sent_business_by uuid references public.users(user_id),
  sent_business_name text,
  sent_business_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason)<=200),
  voided_by uuid references public.users(user_id),
  voided_at timestamptz,
  check ((status='submitted') = (submitted_at is not null) or status='void')
);
create index if not exists produce_stock_group_date on public.produce_stock_handovers(group_code,market_code,handover_date desc,created_at desc);

create table if not exists public.produce_scrap_reports (
  scrap_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  report_date date not null,
  remark text check (remark is null or char_length(remark)<=1000),
  supervisor_name text check (supervisor_name is null or char_length(supervisor_name)<=40),
  auctioneer_name text check (auctioneer_name is null or char_length(auctioneer_name)<=40),
  inspector_name text check (inspector_name is null or char_length(inspector_name)<=40),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines)='array' and jsonb_array_length(lines)<=60),
  status text not null default 'draft' check (status in ('draft','submitted','void')),
  created_by uuid not null references public.users(user_id),
  created_name text not null,
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now(),
  submitted_by uuid references public.users(user_id),
  submitted_name text,
  submitted_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason)<=200),
  voided_by uuid references public.users(user_id),
  voided_at timestamptz,
  check ((status='submitted') = (submitted_at is not null) or status='void')
);
create index if not exists produce_scrap_group_date on public.produce_scrap_reports(group_code,market_code,report_date desc,created_at desc);

-- 兩種單據共用的簽核紀錄（小組長、組(副)長、主(副)任）。
create table if not exists public.produce_document_signatures (
  signature_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  doc_type text not null check (doc_type in ('stock','scrap')),
  doc_id uuid not null,
  stage text not null check (stage in ('small_leader','group_leader','director')),
  stage_label text not null,
  signer_id uuid not null references public.users(user_id),
  signer_name text not null,
  signed_at timestamptz not null default now(),
  note text check (note is null or char_length(note)<=500)
);
create unique index if not exists produce_signature_stage on public.produce_document_signatures(doc_type,doc_id,stage);

create table if not exists public.produce_slip_counters (
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  roc_year int not null,
  last_no int not null default 0,
  primary key (group_code,market_code,roc_year)
);

create table if not exists public.produce_release_slips (
  slip_id uuid primary key default gen_random_uuid(),
  group_code text not null check (group_code in ('fruit','vegetable')),
  market_code text not null check (market_code in ('market_1','market_2')),
  serial_no text not null,
  paper_no text check (paper_no is null or char_length(paper_no)<=30),
  processed_at timestamptz not null,
  vehicle text check (vehicle is null or char_length(vehicle)<=80),
  product_name text not null check (char_length(btrim(product_name)) between 1 and 80),
  supplier_unit text check (supplier_unit is null or char_length(supplier_unit)<=80),
  qty_weight text check (qty_weight is null or char_length(qty_weight)<=80),
  receiver_name text check (receiver_name is null or char_length(receiver_name)<=40),
  remark text check (remark is null or char_length(remark)<=500),
  issuer_id uuid not null references public.users(user_id),
  issuer_name text not null,
  created_at timestamptz not null default now(),
  status text not null default 'issued' check (status in ('issued','void')),
  void_reason text check (void_reason is null or char_length(void_reason)<=200),
  voided_by uuid references public.users(user_id),
  voided_name text,
  voided_at timestamptz
);
create unique index if not exists produce_slip_serial on public.produce_release_slips(group_code,market_code,serial_no);
create index if not exists produce_slip_group_time on public.produce_release_slips(group_code,market_code,processed_at desc);

/* ───────────── 判斷與正規化（不開放給前端直接呼叫） ───────────── */

-- 單據明細只收白名單欄位並限制長度；空白列略過，其餘列必須有品名。
create or replace function public.produce_normalize_lines(p_kind text,p_lines jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare e jsonb; item jsonb; result jsonb:='[]'::jsonb; k text; v text; n numeric; d date; has_value boolean; lim numeric;
  text_keys text[]:=case p_kind when 'stock' then array['purchase_no','supplier_code','product_name','grade','container','location','reason']
    else array['supplier_code','product_name','container','reason'] end;
  date_keys text[]:=case p_kind when 'scrap' then array['receive_date','scrap_date'] else array[]::text[] end;
begin
  if p_kind not in ('stock','scrap') then raise exception '明細種類無效'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception '明細格式無效'; end if;
  if jsonb_array_length(p_lines)>60 then raise exception '明細至多 60 列'; end if;
  for e in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(e)<>'object' then raise exception '明細格式無效'; end if;
    item:='{}'::jsonb; has_value:=false;
    foreach k in array text_keys loop
      v:=btrim(coalesce(e->>k,''));
      lim:=case k when 'reason' then 500 else 80 end;
      if char_length(v)>lim then raise exception '明細欄位「%」過長',k; end if;
      if v<>'' then has_value:=true; end if;
      item:=item||jsonb_build_object(k,v);
    end loop;
    foreach k in array date_keys loop
      v:=btrim(coalesce(e->>k,''));
      if v='' then item:=item||jsonb_build_object(k,''); continue; end if;
      begin d:=v::date; exception when others then raise exception '明細日期格式無效'; end;
      has_value:=true; item:=item||jsonb_build_object(k,to_char(d,'YYYY-MM-DD'));
    end loop;
    foreach k in array array['pieces','weight'] loop
      v:=btrim(coalesce(e->>k,''));
      if v='' then item:=item||jsonb_build_object(k,0); continue; end if;
      begin n:=v::numeric; exception when others then raise exception '明細件數與重量必須是數字'; end;
      lim:=case k when 'pieces' then 999999 else 9999999.99 end;
      if n<0 or n>lim then raise exception '明細件數或重量超出範圍'; end if;
      if k='pieces' and n<>trunc(n) then raise exception '件數必須是整數'; end if;
      if n>0 then has_value:=true; end if;
      item:=item||jsonb_build_object(k,case k when 'pieces' then trunc(n) else round(n,2) end);
    end loop;
    if not has_value then continue; end if;
    if (item->>'product_name')='' then raise exception '明細每一列都必須填寫品名'; end if;
    result:=result||jsonb_build_array(item);
  end loop;
  return result;
end $$;

create or replace function public.produce_actor_name(p_user uuid)
returns text language sql stable security definer set search_path='' as $$
  select name from public.users where user_id=p_user
$$;

-- 各單據各階段的簽核資格。小組長：水果組同仁但不可是填表人；其餘沿用批核資格；sysadmin 可簽任一階。
create or replace function public.produce_document_stage_allowed(p_user uuid,p_group text,p_market text,p_stage text,p_creator uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.produce_group_enabled(p_group,p_market) and p_stage in ('small_leader','group_leader','director') and (
    public.produce_approval_allowed(p_user,p_group,p_market,'group_leader') and p_stage='group_leader'
    or (p_stage='director' and (public.produce_approval_allowed(p_user,p_group,p_market,'deputy_director')
        or public.produce_approval_allowed(p_user,p_group,p_market,'director')))
    or (p_stage='small_leader' and p_user is distinct from p_creator and public.produce_user_allowed(p_user,p_group)
        and public.produce_staff_market(p_user,p_group)=p_market)
    or exists(select 1 from public.users u where u.user_id=p_user and u.status='active'
        and coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' else u.role end)='sysadmin')),false)
$$;

create or replace function public.produce_document_stage_order(p_doc_type text)
returns text[] language sql immutable set search_path='' as $$
  select case p_doc_type when 'stock' then array['small_leader','group_leader'] when 'scrap' then array['small_leader','group_leader','director'] end
$$;

-- 簽核關卡：只有送出的單據可簽；後一關須在前一關之後。
create or replace function public.produce_signature_gate()
returns trigger language plpgsql security definer set search_path='' as $$
declare stages text[]:=public.produce_document_stage_order(new.doc_type); idx int; need text; doc_status text;
begin
  idx:=array_position(stages,new.stage);
  if idx is null then raise exception using errcode='23514',message='此單據沒有這個簽核階段'; end if;
  if new.doc_type='stock' then
    select status into doc_status from public.produce_stock_handovers where stock_id=new.doc_id and group_code=new.group_code and market_code=new.market_code;
  else
    select status into doc_status from public.produce_scrap_reports where scrap_id=new.doc_id and group_code=new.group_code and market_code=new.market_code;
  end if;
  if doc_status is distinct from 'submitted' then raise exception using errcode='23514',message='單據尚未送出或已作廢，不能簽核'; end if;
  if idx>1 then
    need:=stages[idx-1];
    if not exists(select 1 from public.produce_document_signatures s where s.doc_type=new.doc_type and s.doc_id=new.doc_id and s.stage=need) then
      raise exception '請先由%簽核，%才能簽核',
        case need when 'small_leader' then '小組長' when 'group_leader' then '組(副)長' else '主(副)任' end,
        case new.stage when 'group_leader' then '組(副)長' when 'director' then '主(副)任' else '小組長' end
        using errcode='P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_produce_signature_gate on public.produce_document_signatures;
create trigger trg_produce_signature_gate before insert on public.produce_document_signatures
  for each row execute function public.produce_signature_gate();

create or replace function public.produce_protect_signature()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='23514',message='簽核紀錄不可修改或刪除';
end $$;
drop trigger if exists trg_produce_protect_signature on public.produce_document_signatures;
create trigger trg_produce_protect_signature before update or delete on public.produce_document_signatures
  for each row execute function public.produce_protect_signature();

-- 單據保護：不可刪除；送出後內容鎖定（存貨交接僅允許補記「已送出」狀態）；作廢後不可再改。
create or replace function public.produce_protect_document()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='單據不可刪除，草稿請改為作廢'; end if;
  if new.group_code is distinct from old.group_code or new.market_code is distinct from old.market_code
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='單據的組別、市場與建立人不可變更';
  end if;
  if old.status='void' then raise exception using errcode='23514',message='單據已作廢，不可再修改'; end if;
  if old.status='submitted' then
    if new.status is distinct from 'submitted' or new.lines is distinct from old.lines
      or new.submitted_at is distinct from old.submitted_at or new.submitted_by is distinct from old.submitted_by then
      raise exception using errcode='23514',message='單據已送出，內容鎖定';
    end if;
    if tg_table_name='produce_stock_handovers' then
      if new.handover_date is distinct from old.handover_date or new.area_label is distinct from old.area_label
        or (old.sent_accounting_at is not null and new.sent_accounting_at is distinct from old.sent_accounting_at)
        or (old.sent_business_at is not null and new.sent_business_at is distinct from old.sent_business_at) then
        raise exception using errcode='23514',message='單據已送出，內容鎖定';
      end if;
    else
      if new.report_date is distinct from old.report_date or new.remark is distinct from old.remark
        or new.supervisor_name is distinct from old.supervisor_name or new.auctioneer_name is distinct from old.auctioneer_name
        or new.inspector_name is distinct from old.inspector_name then
        raise exception using errcode='23514',message='單據已送出，內容鎖定';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_produce_protect_stock on public.produce_stock_handovers;
create trigger trg_produce_protect_stock before update or delete on public.produce_stock_handovers
  for each row execute function public.produce_protect_document();
drop trigger if exists trg_produce_protect_scrap on public.produce_scrap_reports;
create trigger trg_produce_protect_scrap before update or delete on public.produce_scrap_reports
  for each row execute function public.produce_protect_document();

create or replace function public.produce_protect_slip()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception using errcode='23514',message='放行單不可刪除，請改為作廢'; end if;
  if old.status='void' then raise exception using errcode='23514',message='放行單已作廢，不可再修改'; end if;
  if new.status<>'void' or new.serial_no is distinct from old.serial_no or new.product_name is distinct from old.product_name
    or new.processed_at is distinct from old.processed_at or new.issuer_id is distinct from old.issuer_id
    or new.group_code is distinct from old.group_code or new.market_code is distinct from old.market_code
    or new.paper_no is distinct from old.paper_no or new.vehicle is distinct from old.vehicle
    or new.supplier_unit is distinct from old.supplier_unit or new.qty_weight is distinct from old.qty_weight
    or new.receiver_name is distinct from old.receiver_name or new.remark is distinct from old.remark then
    raise exception using errcode='23514',message='放行單開立後不可修改，只能作廢';
  end if;
  return new;
end $$;
drop trigger if exists trg_produce_protect_slip on public.produce_release_slips;
create trigger trg_produce_protect_slip before update or delete on public.produce_release_slips
  for each row execute function public.produce_protect_slip();

/* ───────────── 前端呼叫的 RPC ───────────── */

create or replace function public.produce_stock_save(p_group text,p_market text,p_stock uuid,p_date date,p_area text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); s public.produce_stock_handovers; v_lines jsonb; v_area text:=nullif(btrim(coalesce(p_area,'')),'');
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_date is null then raise exception '請選擇存貨交接日期'; end if;
  if v_area is not null and char_length(v_area)>40 then raise exception '區組名稱至多 40 字'; end if;
  v_lines:=public.produce_normalize_lines('stock',p_lines);
  if p_stock is null then
    insert into public.produce_stock_handovers(group_code,market_code,handover_date,area_label,lines,created_by,created_name,updated_by)
      values(p_group,p_market,p_date,v_area,v_lines,actor,public.produce_actor_name(actor),actor) returning * into s;
    return to_jsonb(s);
  end if;
  select * into s from public.produce_stock_handovers where stock_id=p_stock and group_code=p_group and market_code=p_market;
  if s.stock_id is null then raise exception '找不到存貨交接明細表'; end if;
  if s.status<>'draft' then raise exception '單據已送出或作廢，不能修改'; end if;
  if s.created_by<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
    raise exception using errcode='42501',message='草稿只有填表人或組(副)長可以修改';
  end if;
  update public.produce_stock_handovers set handover_date=p_date,area_label=v_area,lines=v_lines,updated_by=actor,updated_at=now()
    where stock_id=p_stock returning * into s;
  return to_jsonb(s);
end $$;

create or replace function public.produce_scrap_save(p_group text,p_market text,p_scrap uuid,p_date date,p_remark text,
  p_supervisor text,p_auctioneer text,p_inspector text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); s public.produce_scrap_reports; v_lines jsonb;
  v_remark text:=nullif(btrim(coalesce(p_remark,'')),''); v_sup text:=nullif(btrim(coalesce(p_supervisor,'')),'');
  v_auc text:=nullif(btrim(coalesce(p_auctioneer,'')),''); v_insp text:=nullif(btrim(coalesce(p_inspector,'')),'');
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_date is null then raise exception '請選擇報廢報告日期'; end if;
  if v_remark is not null and char_length(v_remark)>1000 then raise exception '備註至多 1000 字'; end if;
  if coalesce(char_length(v_sup),0)>40 or coalesce(char_length(v_auc),0)>40 or coalesce(char_length(v_insp),0)>40 then raise exception '姓名至多 40 字'; end if;
  v_lines:=public.produce_normalize_lines('scrap',p_lines);
  if p_scrap is null then
    insert into public.produce_scrap_reports(group_code,market_code,report_date,remark,supervisor_name,auctioneer_name,inspector_name,lines,created_by,created_name,updated_by)
      values(p_group,p_market,p_date,v_remark,v_sup,v_auc,v_insp,v_lines,actor,public.produce_actor_name(actor),actor) returning * into s;
    return to_jsonb(s);
  end if;
  select * into s from public.produce_scrap_reports where scrap_id=p_scrap and group_code=p_group and market_code=p_market;
  if s.scrap_id is null then raise exception '找不到報廢報告表'; end if;
  if s.status<>'draft' then raise exception '單據已送出或作廢，不能修改'; end if;
  if s.created_by<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
    raise exception using errcode='42501',message='草稿只有填表人或組(副)長可以修改';
  end if;
  update public.produce_scrap_reports set report_date=p_date,remark=v_remark,supervisor_name=v_sup,auctioneer_name=v_auc,inspector_name=v_insp,
    lines=v_lines,updated_by=actor,updated_at=now() where scrap_id=p_scrap returning * into s;
  return to_jsonb(s);
end $$;

-- 送出：存貨交接＝填表人員簽署；報廢報告須有拍賣員與檢驗員姓名。送出後內容鎖定。
create or replace function public.produce_doc_submit(p_group text,p_market text,p_doc_type text,p_doc uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); s public.produce_stock_handovers; r public.produce_scrap_reports;
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_doc_type='stock' then
    select * into s from public.produce_stock_handovers where stock_id=p_doc and group_code=p_group and market_code=p_market for update;
    if s.stock_id is null then raise exception '找不到存貨交接明細表'; end if;
    if s.status<>'draft' then raise exception '單據已送出或作廢'; end if;
    if s.created_by<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
      raise exception using errcode='42501',message='只有填表人或組(副)長可以送出';
    end if;
    if jsonb_array_length(s.lines)=0 then raise exception '請至少填寫一列存貨明細'; end if;
    update public.produce_stock_handovers set status='submitted',submitted_by=actor,submitted_name=public.produce_actor_name(actor),submitted_at=now(),updated_by=actor,updated_at=now()
      where stock_id=p_doc returning * into s;
    return to_jsonb(s);
  elsif p_doc_type='scrap' then
    select * into r from public.produce_scrap_reports where scrap_id=p_doc and group_code=p_group and market_code=p_market for update;
    if r.scrap_id is null then raise exception '找不到報廢報告表'; end if;
    if r.status<>'draft' then raise exception '單據已送出或作廢'; end if;
    if r.created_by<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
      raise exception using errcode='42501',message='只有填表人或組(副)長可以送出';
    end if;
    if jsonb_array_length(r.lines)=0 then raise exception '請至少填寫一列報廢明細'; end if;
    if coalesce(r.auctioneer_name,'')='' or coalesce(r.inspector_name,'')='' then raise exception '請填寫拍賣員與檢驗員姓名'; end if;
    update public.produce_scrap_reports set status='submitted',submitted_by=actor,submitted_name=public.produce_actor_name(actor),submitted_at=now(),updated_by=actor,updated_at=now()
      where scrap_id=p_doc returning * into r;
    return to_jsonb(r);
  end if;
  raise exception '單據種類無效';
end $$;

create or replace function public.produce_doc_void(p_group text,p_market text,p_doc_type text,p_doc uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); s public.produce_stock_handovers; r public.produce_scrap_reports; reason text:=btrim(coalesce(p_reason,''));
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if char_length(reason) not between 2 and 200 then raise exception '請填寫作廢原因（2 至 200 字）'; end if;
  if p_doc_type='stock' then
    select * into s from public.produce_stock_handovers where stock_id=p_doc and group_code=p_group and market_code=p_market for update;
    if s.stock_id is null then raise exception '找不到存貨交接明細表'; end if;
    if s.status<>'draft' then raise exception '只有草稿可以作廢'; end if;
    if s.created_by<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
      raise exception using errcode='42501',message='只有填表人或組(副)長可以作廢';
    end if;
    update public.produce_stock_handovers set status='void',void_reason=reason,voided_by=actor,voided_at=now(),updated_by=actor,updated_at=now()
      where stock_id=p_doc returning * into s;
    return to_jsonb(s);
  elsif p_doc_type='scrap' then
    select * into r from public.produce_scrap_reports where scrap_id=p_doc and group_code=p_group and market_code=p_market for update;
    if r.scrap_id is null then raise exception '找不到報廢報告表'; end if;
    if r.status<>'draft' then raise exception '只有草稿可以作廢'; end if;
    if r.created_by<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
      raise exception using errcode='42501',message='只有填表人或組(副)長可以作廢';
    end if;
    update public.produce_scrap_reports set status='void',void_reason=reason,voided_by=actor,voided_at=now(),updated_by=actor,updated_at=now()
      where scrap_id=p_doc returning * into r;
    return to_jsonb(r);
  end if;
  raise exception '單據種類無效';
end $$;

create or replace function public.produce_doc_sign(p_group text,p_market text,p_doc_type text,p_doc uuid,p_stage text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); creator uuid; sig public.produce_document_signatures; note_value text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_doc_type not in ('stock','scrap') then raise exception '單據種類無效'; end if;
  if not (p_stage=any(public.produce_document_stage_order(p_doc_type))) then raise exception '簽核階段無效'; end if;
  if note_value is not null and char_length(note_value)>500 then raise exception '簽核說明至多 500 字'; end if;
  if p_doc_type='stock' then
    select created_by into creator from public.produce_stock_handovers where stock_id=p_doc and group_code=p_group and market_code=p_market;
  else
    select created_by into creator from public.produce_scrap_reports where scrap_id=p_doc and group_code=p_group and market_code=p_market;
  end if;
  if creator is null then raise exception '找不到單據'; end if;
  if not public.produce_document_stage_allowed(actor,p_group,p_market,p_stage,creator) then
    raise exception using errcode='42501',message='依現行角色、市場與組織層級規則，您不能簽核此階段（小組長不可是填表人本人）';
  end if;
  perform pg_advisory_xact_lock(6091623,hashtext(p_doc::text));
  if exists(select 1 from public.produce_document_signatures where doc_type=p_doc_type and doc_id=p_doc and stage=p_stage) then
    raise exception '此階段已簽核';
  end if;
  insert into public.produce_document_signatures(group_code,market_code,doc_type,doc_id,stage,stage_label,signer_id,signer_name,note)
    values(p_group,p_market,p_doc_type,p_doc,p_stage,
      case p_stage when 'small_leader' then '小組長' when 'group_leader' then '組(副)長' else '主(副)任' end,
      actor,public.produce_actor_name(actor),note_value) returning * into sig;
  return to_jsonb(sig);
end $$;

-- 存貨交接「一式三份」的送出紀錄：須在組(副)長簽核之後，每個去向只記一次。
create or replace function public.produce_stock_distribute(p_group text,p_market text,p_stock uuid,p_target text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); s public.produce_stock_handovers;
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if p_target not in ('accounting','business') then raise exception '送出對象無效'; end if;
  select * into s from public.produce_stock_handovers where stock_id=p_stock and group_code=p_group and market_code=p_market for update;
  if s.stock_id is null then raise exception '找不到存貨交接明細表'; end if;
  if s.status<>'submitted' then raise exception '單據尚未送出'; end if;
  if not exists(select 1 from public.produce_document_signatures where doc_type='stock' and doc_id=p_stock and stage='group_leader') then
    raise exception '請先由組(副)長簽核，才能登記送出';
  end if;
  if not coalesce(public.produce_staff_market(actor,p_group)=p_market or public.active_rbac_role()='sysadmin',false) then
    raise exception using errcode='42501',message='只有水果組同仁可以登記送出';
  end if;
  if p_target='accounting' then
    if s.sent_accounting_at is not null then return to_jsonb(s); end if;
    update public.produce_stock_handovers set sent_accounting_by=actor,sent_accounting_name=public.produce_actor_name(actor),sent_accounting_at=now()
      where stock_id=p_stock returning * into s;
  else
    if s.sent_business_at is not null then return to_jsonb(s); end if;
    update public.produce_stock_handovers set sent_business_by=actor,sent_business_name=public.produce_actor_name(actor),sent_business_at=now()
      where stock_id=p_stock returning * into s;
  end if;
  return to_jsonb(s);
end $$;

-- 運回放行單：自動流水號「F1-115-00001」（組別代號、市場、民國年、5 位序號）。
create or replace function public.produce_slip_issue(p_group text,p_market text,p_paper_no text,p_processed_at timestamptz,p_vehicle text,
  p_product text,p_supplier text,p_qty text,p_receiver text,p_remark text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); roc int; seq int; serial text; slip public.produce_release_slips;
  product text:=btrim(coalesce(p_product,'')); paper text:=nullif(btrim(coalesce(p_paper_no,'')),'');
  veh text:=nullif(btrim(coalesce(p_vehicle,'')),''); sup text:=nullif(btrim(coalesce(p_supplier,'')),'');
  qty text:=nullif(btrim(coalesce(p_qty,'')),''); rec text:=nullif(btrim(coalesce(p_receiver,'')),''); rem text:=nullif(btrim(coalesce(p_remark,'')),'');
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if char_length(product) not between 1 and 80 then raise exception '請填寫品名（至多 80 字）'; end if;
  if p_processed_at is null then raise exception '請填寫處理時間'; end if;
  if p_processed_at>now()+interval '5 minutes' then raise exception '處理時間不得晚於目前時間'; end if;
  if coalesce(char_length(paper),0)>30 or coalesce(char_length(veh),0)>80 or coalesce(char_length(sup),0)>80
    or coalesce(char_length(qty),0)>80 or coalesce(char_length(rec),0)>40 or coalesce(char_length(rem),0)>500 then
    raise exception '欄位內容過長';
  end if;
  roc:=extract(year from (now() at time zone 'Asia/Taipei'))::int-1911;
  perform pg_advisory_xact_lock(6091624,hashtext(p_group||p_market||roc::text));
  insert into public.produce_slip_counters(group_code,market_code,roc_year,last_no) values(p_group,p_market,roc,1)
    on conflict (group_code,market_code,roc_year) do update set last_no=public.produce_slip_counters.last_no+1
    returning last_no into seq;
  serial:=case p_group when 'fruit' then 'F' else 'V' end||case p_market when 'market_2' then '2' else '1' end||'-'||roc::text||'-'||lpad(seq::text,5,'0');
  insert into public.produce_release_slips(group_code,market_code,serial_no,paper_no,processed_at,vehicle,product_name,supplier_unit,qty_weight,receiver_name,remark,issuer_id,issuer_name)
    values(p_group,p_market,serial,paper,p_processed_at,veh,product,sup,qty,rec,rem,actor,public.produce_actor_name(actor)) returning * into slip;
  return to_jsonb(slip);
end $$;

create or replace function public.produce_slip_void(p_group text,p_market text,p_slip uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.active_user_id(); slip public.produce_release_slips; reason text:=btrim(coalesce(p_reason,''));
begin
  if actor is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  if char_length(reason) not between 2 and 200 then raise exception '請填寫作廢原因（2 至 200 字）'; end if;
  select * into slip from public.produce_release_slips where slip_id=p_slip and group_code=p_group and market_code=p_market for update;
  if slip.slip_id is null then raise exception '找不到運回放行單'; end if;
  if slip.status<>'issued' then raise exception '放行單已作廢'; end if;
  if slip.issuer_id<>actor and not public.produce_approval_allowed(actor,p_group,p_market,'group_leader') then
    raise exception using errcode='42501',message='只有開單人或組(副)長可以作廢';
  end if;
  update public.produce_release_slips set status='void',void_reason=reason,voided_by=actor,voided_name=public.produce_actor_name(actor),voided_at=now()
    where slip_id=p_slip returning * into slip;
  return to_jsonb(slip);
end $$;

-- 品名、供應代號與供應單位的歷史建議（近一年，依使用次數排序，各至多 100 筆）。
create or replace function public.produce_name_suggestions(p_group text,p_market text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.active_user_id() is null or not public.produce_market_allowed(p_group,p_market) then
    raise exception using errcode='42501',message='目前帳號未開放所選市場的水果組交接簿';
  end if;
  return (with rows_all as (
      select l.value ->> 'product_name' product, l.value ->> 'supplier_code' supplier
        from public.produce_stock_handovers s cross join lateral jsonb_array_elements(s.lines) l(value)
        where s.group_code=p_group and s.market_code=p_market and s.status<>'void' and s.created_at>now()-interval '1 year'
      union all
      select l.value ->> 'product_name', l.value ->> 'supplier_code'
        from public.produce_scrap_reports s cross join lateral jsonb_array_elements(s.lines) l(value)
        where s.group_code=p_group and s.market_code=p_market and s.status<>'void' and s.created_at>now()-interval '1 year'
      union all
      select product_name, null from public.produce_release_slips
        where group_code=p_group and market_code=p_market and status<>'void' and created_at>now()-interval '1 year'),
    products as (select product v,count(*) c from rows_all where coalesce(product,'')<>'' group by product order by count(*) desc,product limit 100),
    suppliers as (select supplier v,count(*) c from rows_all where coalesce(supplier,'')<>'' group by supplier order by count(*) desc,supplier limit 100)
    select jsonb_build_object(
      'products',coalesce((select jsonb_agg(v order by c desc,v) from products),'[]'::jsonb),
      'suppliers',coalesce((select jsonb_agg(v order by c desc,v) from suppliers),'[]'::jsonb)));
end $$;

/* ───────────── RLS 與授權 ───────────── */

alter table public.produce_stock_handovers enable row level security;
alter table public.produce_stock_handovers force row level security;
alter table public.produce_scrap_reports enable row level security;
alter table public.produce_scrap_reports force row level security;
alter table public.produce_document_signatures enable row level security;
alter table public.produce_document_signatures force row level security;
alter table public.produce_release_slips enable row level security;
alter table public.produce_release_slips force row level security;
alter table public.produce_slip_counters enable row level security;
alter table public.produce_slip_counters force row level security;
revoke all on public.produce_stock_handovers,public.produce_scrap_reports,public.produce_document_signatures,
  public.produce_release_slips,public.produce_slip_counters from anon,authenticated;
grant select on public.produce_stock_handovers,public.produce_scrap_reports,public.produce_document_signatures,public.produce_release_slips to authenticated;

drop policy if exists produce_stock_read on public.produce_stock_handovers;
create policy produce_stock_read on public.produce_stock_handovers for select to authenticated using(public.produce_market_allowed(group_code,market_code));
drop policy if exists produce_scrap_read on public.produce_scrap_reports;
create policy produce_scrap_read on public.produce_scrap_reports for select to authenticated using(public.produce_market_allowed(group_code,market_code));
drop policy if exists produce_signature_read on public.produce_document_signatures;
create policy produce_signature_read on public.produce_document_signatures for select to authenticated using(public.produce_market_allowed(group_code,market_code));
drop policy if exists produce_slip_read on public.produce_release_slips;
create policy produce_slip_read on public.produce_release_slips for select to authenticated using(public.produce_market_allowed(group_code,market_code));

revoke all on function public.produce_normalize_lines(text,jsonb),public.produce_actor_name(uuid),
  public.produce_document_stage_allowed(uuid,text,text,text,uuid),public.produce_document_stage_order(text),
  public.produce_signature_gate(),public.produce_protect_signature(),public.produce_protect_document(),public.produce_protect_slip() from public,anon,authenticated;
revoke all on function public.produce_stock_save(text,text,uuid,date,text,jsonb),
  public.produce_scrap_save(text,text,uuid,date,text,text,text,text,jsonb),
  public.produce_doc_submit(text,text,text,uuid),public.produce_doc_void(text,text,text,uuid,text),
  public.produce_doc_sign(text,text,text,uuid,text,text),public.produce_stock_distribute(text,text,uuid,text),
  public.produce_slip_issue(text,text,text,timestamptz,text,text,text,text,text,text),
  public.produce_slip_void(text,text,uuid,text),public.produce_name_suggestions(text,text) from public,anon,authenticated;
grant execute on function public.produce_stock_save(text,text,uuid,date,text,jsonb),
  public.produce_scrap_save(text,text,uuid,date,text,text,text,text,jsonb),
  public.produce_doc_submit(text,text,text,uuid),public.produce_doc_void(text,text,text,uuid,text),
  public.produce_doc_sign(text,text,text,uuid,text,text),public.produce_stock_distribute(text,text,uuid,text),
  public.produce_slip_issue(text,text,text,timestamptz,text,text,text,text,text,text),
  public.produce_slip_void(text,text,uuid,text),public.produce_name_suggestions(text,text) to authenticated;

comment on table public.produce_stock_handovers is '水果組／蔬菜組存貨交接明細表（HOL-2-09）；明細以 jsonb 存放，不實體刪除';
comment on table public.produce_scrap_reports is '水果組／蔬菜組果菜報廢報告表（HEM-2-11）；明細以 jsonb 存放，不實體刪除';
comment on table public.produce_document_signatures is '存貨交接與報廢報告的簽核紀錄（小組長、組(副)長、主(副)任），不可改刪';
comment on table public.produce_release_slips is '果菜產地運回放行單；開立後不可改，只能作廢並留原因';

notify pgrst, 'reload schema';
commit;
