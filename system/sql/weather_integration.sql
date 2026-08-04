-- ============================================================
-- 中央氣象署戰情儀表板介接快取
-- API 授權碼只存 Supabase Secret：CWA_API_KEY，不存於資料表。
-- 本檔可重複執行；請在 permanent_data_protection.sql 前套用。
-- ============================================================

begin;

create table if not exists weather_api_cache (
  cache_key         text primary key,
  payload           jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  fetched_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now(),
  status            text not null default 'ok'
                      check (status in ('ok','stale','error')),
  last_error        text,
  updated_at        timestamptz not null default now()
);

alter table weather_api_cache add column if not exists source_updated_at timestamptz;
alter table weather_api_cache add column if not exists fetched_at timestamptz not null default now();
alter table weather_api_cache add column if not exists expires_at timestamptz not null default now();
alter table weather_api_cache add column if not exists status text not null default 'ok';
alter table weather_api_cache add column if not exists last_error text;
alter table weather_api_cache add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_weather_cache_expires on weather_api_cache(expires_at);

alter table weather_api_cache enable row level security;
drop policy if exists "weather_cache_read" on weather_api_cache;
create policy "weather_cache_read" on weather_api_cache
  for select to authenticated using (true);

-- 寫入只由使用 service role 的 cwa-weather Edge Function 執行；
-- 不建立 authenticated INSERT/UPDATE/DELETE policy。

commit;

notify pgrst, 'reload schema';
