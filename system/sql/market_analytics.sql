-- ============================================================
-- 市場營運分析：可配置交易行情資料與分析模板
-- 不把品項、價格或市場寫死；來源欄位與每筆資料均以 JSONB 保存。
-- 本檔可重複執行，請在 permanent_data_protection.sql 前套用。
-- ============================================================

begin;

create table if not exists market_data_sources (
  source_id          uuid primary key default gen_random_uuid(),
  source_code        text not null unique check (source_code ~ '^[a-z][a-z0-9_-]{1,59}$'),
  source_name        text not null,
  source_type        text not null default 'manual'
                     check (source_type in ('manual','csv','json','api')),
  endpoint_url       text,
  field_definitions  jsonb not null default '[]'::jsonb,
  config             jsonb not null default '{}'::jsonb,
  status             text not null default 'active'
                     check (status in ('active','inactive')),
  created_by         uuid references users(user_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists market_data_points (
  point_id       uuid primary key default gen_random_uuid(),
  source_id      uuid not null references market_data_sources(source_id),
  observed_on    date not null,
  dimensions     jsonb not null default '{}'::jsonb,
  measures       jsonb not null default '{}'::jsonb,
  metadata       jsonb not null default '{}'::jsonb,
  external_key   text,
  imported_by    uuid references users(user_id),
  created_at     timestamptz not null default now()
);

create table if not exists market_analysis_templates (
  template_id       uuid primary key default gen_random_uuid(),
  template_code     text not null unique check (template_code ~ '^[a-z][a-z0-9_-]{1,59}$'),
  template_name     text not null,
  description       text,
  source_id         uuid references market_data_sources(source_id),
  dimensions       jsonb not null default '[]'::jsonb,
  measures         jsonb not null default '[]'::jsonb,
  chart_type       text not null default 'bar'
                   constraint market_analysis_templates_chart_type_check
                   check (chart_type in ('bar','pie','doughnut','line','area','table','cards')),
  default_config    jsonb not null default '{}'::jsonb,
  status            text not null default 'active'
                   check (status in ('active','inactive')),
  created_by        uuid references users(user_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists market_simulation_runs (
  simulation_id    uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  source_id        uuid not null references market_data_sources(source_id),
  period_from      date not null,
  period_to        date not null check (period_to >= period_from),
  base_totals      jsonb not null check (jsonb_typeof(base_totals) = 'object'),
  assumptions      jsonb not null check (jsonb_typeof(assumptions) = 'object'),
  projected_totals jsonb not null check (jsonb_typeof(projected_totals) = 'object'),
  created_by       uuid not null references users(user_id),
  created_at       timestamptz not null default now(),
  status           text not null default 'completed' check (status in ('draft','completed'))
);

-- create table if not exists 不會補齊已存在資料表的欄位。
alter table market_simulation_runs add column if not exists simulation_id uuid default gen_random_uuid();
alter table market_simulation_runs add column if not exists name text not null;
alter table market_simulation_runs add column if not exists source_id uuid not null references market_data_sources(source_id);
alter table market_simulation_runs add column if not exists period_from date not null;
alter table market_simulation_runs add column if not exists period_to date not null;
alter table market_simulation_runs add column if not exists base_totals jsonb not null;
alter table market_simulation_runs add column if not exists assumptions jsonb not null;
alter table market_simulation_runs add column if not exists projected_totals jsonb not null;
alter table market_simulation_runs add column if not exists created_by uuid not null references users(user_id);
alter table market_simulation_runs add column if not exists created_at timestamptz not null default now();
alter table market_simulation_runs add column if not exists status text not null default 'completed';

-- 既有環境補欄位，不重建或覆寫既有資料。
alter table market_data_sources add column if not exists endpoint_url text;
alter table market_data_sources add column if not exists field_definitions jsonb not null default '[]'::jsonb;
alter table market_data_sources add column if not exists config jsonb not null default '{}'::jsonb;
alter table market_data_sources add column if not exists updated_at timestamptz not null default now();
alter table market_data_points add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table market_data_points add column if not exists external_key text;
alter table market_analysis_templates add column if not exists default_config jsonb not null default '{}'::jsonb;
alter table market_analysis_templates add column if not exists updated_at timestamptz not null default now();

-- create table if not exists 不會更新既有檢查條件，因此每次執行時同步圖表類型白名單。
alter table market_analysis_templates
  drop constraint if exists market_analysis_templates_chart_type_check;
alter table market_analysis_templates
  add constraint market_analysis_templates_chart_type_check
  check (chart_type in ('bar','pie','doughnut','line','area','table','cards'));

create index if not exists idx_market_points_source_date
  on market_data_points(source_id, observed_on desc);
create index if not exists idx_market_points_date
  on market_data_points(observed_on desc);
create index if not exists idx_market_points_dimensions_gin
  on market_data_points using gin (dimensions jsonb_path_ops);
create unique index if not exists uq_market_points_external_key
  on market_data_points(source_id, external_key)
  where external_key is not null and external_key <> '';
create index if not exists idx_market_templates_source
  on market_analysis_templates(source_id, status);
create index if not exists idx_market_simulation_created
  on market_simulation_runs(created_at desc);
create index if not exists idx_market_simulation_owner_created
  on market_simulation_runs(created_by, created_at desc);

create or replace function market_analytics_has_access()
returns boolean
language sql stable security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1 from users u
    where u.auth_id=auth.uid() and u.status='active'
      and (u.role='admin' or u.rbac_role='sysadmin'
        or exists(select 1 from role_permissions rp
                  where rp.role_id=coalesce(u.rbac_role,u.role)
                    and rp.perm='sys_marketanalytics' and rp.allowed=true))
  );
$$;

create or replace function market_analytics_can_manage()
returns boolean
language sql stable security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1 from users u
    where u.auth_id=auth.uid() and u.status='active'
      and (u.role='admin' or u.rbac_role='sysadmin'
        or exists(select 1 from role_permissions rp
                  where rp.role_id=coalesce(u.rbac_role,u.role)
                    and rp.perm='marketanalytics_manage' and rp.allowed=true))
  );
$$;

revoke all on function market_analytics_has_access() from public;
revoke all on function market_analytics_can_manage() from public;
grant execute on function market_analytics_has_access() to authenticated;
grant execute on function market_analytics_can_manage() to authenticated;

create or replace function market_dimension_values(
  p_source_id uuid,
  p_dimension text,
  p_limit integer default 500
) returns table(value text, point_count bigint)
language sql stable security invoker set search_path=public,pg_temp as $$
  select p.dimensions->>p_dimension as value, count(*)::bigint as point_count
  from market_data_points p
  where p.source_id=p_source_id
    and p_dimension ~ '^[a-z][a-z0-9_-]{0,59}$'
    and p.dimensions ? p_dimension
    and coalesce(p.dimensions->>p_dimension,'')<>''
  group by p.dimensions->>p_dimension
  order by count(*) desc, p.dimensions->>p_dimension
  limit least(greatest(coalesce(p_limit,500),1),500)
$$;
revoke all on function market_dimension_values(uuid,text,integer) from public;
grant execute on function market_dimension_values(uuid,text,integer) to authenticated,service_role;

create or replace function market_dimension_values_filtered(
  p_source_id uuid,
  p_dimension text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 500
) returns table(value text, point_count bigint)
language sql stable security invoker set search_path=public,pg_temp as $$
  with filter_input as (
    select p_filters is null or jsonb_typeof(p_filters)='object' as is_valid
  ),
  raw_filters as (
    select entry.key,entry.value
    from filter_input input
    cross join lateral jsonb_each(
      case when input.is_valid then coalesce(p_filters,'{}'::jsonb) else '{}'::jsonb end
    ) as entry(key,value)
  ),
  valid_filters as (
    select raw.key,raw.value
    from raw_filters raw
    where raw.key ~ '^[a-z][a-z0-9_-]{0,59}$'
      and jsonb_typeof(raw.value)='string'
      and length(raw.value #>> '{}') between 1 and 200
      and exists (
        select 1
        from market_data_sources source
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(source.field_definitions)='array'
            then source.field_definitions else '[]'::jsonb end
        ) as definition(field)
        where source.source_id=p_source_id
          and definition.field->>'key'=raw.key
          and definition.field->>'kind'='dimension'
          and coalesce(definition.field->>'hidden','false')<>'true'
          and coalesce(definition.field->>'filterable','true')<>'false'
      )
  ),
  filter_state as (
    select
      input.is_valid,
      (select count(*) from raw_filters) as input_count,
      (select count(*) from valid_filters) as valid_count,
      coalesce((select jsonb_object_agg(valid.key,valid.value) from valid_filters valid),'{}'::jsonb) as filters
    from filter_input input
  )
  select points.dimensions->>p_dimension as value,count(*)::bigint as point_count
  from market_data_points points
  cross join filter_state state
  where points.source_id=p_source_id
    and p_dimension ~ '^[a-z][a-z0-9_-]{0,59}$'
    and state.is_valid
    and state.input_count=state.valid_count
    and state.input_count<=8
    and exists (
      select 1
      from market_data_sources source
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(source.field_definitions)='array'
          then source.field_definitions else '[]'::jsonb end
      ) as definition(field)
      where source.source_id=p_source_id
        and definition.field->>'key'=p_dimension
        and definition.field->>'kind'='dimension'
        and coalesce(definition.field->>'hidden','false')<>'true'
        and coalesce(definition.field->>'filterable','true')<>'false'
    )
    and points.dimensions ? p_dimension
    and coalesce(points.dimensions->>p_dimension,'')<>''
    and points.dimensions @> state.filters
  group by points.dimensions->>p_dimension
  order by count(*) desc,points.dimensions->>p_dimension
  limit least(greatest(coalesce(p_limit,500),1),500)
$$;
revoke all on function market_dimension_values_filtered(uuid,text,jsonb,integer) from public;
grant execute on function market_dimension_values_filtered(uuid,text,jsonb,integer) to authenticated,service_role;

create or replace function market_source_date_ranges()
returns table(source_id uuid,first_observed_on date,latest_observed_on date,previous_observed_on date)
language sql stable security invoker set search_path=public,pg_temp as $$
  with source_days as (
    select distinct p.source_id,p.observed_on from market_data_points p
  )
  select d.source_id,min(d.observed_on),max(d.observed_on),(array_agg(d.observed_on order by d.observed_on desc))[2]
  from source_days d
  group by d.source_id
$$;
revoke all on function market_source_date_ranges() from public;
grant execute on function market_source_date_ranges() to service_role;

create or replace function market_import_data_points(
  p_source_id uuid,
  p_rows jsonb,
  p_imported_by uuid
) returns table(inserted_count bigint,updated_count bigint)
language sql volatile security definer set search_path=public,pg_temp as $$
  with incoming_rows as (
    select
      (row_data->>'observed_on')::date as observed_on,
      coalesce(row_data->'dimensions','{}'::jsonb) as dimensions,
      coalesce(row_data->'measures','{}'::jsonb) as measures,
      coalesce(row_data->'metadata','{}'::jsonb) as metadata,
      row_data->>'external_key' as external_key,
      ordinal
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) with ordinality as rows(row_data,ordinal)
    where coalesce(row_data->>'external_key','')<>''
  ), incoming as (
    select distinct on (external_key)
      observed_on,dimensions,measures,metadata,external_key
    from incoming_rows
    order by external_key,ordinal desc
  ), upserted as (
    insert into market_data_points(source_id,observed_on,dimensions,measures,metadata,external_key,imported_by)
    select p_source_id,i.observed_on,i.dimensions,i.measures,i.metadata,i.external_key,p_imported_by
    from incoming i
    on conflict (source_id,external_key) where external_key is not null and external_key<>'' do update set
      observed_on=excluded.observed_on,
      dimensions=excluded.dimensions,
      measures=coalesce(market_data_points.measures,'{}'::jsonb) || excluded.measures,
      metadata=coalesce(market_data_points.metadata,'{}'::jsonb) || excluded.metadata,
      imported_by=excluded.imported_by
    returning (xmax=0) as inserted
  )
  select count(*) filter(where inserted),count(*) filter(where not inserted) from upserted
