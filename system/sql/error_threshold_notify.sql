-- ============================================================
-- 關鍵功能異常通知排程
-- 先部署 error-threshold-check Edge Function，再執行本檔。
-- 沿用 patrol_timeout_notifications.sql 的 pg_cron 排程寫法。
-- 可重複執行。
-- ============================================================

-- 預設關閉，需管理員到「系統設定」頁或直接 SQL 開啟：
--   line_notify_error_threshold = 'true'
-- 其餘可調整參數（皆有預設值，不設定也能運作）：
--   error_threshold_window_minutes   （統計視窗，預設 15 分鐘）
--   error_threshold_count            （門檻筆數，預設 20）
--   error_threshold_cooldown_minutes （同一波錯誤的通知冷卻時間，預設 60 分鐘）
insert into system_settings (key, value) values
  ('line_notify_error_threshold', 'false')
on conflict (key) do nothing;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname='error-threshold-check' limit 1;
  if job_id is not null then perform cron.unschedule(job_id); end if;
end $$;

-- 每 5 分鐘檢查一次；函式內部有冷卻時間，不會因此每 5 分鐘就推播一次。
select cron.schedule(
  'error-threshold-check',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://qztffronusdhgxhjjubt.supabase.co/functions/v1/error-threshold-check',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA'
    ),
    body := '{"scheduled":true}'::jsonb
  );
  $job$
);
