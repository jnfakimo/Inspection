begin;

-- 主管修正只改報表呈現；原始交接、雙方簽名、巡邏快照及每日簽核均保留。
create table if not exists public.guard_handover_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  log_id uuid not null references public.guard_handover_logs(log_id),
  market_code text not null check (market_code in ('market_1','market_2')),
  duty_date date not null,
  before_values jsonb not null,
  after_values jsonb not null,
  corrected_by uuid not null references public.users(user_id),
  corrected_at timestamptz not null default clock_timestamp(),
  constraint guard_correction_changed check (before_values<>after_values)
);
create index if not exists guard_corrections_log_time
  on public.guard_handover_corrections(log_id,corrected_at desc,correction_id desc);
create index if not exists guard_corrections_market_day
  on public.guard_handover_corrections(market_code,duty_date);

alter table public.guard_handover_corrections enable row level security;
alter table public.guard_handover_corrections force row level security;
revoke all on public.guard_handover_corrections from public,anon,authenticated;
grant select on public.guard_handover_corrections to authenticated;
drop policy if exists guard_corrections_read on public.guard_handover_corrections;
create policy guard_corrections_read on public.guard_handover_corrections
  for select to authenticated using (public.guard_market_allowed(market_code));

create or replace function public.guard_correction_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='23514',message='主管修正紀錄不可修改或刪除';
end $$;
revoke all on function public.guard_correction_immutable() from public,anon,authenticated;
drop trigger if exists trg_guard_correction_immutable on public.guard_handover_corrections;
create trigger trg_guard_correction_immutable before update or delete on public.guard_handover_corrections
  for each row execute function public.guard_correction_immutable();
drop trigger if exists trg_prevent_removal on public.guard_handover_corrections;
create trigger trg_prevent_removal before delete or truncate on public.guard_handover_corrections
  for each statement execute function public.reject_physical_data_removal();

-- 與 app-api 的 canGuardApprove 一致：主管簽核子系統須明確允許，不能靠「沿用」。
create or replace function public.guard_supervisor_correction_allowed(p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select public.active_user_id() is not null and public.guard_market_allowed(p_market)
    and (public.active_rbac_role()='sysadmin' or (
      public.has_system_access('sys_handover') and coalesce(
        (select case uma.mode when 'allow' then true when 'deny' then false else null end
          from public.user_module_access uma where uma.user_id=public.active_user_id()
            and uma.system_key='handover' and uma.module_key='guard-approve' limit 1),
        (select rma.mode='allow' from public.role_module_access rma
          where rma.role_id=public.active_rbac_role() and rma.system_key='handover'
            and rma.module_key='guard-approve' limit 1),false)))
$$;
revoke all on function public.guard_supervisor_correction_allowed(text) from public,anon;
grant execute on function public.guard_supervisor_correction_allowed(text) to authenticated,service_role;

-- 已經有主管修正的原件禁止再改內容；交班、撤回及接班狀態轉換仍可進行。
create or replace function public.guard_preserve_corrected_original()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.guard_handover_corrections c where c.log_id=old.log_id)
    and (to_jsonb(new)-array['status','handover_by','handover_at','receiver_id',
      'takeover_by','takeover_at','patrol_snapshot','updated_by','updated_at'])
      is distinct from (to_jsonb(old)-array['status','handover_by','handover_at','receiver_id',
      'takeover_by','takeover_at','patrol_snapshot','updated_by','updated_at']) then
    raise exception using errcode='23514',message='已有主管修正，原始交接內容不可覆寫';
  end if;
  return new;
end $$;
revoke all on function public.guard_preserve_corrected_original() from public,anon,authenticated;
drop trigger if exists trg_guard_preserve_corrected_original on public.guard_handover_logs;
create trigger trg_guard_preserve_corrected_original before update on public.guard_handover_logs
  for each row execute function public.guard_preserve_corrected_original();

