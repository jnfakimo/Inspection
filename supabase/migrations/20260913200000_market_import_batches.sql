begin;

-- 行情匯入批次：一次匯入的來源資訊只存一筆，行情資料每筆只記 metadata.import_batch_id。
-- 原本 source_url、fetched_at、import_method 等批次共用資訊逐筆重複存進 market_data_points.metadata，
-- 約佔每列一半空間（45 萬筆中 99.99% 來自每日排程）；改由本表保存後，新資料的單筆大小約減半，
-- 同時留下完整的匯入歷史（market_data_sources.config.daily_import_last_run 只記得最後一次）。
-- 既有行情資料不回頭改寫：重寫 45 萬筆需鎖表回收空間，效益不足以抵銷風險。
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

-- 匯入紀錄只增不改：寫入後不可修改或刪除，作為行情資料來源的稽核依據。
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

comment on table public.market_import_batches is
  '行情匯入批次：批次共用的來源資訊只存一次，market_data_points.metadata.import_batch_id 指向本表';

commit;