$$;
revoke all on function market_import_data_points(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function market_import_data_points(uuid,jsonb,uuid) to service_role;

-- 市場行情期間比較與每日群組彙總由 PostgreSQL 一次完成，避免搬運大量 JSONB 明細。
create or replace function public.market_try_float8(p_value text)
returns double precision
language plpgsql
immutable
strict
parallel safe
set search_path=pg_catalog,pg_temp
as $function$
declare
  normalized text;
begin
  normalized := btrim(replace(p_value, ',', ''));
  if normalized = ''
    or normalized !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then
    return null;
  end if;

  begin
    return normalized::double precision;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return null;
  end;
end
$function$;

revoke all on function public.market_try_float8(text) from public,anon,authenticated;
grant execute on function public.market_try_float8(text) to service_role;

create or replace function public.market_analysis_rollup(
  p_source_id uuid,
  p_from date,
  p_to date,
  p_compare_from date default null,
  p_compare_to date default null,
  p_dimensions text[] default '{}'::text[],
  p_measures text[] default '{}'::text[],
  p_filters jsonb default '{}'::jsonb,
  p_include_group_daily boolean default false
) returns jsonb
language plpgsql
stable
security invoker
set search_path=public,pg_temp
as $function$
declare
  v_definitions jsonb;
  v_dimensions text[];
  v_measures text[];
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_filter_count integer;
  v_result jsonb;
begin
  if p_source_id is null then
    raise exception using errcode='22023', message='market source is required';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception using errcode='22023', message='current market period is invalid';
  end if;
  if p_to - p_from + 1 > 366 then
    raise exception using errcode='22023', message='current market period exceeds 366 days';
  end if;
  if (p_compare_from is null) <> (p_compare_to is null) then
    raise exception using errcode='22023', message='comparison market period must provide both dates';
  end if;
  if p_compare_from is not null then
    if p_compare_from > p_compare_to then
      raise exception using errcode='22023', message='comparison market period is invalid';
    end if;
    if p_compare_to - p_compare_from + 1 > 366 then
      raise exception using errcode='22023', message='comparison market period exceeds 366 days';
    end if;
    if p_to - p_from <> p_compare_to - p_compare_from then
      raise exception using errcode='22023', message='market periods must have the same number of days';
    end if;
  end if;

  if cardinality(coalesce(p_dimensions, '{}'::text[])) > 4
    or cardinality(coalesce(p_measures, '{}'::text[])) > 4 then
    raise exception using errcode='22023', message='at most four dimensions and measures are allowed';
  end if;

  select coalesce(array_agg(normalized.dimension_key order by normalized.first_ordinal), '{}'::text[])
  into v_dimensions
  from (
    select input.dimension_key,min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_dimensions, '{}'::text[])) with ordinality
      as input(dimension_key,ordinality)
    group by input.dimension_key
  ) normalized;

  select coalesce(array_agg(normalized.measure_key order by normalized.first_ordinal), '{}'::text[])
  into v_measures
  from (
    select input.measure_key,min(input.ordinality) as first_ordinal
    from unnest(coalesce(p_measures, '{}'::text[])) with ordinality
      as input(measure_key,ordinality)
    group by input.measure_key
  ) normalized;

  if cardinality(v_measures) = 0 then
    raise exception using errcode='22023', message='at least one market measure is required';
  end if;
  if exists (
    select 1 from unnest(v_dimensions) key
    where key is null or key !~ '^[a-z][a-z0-9_-]{0,59}$'
  ) or exists (
    select 1 from unnest(v_measures) key
    where key is null or key !~ '^[a-z][a-z0-9_-]{0,59}$'
  ) then
    raise exception using errcode='22023', message='market field key is invalid';
  end if;

  if jsonb_typeof(v_filters) <> 'object' then
    raise exception using errcode='22023', message='market filters must be an object';
  end if;
  select count(*)::integer into v_filter_count from jsonb_each(v_filters);
  if v_filter_count > 4 then
    raise exception using errcode='22023', message='at most four market filters are allowed';
  end if;
  if exists (
    select 1
    from jsonb_each(v_filters) as filter_entry(filter_key,filter_value)
    where filter_entry.filter_key !~ '^[a-z][a-z0-9_-]{0,59}$'
      or jsonb_typeof(filter_entry.filter_value) <> 'string'
      or length(filter_entry.filter_value #>> '{}') not between 1 and 200
  ) then
    raise exception using errcode='22023', message='market filter is invalid';
  end if;

  select source.field_definitions
  into v_definitions
  from public.market_data_sources source
  where source.source_id=p_source_id and source.status='active';
  if not found then
    raise exception using errcode='P0002', message='active market source was not found';
  end if;
  if jsonb_typeof(v_definitions) <> 'array' then
    raise exception using errcode='22023', message='market field definitions are invalid';
  end if;

  if exists (
    select 1
    from unnest(v_dimensions) requested(dimension_key)
    where not exists (
      select 1
      from jsonb_array_elements(v_definitions) definition(field)
      where definition.field->>'key'=requested.dimension_key
        and definition.field->>'kind'='dimension'
    )
  ) then
    raise exception using errcode='22023', message='requested market dimension is not defined';
  end if;
  if exists (
    select 1
    from unnest(v_measures) requested(measure_key)
    where not exists (
      select 1
      from jsonb_array_elements(v_definitions) definition(field)
      where definition.field->>'key'=requested.measure_key
        and definition.field->>'kind'='measure'
        and coalesce(nullif(definition.field->>'aggregation',''),'sum') in ('sum','avg','min','max','weighted_avg')
    )
  ) then
    raise exception using errcode='22023', message='requested market measure is not defined';
  end if;
  if exists (
    select 1
    from jsonb_each(v_filters) as requested(filter_key,filter_value)
    where not exists (
      select 1
      from jsonb_array_elements(v_definitions) definition(field)
      where definition.field->>'key'=requested.filter_key
        and definition.field->>'kind'='dimension'
    )
  ) then
    raise exception using errcode='22023', message='requested market filter is not defined';
  end if;

  with
  periods as (
    select 'current'::text as period_key,p_from as period_from,p_to as period_to
    union all
    select 'compare'::text,p_compare_from,p_compare_to
    where p_compare_from is not null and p_compare_to is not null
  ),
  dimension_keys as (
    select requested.dimension_key,requested.ordinality
    from unnest(v_dimensions) with ordinality as requested(dimension_key,ordinality)
  ),
  measure_definitions as (
    select
      requested.measure_key,
      requested.ordinality,
      coalesce(nullif(definition.field->>'aggregation',''),'sum') as aggregation,
      nullif(definition.field->>'weight_key','') as weight_key
    from unnest(v_measures) with ordinality as requested(measure_key,ordinality)
    join lateral (
      select fields.field
      from jsonb_array_elements(v_definitions) fields(field)
      where fields.field->>'key'=requested.measure_key
        and fields.field->>'kind'='measure'
      limit 1
    ) definition on true
  ),
  filtered_points as materialized (
    select
      period.period_key,
      points.observed_on,
      points.dimensions,
      points.measures
    from periods period
    join public.market_data_points points
      on points.source_id=p_source_id
      and points.observed_on between period.period_from and period.period_to
    where points.dimensions @> v_filters
  ),
  point_groups as materialized (
    select
      points.period_key,
      points.observed_on,
      points.measures,
      coalesce((
        select jsonb_object_agg(
          dimension.dimension_key,
          coalesce(
            nullif(
              left(
                btrim(regexp_replace(
                  coalesce(points.dimensions->>dimension.dimension_key,''),
                  '[[:cntrl:]]+',
                  ' ',
                  'g'
                )),
                160
              ),
              ''
            ),
            '未分類'
          )
          order by dimension.ordinality
        )
        from dimension_keys dimension
      ), '{}'::jsonb) as group_dimensions,
      coalesce(
        nullif(
          left(
            btrim(regexp_replace(coalesce(points.dimensions->>'market',''),'[[:cntrl:]]+',' ','g')),
            160
          ),
          ''
        ),
        '未分類'
      ) as market_value
    from filtered_points points
  ),
  measure_rows as materialized (
    select
      points.period_key,
      points.observed_on,
      points.group_dimensions,
      points.market_value,
      measure.measure_key,
      measure.ordinality as measure_ordinality,
      measure.aggregation,
      public.market_try_float8(points.measures->>measure.measure_key) as measure_value,
      public.market_try_float8(points.measures->>measure.weight_key) as measure_weight
    from point_groups points
    cross join measure_definitions measure
  ),
  grain_rows as materialized (
    select period_key,'group'::text as grain,group_dimensions as dimensions,
      null::date as observed_on,measure_key,measure_ordinality,aggregation,measure_value,measure_weight
    from measure_rows
    union all
    select period_key,'total','{}'::jsonb,null::date,
      measure_key,measure_ordinality,aggregation,measure_value,measure_weight
    from measure_rows
    union all
    select period_key,'market',jsonb_build_object('market',market_value),null::date,
      measure_key,measure_ordinality,aggregation,measure_value,measure_weight
    from measure_rows
    union all
    select period_key,'daily','{}'::jsonb,observed_on,
      measure_key,measure_ordinality,aggregation,measure_value,measure_weight
    from measure_rows
    union all
    select period_key,'group_daily',group_dimensions,observed_on,
      measure_key,measure_ordinality,aggregation,measure_value,measure_weight
    from measure_rows
    where p_include_group_daily
  ),
  metric_values as (
    select
      period_key,
      grain,
      dimensions,
      observed_on,
      measure_key,
      measure_ordinality,
      case max(aggregation)
        when 'min' then min(measure_value)
        when 'max' then max(measure_value)
        when 'avg' then avg(measure_value)
        when 'weighted_avg' then
          sum(measure_value * measure_weight)
            filter (where measure_value is not null and measure_weight > 0)
          / nullif(sum(measure_weight)
            filter (where measure_value is not null and measure_weight > 0),0)
        else sum(measure_value)
      end as metric_value
    from grain_rows
    group by period_key,grain,dimensions,observed_on,measure_key,measure_ordinality
  ),
  value_objects as (
    select
      period_key,
      grain,
      dimensions,
      observed_on,
      coalesce(
        jsonb_object_agg(measure_key,to_jsonb(metric_value) order by measure_ordinality)
          filter (where metric_value is not null),
        '{}'::jsonb
      ) as values
    from metric_values
    group by period_key,grain,dimensions,observed_on
  ),
  point_counts as (
    select
      count(*) filter (where period_key='current')::bigint as current_count,
      count(*) filter (where period_key='compare')::bigint as compare_count
    from filtered_points
  )
  select jsonb_build_object(
    'counts',jsonb_build_object(
      'current',point_counts.current_count,
      'compare',point_counts.compare_count
    ),
    'current_groups',coalesce((
      select jsonb_agg(
        jsonb_build_object('dimensions',values.dimensions,'values',values.values)
        order by values.dimensions::text
      )
      from value_objects values
      where values.period_key='current' and values.grain='group'
    ),'[]'::jsonb),
    'compare_groups',coalesce((
      select jsonb_agg(
        jsonb_build_object('dimensions',values.dimensions,'values',values.values)
        order by values.dimensions::text
      )
      from value_objects values
      where values.period_key='compare' and values.grain='group'
    ),'[]'::jsonb),
    'current_totals',coalesce((
      select values.values
      from value_objects values
      where values.period_key='current' and values.grain='total'
      limit 1
    ),'{}'::jsonb),
    'compare_totals',coalesce((
      select values.values
      from value_objects values
      where values.period_key='compare' and values.grain='total'
      limit 1
    ),'{}'::jsonb),
    'current_daily',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'observed_on',to_char(values.observed_on,'YYYY-MM-DD'),
          'values',values.values
        ) order by values.observed_on
      )
      from value_objects values
      where values.period_key='current' and values.grain='daily'
    ),'[]'::jsonb),
    'compare_daily',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'observed_on',to_char(values.observed_on,'YYYY-MM-DD'),
          'values',values.values
        ) order by values.observed_on
      )
      from value_objects values
      where values.period_key='compare' and values.grain='daily'
    ),'[]'::jsonb),
    'current_market',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'market',values.dimensions->>'market',
          'values',values.values
        ) order by values.dimensions->>'market'
      )
      from value_objects values
      where values.period_key='current' and values.grain='market'
    ),'[]'::jsonb),
    'compare_market',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'market',values.dimensions->>'market',
          'values',values.values
        ) order by values.dimensions->>'market'
      )
      from value_objects values
      where values.period_key='compare' and values.grain='market'
    ),'[]'::jsonb),
    'current_group_daily',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'observed_on',to_char(values.observed_on,'YYYY-MM-DD'),
          'dimensions',values.dimensions,
          'values',values.values
        ) order by values.observed_on,values.dimensions::text
      )
      from value_objects values
      where values.period_key='current' and values.grain='group_daily'
    ),'[]'::jsonb),
    'compare_group_daily',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'observed_on',to_char(values.observed_on,'YYYY-MM-DD'),
          'dimensions',values.dimensions,
          'values',values.values
        ) order by values.observed_on,values.dimensions::text
      )
      from value_objects values
      where values.period_key='compare' and values.grain='group_daily'
    ),'[]'::jsonb),
    'latest_observed_on',(
      select to_char(max(points.observed_on),'YYYY-MM-DD')
      from filtered_points points
      where points.period_key='current'
    )
  )
  into v_result
  from point_counts;

  return coalesce(v_result,'{}'::jsonb);
