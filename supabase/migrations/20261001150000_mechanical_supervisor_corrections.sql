begin;

-- 主管事後修正採附加紀錄；已交接／簽核的原始工作與快照維持不可變。
create table if not exists public.mechanical_handover_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.mechanical_handover_entries(entry_id),
  market_code text not null check (market_code in ('market_1','market_2')),
  work_date date not null,
  before_values jsonb not null,
  after_values jsonb not null,
  corrected_by uuid not null references public.users(user_id),
  corrected_at timestamptz not null default clock_timestamp(),
  constraint mechanical_correction_changed check (before_values<>after_values)
);
create index if not exists mechanical_corrections_entry_time
  on public.mechanical_handover_corrections(entry_id,corrected_at desc,correction_id desc);
create index if not exists mechanical_corrections_market_day
  on public.mechanical_handover_corrections(market_code,work_date);

alter table public.mechanical_handover_corrections enable row level security;
alter table public.mechanical_handover_corrections force row level security;
revoke all on public.mechanical_handover_corrections from public,anon,authenticated;
grant select on public.mechanical_handover_corrections to authenticated;
drop policy if exists mechanical_corrections_read on public.mechanical_handover_corrections;
create policy mechanical_corrections_read on public.mechanical_handover_corrections
  for select to authenticated using (public.mechanical_market_allowed(market_code));

create or replace function public.mechanical_preserve_corrected_original()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.mechanical_handover_corrections c where c.entry_id=old.entry_id) then
    raise exception using errcode='23514',message='已有主管修正，原始工作紀錄不可覆寫';
  end if;
  return new;
end $$;
revoke all on function public.mechanical_preserve_corrected_original() from public,anon,authenticated;
drop trigger if exists trg_mechanical_preserve_corrected_original on public.mechanical_handover_entries;
create trigger trg_mechanical_preserve_corrected_original before update on public.mechanical_handover_entries
  for each row execute function public.mechanical_preserve_corrected_original();

create or replace function public.mechanical_supervisor_correct_entry(
  p_entry_id uuid,p_market_code text,p_work_item text,p_details text,p_result text,p_notes text,
  p_expected_correction uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := public.active_user_id();
  original public.mechanical_handover_entries%rowtype;
  previous public.mechanical_handover_corrections%rowtype;
  saved public.mechanical_handover_corrections%rowtype;
  before_data jsonb;
  after_data jsonb;
  normalized_item text := coalesce(btrim(p_work_item),'');
  normalized_details text := nullif(btrim(p_details),'');
  normalized_result text := btrim(p_result);
  normalized_notes text := nullif(btrim(p_notes),'');
begin
  if actor is null or not coalesce(public.mechanical_market_allowed(p_market_code),false)
    or not coalesce(public.can_approve_mechanical_handover(),false) then
    raise exception using errcode='42501',message='只有所屬市場機電課主管可修正報表';
  end if;
  if char_length(normalized_item)>300 or char_length(coalesce(normalized_details,''))>3000
    or char_length(coalesce(normalized_notes,''))>1000
    or (normalized_item='' and normalized_details is null)
    or normalized_result is null
    or normalized_result not in ('正常','已完成','處理中','待料','待廠商','交下班續辦','無法處理') then
    raise exception using errcode='22023',message='修正內容格式無效';
  end if;

  select * into original from public.mechanical_handover_entries
    where entry_id=p_entry_id and market_code=p_market_code and not is_deleted for update;
  if not found then
    raise exception using errcode='P0002',message='找不到可修正的工作紀錄';
  end if;
  select * into previous from public.mechanical_handover_corrections
    where entry_id=p_entry_id order by corrected_at desc,correction_id desc limit 1;
  if previous.correction_id is distinct from p_expected_correction then
    raise exception using errcode='40001',message='這筆紀錄已有新修正，請重新載入';
  end if;

  before_data := case when previous.correction_id is not null then previous.after_values
    else jsonb_build_object('work_item',original.work_item,'details',original.details,
      'result',original.result,'notes',original.notes) end;
  after_data := jsonb_build_object('work_item',normalized_item,'details',normalized_details,
    'result',normalized_result,'notes',normalized_notes);
  if before_data=after_data then
    raise exception using errcode='22023',message='內容沒有變更';
  end if;

  insert into public.mechanical_handover_corrections
    (entry_id,market_code,work_date,before_values,after_values,corrected_by)
    values (p_entry_id,p_market_code,original.work_date,before_data,after_data,actor)
    returning * into saved;
  -- 同一交易寫入中央稽核；任何失敗都會回滾本次修正。
  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
    values ('mechanical_handover_entries',p_entry_id::text,'update',
      jsonb_build_object('correction_id',saved.correction_id,'before',before_data,'after',after_data),
      actor,'mechanical-supervisor-correction');
  return to_jsonb(saved);
end $$;
revoke all on function public.mechanical_supervisor_correct_entry(uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.mechanical_supervisor_correct_entry(uuid,text,text,text,text,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
