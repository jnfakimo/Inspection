begin;

-- 主管依個資搜尋只記錄存取行為與結果數，不保存可反查的查詢原文或雜湊。
create table if not exists public.guard_incident_person_search_audit (
  search_id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(user_id),
  market_code text not null check (market_code in ('market_1','market_2')),
  search_field text not null check (search_field in ('name','id_number','phone')),
  date_from date not null,
  date_to date not null,
  result_count integer not null check (result_count between 0 and 100),
  searched_at timestamptz not null default clock_timestamp(),
  constraint guard_person_search_date_check check (date_to>=date_from)
);
create index if not exists guard_person_search_actor_time
  on public.guard_incident_person_search_audit(actor_id,searched_at desc);
alter table public.guard_incident_person_search_audit enable row level security;
alter table public.guard_incident_person_search_audit force row level security;
revoke all on public.guard_incident_person_search_audit from public,anon,authenticated;
grant select,insert on public.guard_incident_person_search_audit to service_role;
drop trigger if exists trg_prevent_removal on public.guard_incident_person_search_audit;
create trigger trg_prevent_removal before delete or truncate on public.guard_incident_person_search_audit
  for each statement execute function public.reject_physical_data_removal();

-- 原主管修正函式會白名單重建事件 JSON；加入相關人員並逐欄驗證，防止修正時遺失個資。
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
  person jsonb;
  point jsonb;
  normalized_people jsonb;
  normalized_events jsonb := '[]'::jsonb;
  normalized_items jsonb := '[]'::jsonb;
  original_events jsonb := '[]'::jsonb;
  before_data jsonb;
  after_data jsonb;
  summary text;
  notes text;
  person_name text;
  person_id text;
  person_phone text;
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
      or coalesce(jsonb_typeof(event->'reported_upward'),'null') not in ('boolean','null')
      or coalesce(jsonb_typeof(event->'persons'),'array')<>'array' then
      raise exception using errcode='22023',message='異常事件修正內容無效';
    end if;
    normalized_people := '[]'::jsonb;
    if jsonb_array_length(coalesce(event->'persons','[]'::jsonb))>10 then
      raise exception using errcode='22023',message='每件異常事件最多 10 位相關人員';
    end if;
    for person in select value from jsonb_array_elements(coalesce(event->'persons','[]'::jsonb)) loop
      if jsonb_typeof(person)<>'object' then
        raise exception using errcode='22023',message='相關人員資料格式無效';
      end if;
      person_name := btrim(person->>'name');
      person_id := upper(coalesce(btrim(person->>'id_number'),''));
      person_phone := coalesce(btrim(person->>'phone'),'');
      if person_name is null or person_name='' or char_length(person_name)>40
        or (person_id<>'' and person_id !~ '^[A-Z][12][0-9]{8}$')
        or (person_phone<>'' and (person_phone !~ '^[+0-9][0-9 ()-]{5,23}$'
          or regexp_replace(person_phone,'[^0-9]','','g') !~ '^[0-9]{8,15}$')) then
        raise exception using errcode='22023',message='相關人員姓名、身分證字號或電話格式無效';
      end if;
      normalized_people := normalized_people || jsonb_build_array(jsonb_build_object(
        'name',person_name,'id_number',person_id,'phone',person_phone));
    end loop;
    normalized_events := normalized_events || jsonb_build_array(jsonb_build_object(
      'id',event->>'id','time',event->>'time','location',coalesce(btrim(event->>'location'),''),
      'category',btrim(event->>'category'),'description',btrim(event->>'description'),
      'action',coalesce(btrim(event->>'action'),''),'reported_to',coalesce(btrim(event->>'reported_to'),''),
      'persons',normalized_people,'handover_item',event->'handover_item','reported_upward',event->'reported_upward'));
    event_index := event_index+1;
  end loop;
  for event in select value from jsonb_array_elements(original.incidents) loop
    original_events := original_events || jsonb_build_array(jsonb_build_object(
      'id',event->>'id','time',event->>'time','location',coalesce(event->>'location',''),
      'category',event->>'category','description',event->>'description',
      'action',coalesce(event->>'action',''),'reported_to',coalesce(event->>'reported_to',''),
      'persons',coalesce(event->'persons','[]'::jsonb),
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

-- 搜尋只從後端 service role 呼叫；每班只取最後一版主管修正，避免舊版個資混入結果。
create or replace function public.guard_incident_search_rows(p_market text,p_from date,p_to date)
returns table(log_id uuid,duty_date date,shift_name text,status text,incidents jsonb)
language sql stable security definer set search_path='' as $$
  select l.log_id,l.duty_date,l.shift_name,l.status,
    coalesce(c.after_values->'incidents',l.incidents) as incidents
  from public.guard_handover_logs l
  left join lateral (
    select correction.after_values from public.guard_handover_corrections correction
    where correction.log_id=l.log_id
    order by correction.corrected_at desc,correction.correction_id desc limit 1
  ) c on true
  where l.market_code=p_market and l.duty_date between p_from and p_to and l.status<>'draft'
  order by l.duty_date desc,l.shift_order
  limit 901
$$;
revoke all on function public.guard_incident_search_rows(text,date,date) from public,anon,authenticated;
grant execute on function public.guard_incident_search_rows(text,date,date) to service_role;

notify pgrst,'reload schema';
commit;