end
$function$;

revoke all on function public.market_analysis_rollup(
  uuid,date,date,date,date,text[],text[],jsonb,boolean
) from public,anon,authenticated;
grant execute on function public.market_analysis_rollup(
  uuid,date,date,date,date,text[],text[],jsonb,boolean
) to service_role;

alter table market_data_sources enable row level security;
alter table market_data_points enable row level security;
alter table market_analysis_templates enable row level security;
alter table market_simulation_runs enable row level security;

drop policy if exists market_sources_read on market_data_sources;
drop policy if exists market_sources_manage on market_data_sources;
drop policy if exists market_points_read on market_data_points;
drop policy if exists market_points_manage on market_data_points;
drop policy if exists market_templates_read on market_analysis_templates;
drop policy if exists market_templates_manage on market_analysis_templates;
drop policy if exists market_simulation_read on market_simulation_runs;
drop policy if exists market_simulation_insert on market_simulation_runs;

create policy market_sources_read on market_data_sources
  for select to authenticated using (market_analytics_has_access());
create policy market_sources_manage on market_data_sources
  for all to authenticated using (market_analytics_can_manage())
  with check (market_analytics_can_manage());
create policy market_points_read on market_data_points
  for select to authenticated using (market_analytics_has_access());
create policy market_points_manage on market_data_points
  for all to authenticated using (market_analytics_can_manage())
  with check (market_analytics_can_manage());
