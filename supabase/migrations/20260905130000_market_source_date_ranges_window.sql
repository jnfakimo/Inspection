-- 市場行情來源日期範圍改為視窗計算：回補 110 年起資料後（約 85 萬列），原本全表逐列解析
-- jsonb 分組會超過逾時，公開看板與長官看板回 503。可重複執行。
begin;
create or replace function market_source_date_ranges()
returns table(source_id uuid,first_observed_on date,latest_observed_on date,previous_observed_on date)
language sql stable security invoker set search_path=public,pg_temp as $$
  -- 2026-09-05：市場行情回補到 110 年後資料約 85 萬列，原本對整張表逐列解析 jsonb 分組
  -- 會超過逾時（公開看板 503）。最新／前一完整交易日只需看每個來源最近 90 天，
  -- 起日改用 (source_id, observed_on) 索引直接取 min；語意與原本相同，只是不再全表掃描。
  with sources as (
    select s.source_id,s.source_code,
      (select max(q.observed_on) from market_data_points q where q.source_id=s.source_id) as max_day
    from market_data_sources s
  ), grouped_days as (
    select p.source_id,p.observed_on,s.source_code,
      count(distinct nullif(p.dimensions->>'market','')) as market_count,
      count(distinct nullif(p.dimensions->>'category','')) as category_count,
      count(distinct concat_ws(E'\x1f',p.dimensions->>'market',p.dimensions->>'category'))
        filter (where coalesce(p.dimensions->>'market','')<>'' and coalesce(p.dimensions->>'category','')<>'') as scope_count
    from sources s join market_data_points p on p.source_id=s.source_id
    where s.max_day is not null and p.observed_on>=s.max_day-90
    group by p.source_id,p.observed_on,s.source_code
  ), source_days as (
    select source_id,observed_on from grouped_days
    where source_code<>'tapmc_market_actual' or (market_count=2 and category_count=2 and scope_count=4)
  )
  select d.source_id,
    (select min(q.observed_on) from market_data_points q where q.source_id=d.source_id),
    max(d.observed_on),
    (array_agg(d.observed_on order by d.observed_on desc))[2]
  from source_days d
  group by d.source_id
$$;
revoke all on function market_source_date_ranges() from public;
grant execute on function market_source_date_ranges() to service_role;
commit;
