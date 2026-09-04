-- 看板只採用一市、二市 × 蔬菜、水果四組皆有資料的完整交易日。
-- 中午來源分批結帳時可先安全追加已取得的行情，但不會把半日資料當作最新日顯示。
begin;

create or replace function public.market_source_date_ranges()
returns table(source_id uuid,first_observed_on date,latest_observed_on date,previous_observed_on date)
language sql stable security invoker set search_path=public,pg_temp as $function$
  with grouped_days as (
    select
      p.source_id,
      p.observed_on,
      s.source_code,
      count(distinct nullif(p.dimensions->>'market','')) as market_count,
      count(distinct nullif(p.dimensions->>'category','')) as category_count,
      count(distinct concat_ws(E'\x1f',p.dimensions->>'market',p.dimensions->>'category'))
        filter (where coalesce(p.dimensions->>'market','')<>'' and coalesce(p.dimensions->>'category','')<>'') as scope_count
    from public.market_data_points p
    join public.market_data_sources s on s.source_id=p.source_id
    group by p.source_id,p.observed_on,s.source_code
  ), eligible_days as (
    select source_id,observed_on
    from grouped_days
    where source_code<>'tapmc_market_actual'
       or (market_count=2 and category_count=2 and scope_count=4)
  )
  select d.source_id,min(d.observed_on),max(d.observed_on),(array_agg(d.observed_on order by d.observed_on desc))[2]
  from eligible_days d
  group by d.source_id
$function$;

revoke all on function public.market_source_date_ranges() from public;
grant execute on function public.market_source_date_ranges() to service_role;

commit;