create policy market_templates_read on market_analysis_templates
  for select to authenticated using (market_analytics_has_access());
create policy market_templates_manage on market_analysis_templates
  for all to authenticated using (market_analytics_can_manage())
  with check (market_analytics_can_manage());
create policy market_simulation_read on market_simulation_runs
  for select to authenticated using (
    (market_analytics_has_access() or market_analytics_can_manage())
    and (market_analytics_can_manage() or created_by = (
      select u.user_id from users u where u.auth_id = auth.uid() and u.status = 'active'
    ))
  );
create policy market_simulation_insert on market_simulation_runs
  for insert to authenticated with check (
    (market_analytics_has_access() or market_analytics_can_manage())
    and created_by = (
      select u.user_id from users u where u.auth_id = auth.uid() and u.status = 'active'
    )
  );

revoke update, delete, truncate on market_simulation_runs from anon, authenticated;
grant select, insert on market_simulation_runs to authenticated;

create or replace function reject_market_simulation_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  raise exception using
    errcode = '42501',
    message = '市場模擬紀錄為不可變更的追蹤資料';
end;
$$;
revoke all on function reject_market_simulation_mutation() from public;

drop trigger if exists trg_market_simulation_append_only on market_simulation_runs;
create trigger trg_market_simulation_append_only
before update or delete or truncate on market_simulation_runs
for each statement execute function reject_market_simulation_mutation();

