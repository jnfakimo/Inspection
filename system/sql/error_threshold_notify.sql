-- ============================================================
-- 關鍵功能異常通知排程
-- 先部署 error-threshold-check Edge Function，再執行本檔。
-- 正式排程由 GitHub Actions 以 CRON_SECRET 觸發。
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

do $$
declare job_id bigint;
begin
  select jobid into job_id from cron.job where jobname='error-threshold-check' limit 1;
  if job_id is not null then perform cron.unschedule(job_id); end if;
end $$;

-- 排程由 .github/workflows/error-threshold-check.yml 執行，並以
-- CRON_SECRET 驗證。請勿在資料庫內以公開 anon JWT 建立排程。
