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
                   check (chart_type in ('bar','table','cards')),
  default_config    jsonb not null default '{}'::jsonb,
  status            text not null default 'active'
                   check (status in ('active','inactive')),
  created_by        uuid references users(user_id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 既有環境補欄位，不重建或覆寫既有資料。
alter table market_data_sources add column if not exists endpoint_url text;
alter table market_data_sources add column if not exists field_definitions jsonb not null default '[]'::jsonb;
alter table market_data_sources add column if not exists config jsonb not null default '{}'::jsonb;
alter table market_data_sources add column if not exists updated_at timestamptz not null default now();
alter table market_data_points add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table market_data_points add column if not exists external_key text;
alter table market_analysis_templates add column if not exists default_config jsonb not null default '{}'::jsonb;
alter table market_analysis_templates add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_market_points_source_date
  on market_data_points(source_id, observed_on desc);
create index if not exists idx_market_points_date
  on market_data_points(observed_on desc);
create unique index if not exists uq_market_points_external_key
  on market_data_points(source_id, external_key)
  where external_key is not null and external_key <> '';
create index if not exists idx_market_templates_source
  on market_analysis_templates(source_id, status);

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

drop policy if exists market_sources_read on market_data_sources;
drop policy if exists market_sources_manage on market_data_sources;
drop policy if exists market_points_read on market_data_points;
drop policy if exists market_points_manage on market_data_points;
drop policy if exists market_templates_read on market_analysis_templates;
drop policy if exists market_templates_manage on market_analysis_templates;

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

commit;

notify pgrst, 'reload schema';