insert into market_data_sources(source_id,source_code,source_name,source_type,field_definitions,status)
values (
  '55555555-5555-4555-8555-555555555555',
  'market_daily',
  '每日交易行情',
  'csv',
  '[
    {"key":"item","label":"品項","kind":"dimension","required":true},
    {"key":"market","label":"市場","kind":"dimension"},
    {"key":"unit","label":"交易單位","kind":"dimension"},
    {"key":"quantity","label":"交易量","kind":"measure","unit":"公斤","aggregation":"sum"},
    {"key":"average_price","label":"平均價","kind":"measure","unit":"元／公斤","aggregation":"weighted_avg","weight_key":"quantity"},
    {"key":"min_price","label":"最低價","kind":"measure","unit":"元／公斤","aggregation":"min"},
    {"key":"max_price","label":"最高價","kind":"measure","unit":"元／公斤","aggregation":"max"},
    {"key":"total_value","label":"交易金額","kind":"measure","unit":"元","aggregation":"sum"}
  ]'::jsonb,
  'active'
)
on conflict (source_code) do nothing;

insert into market_analysis_templates(template_id,template_code,template_name,description,source_id,dimensions,measures,chart_type,default_config,status)
values (
  '66666666-6666-4666-8666-666666666666',
  'leaf-market-compare',
  '葉菜交易行情比較',
  '比較指定期間與前一日／後一日／同期的交易量與平均價。',
  (select source_id from market_data_sources where source_code='market_daily'),
  '["item","market"]'::jsonb,
  '["quantity","average_price"]'::jsonb,
  'bar',
  '{"compare":"previous","limit":20}'::jsonb,
  'active'
)
on conflict (template_code) do nothing;

