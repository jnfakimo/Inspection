-- 非正式示範行情：用於立即展示分析、圖表與可追蹤情境模擬。
-- 所有資料都有明確示範標記；本 migration 只新增、絕不刪除既有資料。

begin;

insert into public.market_data_sources(source_id,source_code,source_name,source_type,field_definitions,config,status)
values (
  '77777777-7777-4777-8777-777777777777',
  'market_demo',
  '示範交易行情（非正式資料）',
  'manual',
  '[
    {"key":"item","label":"品項","kind":"dimension","required":true},
    {"key":"market","label":"市場","kind":"dimension"},
    {"key":"unit","label":"交易單位","kind":"dimension"},
    {"key":"quantity","label":"交易量","kind":"measure","unit":"公斤"},
    {"key":"average_price","label":"平均價","kind":"measure","unit":"元／公斤"},
    {"key":"min_price","label":"最低價","kind":"measure","unit":"元／公斤"},
    {"key":"max_price","label":"最高價","kind":"measure","unit":"元／公斤"},
    {"key":"total_value","label":"交易金額","kind":"measure","unit":"元"}
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
insert into public.market_data_points(source_id,observed_on,dimensions,measures,metadata,external_key)
select
  (select source_id from public.market_data_sources where source_code='market_demo'),
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

insert into public.market_analysis_templates(template_id,template_code,template_name,description,source_id,dimensions,measures,chart_type,default_config,status)
values (
  '88888888-8888-4888-8888-888888888888',
  'market-demo-produce-share',
  '示範蔬菜交易量占比（非正式資料）',
  '以高麗菜、菠菜與山蘇的非正式示範數據，展示交易量占比與可追蹤情境模擬。',
  (select source_id from public.market_data_sources where source_code='market_demo'),
  '["item"]'::jsonb,
  '["quantity"]'::jsonb,
  'doughnut',
  '{"compare":"previous","limit":20,"chart_measure":"quantity","palette_id":"produce","is_demo":true}'::jsonb,
  'active'
)
on conflict (template_code) do nothing;

commit;

notify pgrst, 'reload schema';
