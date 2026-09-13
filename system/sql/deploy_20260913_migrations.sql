-- ============================================================================
-- 臺北農產 2026-09-13 雲端資料庫 Migration 整合部署腳本
-- 包含：1. 核心外鍵效能索引  2. 行情批次匯入追蹤表 (market_import_batches)
-- ============================================================================

begin;

-- [Part 1] 核心外鍵效能索引優化
create index if not exists idx_cost_records_equipment_id on public.cost_records(equipment_id);
create index if not exists idx_cost_records_order_id on public.cost_records(order_id);
create index if not exists idx_equipment_location_id on public.equipment(location_id);
create index if not exists idx_departments_parent_id on public.departments(parent_id);
create index if not exists idx_repair_requests_equipment_id on public.repair_requests(equipment_id);
create index if not exists idx_repair_requests_location_id on public.repair_requests(location_id);
create index if not exists idx_maintenance_orders_request_id on public.maintenance_orders(request_id);
create index if not exists idx_maintenance_orders_equipment_id on public.maintenance_orders(equipment_id);

-- [Part 2] 行情批次匯入追蹤表
create table if not exists public.market_import_batches (
  batch_id uuid primary key,
  source_id uuid not null references public.market_data_sources(source_id),
  import_method text not null check (import_method ~ '^[a-z][a-z0-9_]{1,40}$'),
  mode text,
  source_url text,
  range_from date,
  range_to date,
  row_count integer not null default 0 check (row_count >= 0),
  workflow_run text,
  details jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_market_import_batches_source_created
  on public.market_import_batches(source_id, created_at desc);

create or replace function public.protect_market_import_batches()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '行情匯入批次紀錄不可修改或刪除';
end $$;

drop trigger if exists trg_protect_market_import_batches on public.market_import_batches;
create trigger trg_protect_market_import_batches before update or delete on public.market_import_batches
  for each row execute function public.protect_market_import_batches();

alter table public.market_import_batches enable row level security;
alter table public.market_import_batches force row level security;
revoke all on public.market_import_batches from anon;
revoke insert, update, delete on public.market_import_batches from authenticated;
grant select on public.market_import_batches to authenticated;
grant select, insert on public.market_import_batches to service_role;

drop policy if exists market_import_batches_read on public.market_import_batches;
create policy market_import_batches_read on public.market_import_batches for select to authenticated
  using (public.market_analytics_has_access());

commit;

-- [驗證查詢] 確認新建立的索引與資料表
select 'Table: market_import_batches' as check_item, count(*) as exists_status 
from information_schema.tables where table_schema='public' and table_name='market_import_batches'
union all
select 'Index: ' || indexname, 1 
from pg_indexes 
where schemaname='public' and indexname in (
  'idx_cost_records_equipment_id', 'idx_cost_records_order_id', 
  'idx_equipment_location_id', 'idx_departments_parent_id', 
  'idx_repair_requests_equipment_id', 'idx_repair_requests_location_id',
  'idx_maintenance_orders_request_id', 'idx_maintenance_orders_equipment_id',
  'idx_market_import_batches_source_created'
);