-- 非正式示範資料：只供立即體驗分析、圖表與情境模擬，不可作為交易依據。
insert into market_data_sources(source_id,source_code,source_name,source_type,field_definitions,config,status)
values (
  '77777777-7777-4777-8777-777777777777',
  'market_demo',
  '示範交易行情（非正式資料）',
  'manual',
  '[
    {"key":"item","label":"品項","kind":"dimension","required":true},
    {"key":"market","label":"市場","kind":"dimension"},
    {"key":"unit","label":"交易單位","kind":"dimension"},
    {"key":"quantity","label":"交易量","kind":"measure","unit":"公斤","aggregation":"sum"},
    {"key":"average_price","label":"平均價","kind":"measure","unit":"元／公斤","aggregation":"weighted_avg","weight_key":"quantity"},
    {"key":"min_price","label":"最低價","kind":"measure","unit":"元／公斤","aggregation":"min"},
    {"key":"max_price","label":"最高價","kind":"measure","unit":"元／公斤","aggregation":"max"},
    {"key":"total_value","label":"交易金額","kind":"measure","unit":"元","aggregation":"sum"}
  ]'::jsonb,
  '{"is_demo":true,"data_classification":"非正式示範資料"}'::jsonb,
  'active'
)
on conflict (source_code) do nothing;

