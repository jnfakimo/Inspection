-- 市場行情階層式篩選：以既有維度安全取得連動選項，並補上正式來源的顯示 metadata。
-- 本 migration 僅建立／更新函式與來源設定，不刪除任何行情資料。

begin;

create or replace function public.market_dimension_values_filtered(
  p_source_id uuid,
  p_dimension text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 500
) returns table(value text, point_count bigint)
language sql stable security invoker set search_path=public,pg_temp as $function$
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
        from public.market_data_sources source
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
  from public.market_data_points points
  cross join filter_state state
  where points.source_id=p_source_id
    and p_dimension ~ '^[a-z][a-z0-9_-]{0,59}$'
    and state.is_valid
    and state.input_count=state.valid_count
    and state.input_count<=8
    and exists (
      select 1
      from public.market_data_sources source
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
$function$;

revoke all on function public.market_dimension_values_filtered(uuid,text,jsonb,integer) from public;
grant execute on function public.market_dimension_values_filtered(uuid,text,jsonb,integer) to authenticated,service_role;

with refreshed_source as (
  select
    source.source_id,
    coalesce(
      jsonb_agg(
        case definition.field->>'key'
          when 'market' then definition.field || jsonb_build_object('label','市場')
          when 'category' then definition.field || jsonb_build_object('label','蔬果大類')
          when 'item' then definition.field || jsonb_build_object('label','品項分類')
          when 'item_key' then definition.field || jsonb_build_object('hidden',true,'filterable',false)
          else definition.field
        end
        order by definition.ordinality
      ),
      '[]'::jsonb
    ) as field_definitions
  from public.market_data_sources source
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(source.field_definitions)='array'
      then source.field_definitions else '[]'::jsonb end
  ) with ordinality as definition(field,ordinality)
  where source.source_code='tapmc_market_actual'
  group by source.source_id
)
update public.market_data_sources source
set field_definitions=refreshed.field_definitions,
    config=coalesce(source.config,'{}'::jsonb) || jsonb_build_object(
      'default_dimensions',jsonb_build_array('category'),
      'drill_hierarchy',jsonb_build_array('category','item'),
      'filter_hierarchy',jsonb_build_array('market','category','item'),
      'context_dimensions',jsonb_build_array('market')
    ),
    updated_at=now()
from refreshed_source refreshed
where source.source_id=refreshed.source_id;

commit;

notify pgrst, 'reload schema';
