-- 巡檢排班改為市場感知（草稿，2026-10-27 尚未套用正式庫）。
--
-- 20261001160000 替二市複製了一組同名、無人員的班別範本，但排班函式仍以
-- (shift_date, name) 判斷同一班、套用全部範本時不分市場。於是「重新套用全部範本」
-- 會先寫入一市人員、再被排在後面的二市空白範本覆蓋成空陣列，
-- patrol_shift_staff 的同名設定也一併被清空。
--
-- 本移轉依 20260916120000 註明的順序，於排班函式改為市場感知時切換複合唯一鍵：
-- - patrol_shifts 唯一鍵改為 (market_code, shift_date, name)。
-- - 套用、儲存、批次清除都只處理指定市場；未指定時沿用 market_1，舊呼叫端行為不變。
-- - system_settings 的 patrol_shift_staff（排定人員與通報時段）目前只屬一市，
--   與 app-api guardShiftContext 的既有規則相同；二市只寫班別資料列本身，不碰這份設定。
-- - patrol_shift_day_status 主鍵仍是 duty_date，停用／恢復當日班表只作用於一市；
--   二市的停班狀態需另行改主鍵，不在本次範圍。
-- 只改函式與索引，不更新、不刪除任何既有資料列。
--
-- 部署順序：先套用本移轉，再部署 app-api／patrol-timeout-check，最後部署前端。
-- 新函式的 p_market 都有預設值，舊版前端與 app-api 在過渡期間仍可呼叫；
-- 反過來先上前端，帶 p_market 的 RPC 會因為找不到函式而失敗。
-- tools/apply-patrol-shift-release.ps1 驗證的是 2026-09-14 那批函式的舊簽章，本移轉之後不可再用它重跑。
-- 驗證：node --test tools/patrol-market-scope-db.test.mjs
begin;

-- 正式庫目前 patrol_shifts 全為 market_1，舊唯一鍵已保證不重複；仍先確認再切換。
do $$
begin
  if exists (
    select 1 from public.patrol_shifts
    group by market_code, shift_date, name having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'patrol_shifts 已有同市場、同日、同名的重複班別，請先處理再切換唯一鍵';
  end if;
end $$;

create unique index if not exists idx_patrol_shifts_market_date_name
  on public.patrol_shifts(market_code, shift_date, name);
drop index if exists public.idx_patrol_shifts_date_name;

create or replace function public.patrol_market_or_default(p_market text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_market text := coalesce(nullif(btrim(coalesce(p_market, '')), ''), 'market_1');
begin
  if v_market not in ('market_1', 'market_2') then
    raise exception using errcode = '22023', message = '市場代碼無效';
  end if;
  return v_market;
end $$;
revoke all on function public.patrol_market_or_default(text) from public, anon, authenticated;
grant execute on function public.patrol_market_or_default(text) to service_role;

-- ── 單一範本套用到期間：市場取自範本本身 ──────────────────────────────────
create or replace function public.apply_patrol_shift_template_range(
  p_template_id uuid, p_from date, p_to date
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_tpl          record;
  v_day          date;
  v_storage_day  date;
  v_count        integer := 0;
  v_staff        jsonb;
  v_work         jsonb;
  v_op           uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢排班';
  end if;
  if p_from is null or p_to is null then
    raise exception using errcode = '22023', message = '請指定套用的起訖日期';
  end if;
  if p_to < p_from then
    raise exception using errcode = '22023', message = '迄日不可早於起日';
  end if;
  if (p_to - p_from) > 365 then
    raise exception using errcode = '22023', message = '一次最多只能套用 366 天';
  end if;

  select * into v_tpl from public.patrol_shift_template where template_id = p_template_id;
  if not found then
    raise exception using errcode = '02000', message = '找不到這個班別範本';
  end if;
  if coalesce(v_tpl.status, 'active') = 'inactive' then
    raise exception using errcode = '22023', message = '這個班別範本已刪除，不能套用';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t.id)), '[]'::jsonb)
  into v_staff
  from unnest(coalesce(v_tpl.assigned_user_ids, '{}'::uuid[])) as t(id);

  select coalesce(
           nullif(btrim(coalesce(value, '')), '')::jsonb #> array['workTimes', 'templates', v_tpl.name],
           '{}'::jsonb)
  into v_work
  from public.system_settings
  where key = 'patrol_shift_staff';

  v_day := p_from;
  while v_day <= p_to loop
    -- 夜班顯示在前一日，但 00:00–08:00 的實際資料屬於隔日。
    v_storage_day := case
      when replace(coalesce(v_tpl.name, ''), ' ', '') ~* '(夜班|night)' then v_day + 1
      else v_day
    end;

    insert into public.patrol_shifts (market_code, shift_date, name, start_time, end_time, sort_order, assigned_user_ids)
    values (v_tpl.market_code, v_storage_day, v_tpl.name, v_tpl.start_time, v_tpl.end_time,
            coalesce(v_tpl.sort_order, 0), coalesce(v_tpl.assigned_user_ids, '{}'::uuid[]))
    on conflict (market_code, shift_date, name) do update
    set start_time        = excluded.start_time,
        end_time          = excluded.end_time,
        sort_order        = excluded.sort_order,
        assigned_user_ids = excluded.assigned_user_ids;

    -- patrol_shift_staff 以班名為鍵、只屬一市；二市寫入會覆蓋一市同名班別的人員與通報時段。
    if v_tpl.market_code = 'market_1' then
      perform public.patrol_staff_config_apply(
        'date', to_char(v_storage_day, 'YYYY-MM-DD'), v_tpl.name, v_staff,
        nullif(coalesce(v_work->>'start', ''), ''), nullif(coalesce(v_work->>'end', ''), ''));
    end if;

    v_count := v_count + 1;
    v_day := v_day + 1;
  end loop;

  select user_id into v_op from public.users where auth_id = auth.uid() and status = 'active';
  insert into public.audit_logs (table_name, record_id, action, changes, operator_id, source)
  values ('patrol_shifts', p_template_id::text, 'insert',
          jsonb_build_object('template', v_tpl.name, 'market_code', v_tpl.market_code, 'from', p_from, 'to', p_to,
                             'days', v_count, 'night_shift_storage', 'next_calendar_day'),
          v_op, 'v2-patrol-range');

  return v_count;