with demo_days as (
  select date '2026-08-23' + series.day_offset as observed_on,
         series.day_offset
  from generate_series(0, 7) as series(day_offset)
),
demo_items(item, quantity_base, quantity_step, price_base, price_step) as (
  values
    ('高麗菜', 4200::numeric, 180::numeric, 25.5::numeric, 0.8::numeric),
    ('菠菜',   1850::numeric,  95::numeric, 48.0::numeric, 1.5::numeric),
    ('山蘇',    720::numeric,  38::numeric, 96.0::numeric, 2.2::numeric)
),
demo_rows as (
  select d.observed_on, d.day_offset, i.item,
         i.quantity_base + i.quantity_step * ((d.day_offset % 4) - 1) as quantity,
         i.price_base + i.price_step * ((d.day_offset % 5) - 2) as average_price
  from demo_days d cross join demo_items i
)
insert into market_data_points(source_id,observed_on,dimensions,measures,metadata,external_key)
select
  (select source_id from market_data_sources where source_code='market_demo'),
  r.observed_on,
  jsonb_build_object('item',r.item,'market','第一果菜市場（示範）','unit','公斤'),
  jsonb_build_object(
    'quantity',r.quantity,
    'average_price',round(r.average_price,1),
    'min_price',round(r.average_price - 3.5,1),
    'max_price',round(r.average_price + 5.5,1),
    'total_value',round(r.quantity * r.average_price,0)
  ),
  '{"is_demo":true,"data_classification":"非正式示範資料","notice":"僅供系統展示，不可作為交易決策依據"}'::jsonb,
  'market_demo:' || r.observed_on::text || ':' || r.item
from demo_rows r
on conflict do nothing;

insert into market_analysis_templates(template_id,template_code,template_name,description,source_id,dimensions,measures,chart_type,default_config,status)
values (
  '88888888-8888-4888-8888-888888888888',
  'market-demo-produce-share',
  '示範蔬菜交易量占比（非正式資料）',
  '以高麗菜、菠菜與山蘇的非正式示範數據，展示交易量占比與可追蹤情境模擬。',
  (select source_id from market_data_sources where source_code='market_demo'),
  '["item"]'::jsonb,
  '["quantity"]'::jsonb,
  'doughnut',
  '{"compare":"previous","limit":20,"chart_measure":"quantity","palette_id":"produce","is_demo":true}'::jsonb,
  'active'
)
on conflict (template_code) do nothing;

commit;

notify pgrst, 'reload schema';
