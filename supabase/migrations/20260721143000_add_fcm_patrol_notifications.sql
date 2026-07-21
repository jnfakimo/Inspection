create table if not exists public.fcm_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  device_name text not null default '瀏覽器裝置',
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fcm_subscriptions_enabled
  on public.fcm_subscriptions(enabled) where enabled = true;

alter table public.fcm_subscriptions enable row level security;

drop policy if exists "fcm_subscriptions_select_own" on public.fcm_subscriptions;
create policy "fcm_subscriptions_select_own" on public.fcm_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "fcm_subscriptions_insert_own" on public.fcm_subscriptions;
create policy "fcm_subscriptions_insert_own" on public.fcm_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "fcm_subscriptions_update_own" on public.fcm_subscriptions;
create policy "fcm_subscriptions_update_own" on public.fcm_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "fcm_subscriptions_delete_own" on public.fcm_subscriptions;
create policy "fcm_subscriptions_delete_own" on public.fcm_subscriptions
  for delete using (auth.uid() = user_id);

alter table public.patrol_timeout_notifications
  add column if not exists fcm_status text not null default 'pending'
    check (fcm_status in ('pending','sent','failed','skipped')),
  add column if not exists fcm_success_count int not null default 0,
  add column if not exists fcm_failure_count int not null default 0,
  add column if not exists fcm_response text;

insert into public.system_settings(key, value)
values ('fcm_notify_patrol_timeout', 'true')
on conflict (key) do nothing;
