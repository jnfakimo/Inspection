create table if not exists public.patrol_timeout_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  rule_id text not null,
  shift_date date not null,
  shift_name text not null,
  scheduled_end timestamptz not null,
  expected_count int not null default 0,
  checked_count int not null default 0,
  unchecked_count int not null default 0,
  assigned_departments text[] not null default '{}',
  assigned_names text[] not null default '{}',
  actual_names text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  line_response text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(rule_id, shift_date)
);

create index if not exists idx_patrol_timeout_notifications_date
  on public.patrol_timeout_notifications(shift_date desc, scheduled_end desc);

alter table public.patrol_timeout_notifications enable row level security;
drop policy if exists "patrol_timeout_admin_read" on public.patrol_timeout_notifications;
create policy "patrol_timeout_admin_read" on public.patrol_timeout_notifications
  for select using (auth.uid() is not null);

-- 排程已移至 .github/workflows/patrol-line-notify.yml，由 GitHub Secret
-- CRON_SECRET 驗證。資料庫不得保存或排程任何硬編碼 Bearer token。