end;
$$;
revoke all on function public.apply_patrol_shift_template_range(uuid, date, date) from public, anon;
grant execute on function public.apply_patrol_shift_template_range(uuid, date, date) to authenticated;

-- ── 套用全部範本：只套用指定市場 ────────────────────────────────────────
-- 增加參數會產生新的多載；舊的兩參數版本若保留，兩參數呼叫就會有歧義，所以先移除。
drop function if exists public.apply_all_patrol_shift_templates_and_activate(date, date);
drop function if exists public.apply_all_patrol_shift_templates_range(date, date);

create or replace function public.apply_all_patrol_shift_templates_range(
  p_from date, p_to date, p_market text default 'market_1'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_market text := public.patrol_market_or_default(p_market);
  v_template record;
  v_template_count integer := 0;
  v_rows integer := 0;
  v_days integer;
  v_operator uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以套用巡檢班別範本';
  end if;
  if p_from is null or p_to is null then
    raise exception using errcode = '22023', message = '請指定套用的起訖日期';
  end if;
  if p_from < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023', message = '只能從今天或未來日期套用，過去班表必須保留';
  end if;
  if p_to < p_from then
    raise exception using errcode = '22023', message = '迄日不可早於起日';
  end if;
  if (p_to - p_from) > 365 then
    raise exception using errcode = '22023', message = '一次最多只能套用 366 天';
  end if;

  v_days := p_to - p_from + 1;
  for v_template in
    select template_id
    from public.patrol_shift_template
    where coalesce(status, 'active') <> 'inactive'
      and market_code = v_market
    order by sort_order, template_id
  loop
    v_rows := v_rows + public.apply_patrol_shift_template_range(v_template.template_id, p_from, p_to);
    v_template_count := v_template_count + 1;
  end loop;
  if v_template_count = 0 then
    raise exception using errcode = '22023', message = '目前沒有啟用中的班別範本';
  end if;

  select user_id into v_operator
  from public.users
  where auth_id = auth.uid() and status = 'active';
  insert into public.audit_logs(table_name, record_id, action, changes, operator_id, source)
  values (
    'patrol_shifts', to_char(p_from, 'YYYY-MM-DD') || '..' || to_char(p_to, 'YYYY-MM-DD'), 'insert',
    jsonb_build_object('operation', 'apply_all_templates', 'market_code', v_market, 'from', p_from, 'to', p_to,
      'templates', v_template_count, 'days', v_days, 'rows', v_rows),
    v_operator, 'v2-patrol-apply-all'
  );

  return jsonb_build_object('market_code', v_market, 'templates', v_template_count, 'days', v_days, 'rows', v_rows);
end;
$$;
revoke all on function public.apply_all_patrol_shift_templates_range(date, date, text) from public, anon;
grant execute on function public.apply_all_patrol_shift_templates_range(date, date, text) to authenticated;
comment on function public.apply_all_patrol_shift_templates_range(date, date, text) is
  '依市場套用全部啟用中的巡檢班別範本；未指定市場時為 market_1。';

create or replace function public.apply_all_patrol_shift_templates_and_activate(
  p_from date, p_to date, p_market text default 'market_1'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_market text := public.patrol_market_or_default(p_market);
  v_result jsonb;
  v_operator uuid;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='只有系統管理者可以套用巡檢班別範本'; end if;
  v_result := public.apply_all_patrol_shift_templates_range(p_from, p_to, v_market);
  -- patrol_shift_day_status 主鍵只有 duty_date，目前只代表一市；二市不改停班狀態。
  if v_market <> 'market_1' then
    return v_result || jsonb_build_object('day_status_updated', false);
  end if;
  select user_id into v_operator from public.users where auth_id=auth.uid() and status='active';
  insert into public.patrol_shift_day_status(duty_date,status,reason,updated_by,updated_at)
  select day::date,'active','已重新套用全部班別範本',v_operator,now()
  from generate_series(p_from,p_to,'1 day'::interval) day
  on conflict(duty_date) do update set status='active',reason=excluded.reason,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
  values('patrol_shift_day_status',p_from::text||'..'||p_to::text,'status_change',
    jsonb_build_object('status','active','market_code',v_market,'from',p_from,'to',p_to,'apply_result',v_result),
    v_operator,'v2-patrol-activate-range');
  return v_result || jsonb_build_object('day_status_updated', true);
end;
$$;
revoke all on function public.apply_all_patrol_shift_templates_and_activate(date, date, text) from public, anon;
grant execute on function public.apply_all_patrol_shift_templates_and_activate(date, date, text) to authenticated;

-- ── 儲存單日班別：寫入指定市場 ──────────────────────────────────────────
drop function if exists public.save_patrol_shift(date, text, time, time, integer, jsonb, text, text);
create or replace function public.save_patrol_shift(
  p_shift_date date, p_name text, p_start_time time, p_end_time time, p_sort_order integer,
  p_staff jsonb, p_work_start text, p_work_end text, p_market text default 'market_1'
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_market text := public.patrol_market_or_default(p_market);
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢排班';
  end if;

  insert into public.patrol_shifts (market_code, shift_date, name, start_time, end_time, sort_order, assigned_user_ids)
  values (v_market, p_shift_date, p_name, p_start_time, p_end_time, coalesce(p_sort_order, 0),
          public.patrol_staff_uuid_array(p_staff))
  on conflict (market_code, shift_date, name) do update
  set start_time        = excluded.start_time,
      end_time          = excluded.end_time,
      sort_order        = excluded.sort_order,
      assigned_user_ids = excluded.assigned_user_ids;

  if v_market = 'market_1' then
    perform public.patrol_staff_config_apply(
      'date', to_char(p_shift_date, 'YYYY-MM-DD'), p_name, p_staff, p_work_start, p_work_end);
  end if;
end;
$$;
revoke all on function public.save_patrol_shift(date, text, time, time, integer, jsonb, text, text, text) from public, anon;
grant execute on function public.save_patrol_shift(date, text, time, time, integer, jsonb, text, text, text) to authenticated;

-- ── 儲存班別範本：新增時寫入指定市場；修改時沿用範本原本的市場 ─────────────
drop function if exists public.save_patrol_shift_template(uuid, text, time, time, integer, jsonb, text, text);
create or replace function public.save_patrol_shift_template(
  p_template_id uuid, p_name text, p_start_time time, p_end_time time, p_sort_order integer,
  p_staff jsonb, p_work_start text, p_work_end text, p_market text default 'market_1'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_market text := public.patrol_market_or_default(p_market);
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢班別範本';
  end if;

  if p_template_id is null then
    insert into public.patrol_shift_template (market_code, name, start_time, end_time, sort_order, assigned_user_ids)
    values (v_market, p_name, p_start_time, p_end_time, coalesce(p_sort_order, 0),
            public.patrol_staff_uuid_array(p_staff))
    returning template_id into v_id;
  else
    update public.patrol_shift_template
    set name = p_name, start_time = p_start_time, end_time = p_end_time,
        sort_order = coalesce(p_sort_order, sort_order),
        assigned_user_ids = public.patrol_staff_uuid_array(p_staff)
    where template_id = p_template_id
    returning template_id, market_code into v_id, v_market;

    if v_id is null then
      raise exception using errcode = '02000', message = '找不到這個班別範本';
    end if;
  end if;

  if v_market = 'market_1' then
    perform public.patrol_staff_config_apply(
      'template', null, p_name, p_staff, p_work_start, p_work_end);
  end if;

  return v_id;
end;
$$;
revoke all on function public.save_patrol_shift_template(uuid, text, time, time, integer, jsonb, text, text, text) from public, anon;
grant execute on function public.save_patrol_shift_template(uuid, text, time, time, integer, jsonb, text, text, text) to authenticated;

-- ── 清除當日及未來班別：只清指定市場 ────────────────────────────────────
drop function if exists public.reset_patrol_shifts_from_date(date, uuid[]);
drop function if exists public.soft_delete_patrol_shifts_from_date(date, uuid[]);

create or replace function public.soft_delete_patrol_shifts_from_date(
  p_from date, p_duty_shift_ids uuid[] default '{}'::uuid[], p_market text default 'market_1'
) returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_market text := public.patrol_market_or_default(p_market);
  v_shift record;
  v_hidden_name text;
  v_operator uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以清除巡檢班別';
  end if;
  if p_from is null then
    raise exception using errcode = '22023', message = '請指定清除起始值班日';
  end if;
  if p_from < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023', message = '只能清除今天或未來的班別，過去班表必須保留';
  end if;

  select user_id into v_operator
  from public.users
  where auth_id = auth.uid() and status = 'active';
  if v_operator is null then
    raise exception using errcode = '42501', message = '找不到有效的操作人員';
  end if;

  for v_shift in
    select shift_id, shift_date, name, assigned_user_ids
    from public.patrol_shifts
    where market_code = v_market
      and name not like '[已刪除]%'
      and (
        shift_date > p_from
        or (
          shift_date = p_from
          and (
            replace(coalesce(name, ''), ' ', '') !~* '(夜班|night)'
            or shift_id = any(coalesce(p_duty_shift_ids, '{}'::uuid[]))
          )
        )
      )
    order by shift_date, shift_id
    for update
  loop
    v_hidden_name := '[已刪除] ' || v_shift.name || ' ' || substr(v_shift.shift_id::text, 1, 8);
    update public.patrol_shifts
    set name = v_hidden_name,
        assigned_user_ids = '{}'::uuid[]
    where shift_id = v_shift.shift_id;

    insert into public.audit_logs(table_name, record_id, action, changes, operator_id, source)
    values (
      'patrol_shifts', v_shift.shift_id::text, 'update',
      jsonb_build_object(
        'before', jsonb_build_object(
          'shift_date', v_shift.shift_date,
          'name', v_shift.name,
          'assigned_user_ids', to_jsonb(v_shift.assigned_user_ids)
        ),
        'after', jsonb_build_object(
          'shift_date', v_shift.shift_date,
          'name', v_hidden_name,
          'assigned_user_ids', '[]'::jsonb,
          'bulk_from_date', p_from,
          'market_code', v_market
        )
      ),
      v_operator, 'v2-patrol-bulk-reset'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.soft_delete_patrol_shifts_from_date(date, uuid[], text) from public, anon;
grant execute on function public.soft_delete_patrol_shifts_from_date(date, uuid[], text) to authenticated;

create or replace function public.reset_patrol_shifts_from_date(
  p_from date, p_duty_shift_ids uuid[] default '{}'::uuid[], p_market text default 'market_1'
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_market text := public.patrol_market_or_default(p_market);
  v_operator uuid;
  v_until date;
  v_count integer;
  v_days integer;
begin
  if not public.is_admin() then raise exception using errcode='42501',message='只有系統管理者可以清除巡檢班別'; end if;
  if p_from is null or p_from < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode='22023',message='只能清除今天或未來的班別，過去班表必須保留';
  end if;
  select user_id into v_operator from public.users where auth_id=auth.uid() and status='active';
  if v_operator is null then raise exception using errcode='42501',message='找不到有效的操作人員'; end if;

  select greatest(p_from,coalesce(max(case when replace(coalesce(name,''),' ','') ~* '(夜班|night)'
    then shift_date-1 else shift_date end),p_from)) into v_until
  from public.patrol_shifts where market_code=v_market and shift_date>=p_from and name not like '[已刪除]%';
  v_count := public.soft_delete_patrol_shifts_from_date(p_from,p_duty_shift_ids,v_market);
  v_days := v_until-p_from+1;

  -- patrol_shift_day_status 主鍵只有 duty_date，目前只代表一市。
  if v_market = 'market_1' then
    insert into public.patrol_shift_day_status(duty_date,status,reason,updated_by,updated_at)
    select day::date,'suspended','批次清除每日班別，等待重新套用範本',v_operator,now()
    from generate_series(p_from,v_until,'1 day'::interval) day
    on conflict(duty_date) do update set status='suspended',reason=excluded.reason,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;
    insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
    values('patrol_shift_day_status',p_from::text||'..'||v_until::text,'status_change',
      jsonb_build_object('status','suspended','market_code',v_market,'from',p_from,'to',v_until,'days',v_days,'deleted_shifts',v_count),
      v_operator,'v2-patrol-bulk-reset');
  end if;
  return jsonb_build_object('market_code',v_market,'count',v_count,'from_date',p_from,'to_date',v_until,
    'suspended_days',case when v_market='market_1' then v_days else 0 end);
end;
$$;
revoke all on function public.reset_patrol_shifts_from_date(date, uuid[], text) from public, anon;
grant execute on function public.reset_patrol_shifts_from_date(date, uuid[], text) to authenticated;

notify pgrst, 'reload schema';
commit;
