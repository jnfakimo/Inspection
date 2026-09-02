-- Ensure the weather Edge Function has a local fallback when CWA is slow or
-- temporarily unavailable.  The function accesses this table with service
-- role; browser clients only receive the function response.

begin;

create table if not exists public.weather_api_cache (
  cache_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default now(),
  status text not null default 'ok' check (status in ('ok','stale','error')),
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_weather_cache_expires
  on public.weather_api_cache (expires_at);

alter table public.weather_api_cache enable row level security;

notify pgrst, 'reload schema';

commit;
