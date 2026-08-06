-- 駐衛警巡檢逾時 LINE 推播
-- 先部署 patrol-timeout-check Edge Function，再於 Supabase SQL Editor 執行本檔。

create table if not exists patrol_timeout_notifications (
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
  on patrol_timeout_notifications(shift_date desc, scheduled_end desc);

alter table patrol_timeout_notifications enable row level security;
drop policy if exists "patrol_timeout_admin_read" on patrol_timeout_notifications;
create policy "patrol_timeout_admin_read" on patrol_timeout_notifications
  for select using (auth.uid() is not null);

-- 排程由 .github/workflows/patrol-line-notify.yml 執行，並以 CRON_SECRET
-- 驗證。這裡只移除舊的資料庫排程，避免重新執行本檔時恢復匿名觸發。
create extension if not exists pg_cron;
do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname='patrol-timeout-line-check' limit 1;
  if job_id is not null then perform cron.unschedule(job_id); end if;
end $$;
