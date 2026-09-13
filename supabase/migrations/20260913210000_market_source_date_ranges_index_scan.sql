begin;

-- 公開市場看板與戰情輪播呼叫 market_source_date_ranges() 時逾時（HTTP 503「市場行情交易日期暫時無法讀取」）。
-- 20260905 版本雖只取最近 90 天，但規劃器把 CTE 與子查詢攤平，實際對 market_data_points 全表掃描
-- 45 萬筆：資料頁在記憶體快取時勉強低於 service_role 的 8 秒逾時，快取被擠出後需約 14.6 秒而失敗。
-- 本版以 materialized CTE 先算出各來源最新日期，再用 LATERAL（offset 0 防止攤平）逐一來源
-- 走 idx_market_points_source_date 範圍掃描：正式資料庫實測 14,567 ms → 460 ms，
-- 新舊寫法結果逐列比對完全相同。函式簽章、security invoker、search_path 與授權皆不變。
create or replace function market_source_date_ranges()
returns table(source_id uuid,first_observed_on date,latest_observed_on date,previous_observed_on date)
language sql stable security invoker set search_path=public,pg_temp as $$
  with sources as materialized (
    select s.source_id,s.source_code,
      (select max(q.observed_on) from market_data_points q where q.source_id=s.source_id) as max_day
    from market_data_sources s
  ), grouped_days as (
    -- 逐一來源取最近 90 天：sources 先 materialized（只有少數來源），LATERAL 子查詢加 offset 0
    -- 防止規劃器攤平回全表掃描，每個來源都以 idx_market_points_source_date 做範圍掃描。
    -- 行情資料快取被擠出記憶體時，舊寫法全表掃描 45 萬筆會超過 8 秒逾時（公開看板 503）。
    select s.source_id,p.observed_on,s.source_code,
      count(distinct nullif(p.dimensions->>'market','')) as market_count,
      count(distinct nullif(p.dimensions->>'category','')) as category_count,
      count(distinct concat_ws(E'\x1f',p.dimensions->>'market',p.dimensions->>'category'))
        filter (where coalesce(p.dimensions->>'market','')<>'' and coalesce(p.dimensions->>'category','')<>'') as scope_count
    from sources s
    cross join lateral (
      select q.observed_on,q.dimensions
      from market_data_points q
      where q.source_id=s.source_id and q.observed_on>=s.max_day-90
      offset 0
    ) p
    where s.max_day is not null
    group by s.source_id,p.observed_on,s.source_code
  ), source_days as (
    select source_id,observed_on from grouped_days
    where source_code<>'tapmc_market_actual' or (market_count=2 and category_count=2 and scope_count=4)
  )
  select d.source_id,
    (select min(q.observed_on) from market_data_points q where q.source_id=d.source_id) as first_observed_on,
    max(d.observed_on) as latest_observed_on,
    (array_agg(d.observed_on order by d.observed_on desc))[2] as previous_observed_on
  from source_days d
  group by d.source_id
$$;
revoke all on function market_source_date_ranges() from public;
grant execute on function market_source_date_ranges() to service_role;

commit;