create or replace function public.guard_supervisor_correct_log(
  p_log_id uuid,p_market_code text,p_after jsonb,p_expected_updated_at timestamptz,
  p_expected_correction uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := public.active_user_id();
  original public.guard_handover_logs%rowtype;
  previous public.guard_handover_corrections%rowtype;
  saved public.guard_handover_corrections%rowtype;
  event jsonb;
  point jsonb;
  normalized_events jsonb := '[]'::jsonb;
  normalized_items jsonb := '[]'::jsonb;
  original_events jsonb := '[]'::jsonb;
  before_data jsonb;
  after_data jsonb;
  summary text;
  notes text;
  event_index integer := 0;
  qty integer;
begin
  if actor is null or not coalesce(public.guard_supervisor_correction_allowed(p_market_code),false) then
    raise exception using errcode='42501',message='只有所屬市場駐警隊主管可修正報表';
  end if;
  if p_after is null or jsonb_typeof(p_after)<>'object'
    or jsonb_typeof(p_after->'incidents')<>'array'
    or jsonb_typeof(p_after->'items')<>'array' then
    raise exception using errcode='22023',message='修正內容格式無效';
  end if;
  summary := btrim(p_after->>'duty_summary');
  notes := coalesce(btrim(p_after->>'important_notes'),'');
  if summary is null or summary='' or char_length(summary)>4000 or char_length(notes)>4000
    or jsonb_array_length(p_after->'incidents')>50 or jsonb_array_length(p_after->'items')>40 then
    raise exception using errcode='22023',message='修正內容格式無效';
  end if;

  select * into original from public.guard_handover_logs
    where log_id=p_log_id and market_code=p_market_code for update;
  if not found then raise exception using errcode='P0002',message='找不到可修正的交接紀錄'; end if;
  if original.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='交接原件已變更，請重新載入';
  end if;
  if jsonb_array_length(p_after->'incidents')<>jsonb_array_length(original.incidents) then
    raise exception using errcode='22023',message='主管修正不可新增或移除異常事件';
  end if;
  for event in select value from jsonb_array_elements(p_after->'incidents') loop
    if jsonb_typeof(event)<>'object' or event->>'id' is distinct from original.incidents->event_index->>'id'
      or coalesce(event->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(event->>'time','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'
      or coalesce(btrim(event->>'category'),'')=''
      or coalesce(btrim(event->>'description'),'')=''
      or char_length(coalesce(event->>'location',''))>100
      or char_length(event->>'category')>40 or char_length(event->>'description')>2000
      or char_length(coalesce(event->>'action',''))>2000
      or char_length(coalesce(event->>'reported_to',''))>100
      or coalesce(jsonb_typeof(event->'handover_item'),'null') not in ('boolean','null')
      or coalesce(jsonb_typeof(event->'reported_upward'),'null') not in ('boolean','null') then
      raise exception using errcode='22023',message='異常事件修正內容無效';
    end if;
    normalized_events := normalized_events || jsonb_build_array(jsonb_build_object(
      'id',event->>'id','time',event->>'time','location',coalesce(btrim(event->>'location'),''),
      'category',btrim(event->>'category'),'description',btrim(event->>'description'),
      'action',coalesce(btrim(event->>'action'),''),'reported_to',coalesce(btrim(event->>'reported_to'),''),
      'handover_item',event->'handover_item','reported_upward',event->'reported_upward'));
    event_index := event_index+1;
  end loop;
  for event in select value from jsonb_array_elements(original.incidents) loop
    original_events := original_events || jsonb_build_array(jsonb_build_object(
      'id',event->>'id','time',event->>'time','location',coalesce(event->>'location',''),
      'category',event->>'category','description',event->>'description',
      'action',coalesce(event->>'action',''),'reported_to',coalesce(event->>'reported_to',''),
      'handover_item',null,'reported_upward',null));
  end loop;
  for point in select value from jsonb_array_elements(p_after->'items') loop
    if jsonb_typeof(point)<>'object' or coalesce(btrim(point->>'name'),'')=''
      or coalesce(btrim(point->>'condition'),'')=''
      or coalesce(point->>'qty','') !~ '^[0-9]{1,3}$'
      or char_length(point->>'name')>50 or char_length(point->>'condition')>20
      or char_length(coalesce(point->>'note',''))>200 then
      raise exception using errcode='22023',message='物品點交修正內容無效';
    end if;
    qty := (point->>'qty')::integer;
    if qty>999 then raise exception using errcode='22023',message='物品點交數量無效'; end if;
    normalized_items := normalized_items || jsonb_build_array(jsonb_build_object(
      'name',btrim(point->>'name'),'qty',qty,'condition',btrim(point->>'condition'),
      'note',coalesce(btrim(point->>'note'),'')));
  end loop;
  select * into previous from public.guard_handover_corrections
    where log_id=p_log_id order by corrected_at desc,correction_id desc limit 1;
  if previous.correction_id is distinct from p_expected_correction then
    raise exception using errcode='40001',message='這筆交接已有新修正，請重新載入';
  end if;
  before_data := case when previous.correction_id is not null then previous.after_values
    else jsonb_build_object('duty_summary',original.duty_summary,'important_notes',original.important_notes,
      'incidents',original_events,'items',original.items) end;
  after_data := jsonb_build_object('duty_summary',summary,'important_notes',notes,
    'incidents',normalized_events,'items',normalized_items);
  if before_data=after_data then raise exception using errcode='22023',message='內容沒有變更'; end if;
  insert into public.guard_handover_corrections
    (log_id,market_code,duty_date,before_values,after_values,corrected_by)
    values (p_log_id,p_market_code,original.duty_date,before_data,after_data,actor)
    returning * into saved;
  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
    values ('guard_handover_logs',p_log_id::text,'update',
      jsonb_build_object('correction_id',saved.correction_id,'before',before_data,'after',after_data),
      actor,'guard-supervisor-correction');
  return to_jsonb(saved);
end $$;
revoke all on function public.guard_supervisor_correct_log(uuid,text,jsonb,timestamptz,uuid) from public,anon;
grant execute on function public.guard_supervisor_correct_log(uuid,text,jsonb,timestamptz,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
