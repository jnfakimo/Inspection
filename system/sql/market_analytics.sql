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
    {"key":"quantity","label":"交易量","kind":"measure","unit":"公斤"},
    {"key":"average_price","label":"平均價","kind":"measure","unit":"元／公斤"},
    {"key":"min_price","label":"最低價","kind":"measure","unit":"元／公斤"},
    {"key":"max_price","label":"最高價","kind":"measure","unit":"元／公斤"},
    {"key":"total_value","label":"交易金額","kind":"measure","unit":"元"}
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
