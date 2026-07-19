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

-- 每五分鐘檢查一次。若既有同名排程，先安全移除。
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname='patrol-timeout-line-check' limit 1;
  if job_id is not null then perform cron.unschedule(job_id); end if;
end $$;

select cron.schedule(
  'patrol-timeout-line-check',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://qztffronusdhgxhjjubt.supabase.co/functions/v1/patrol-timeout-check',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA'
    ),
    body := '{"scheduled":true}'::jsonb
  );
  $job$
);
