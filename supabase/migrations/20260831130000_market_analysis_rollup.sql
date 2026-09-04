-- 市場行情唯讀彙總：把期間比較、群組、每日序列與市場摘要留在 PostgreSQL，
-- 避免 Edge Function 逐頁搬運最多十萬筆 JSONB 明細後再以 JavaScript 重算。

begin;

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

commit;

notify pgrst, 'reload schema';
