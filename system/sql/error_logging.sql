-- ============================================================
-- 前端錯誤記錄 — 自架輕量監控，不依賴第三方帳號（Sentry 等）
-- 目的：讓維運方能主動發現系統錯誤，而不是只能等使用者反映。
-- 這是維運/診斷用的操作紀錄，不是 CLAUDE.md 定義的「業務資料」，
-- 因此不套用全站的永久保留 trigger；管理員可視需要清理舊紀錄。
-- 可重複執行。
-- ============================================================

create table if not exists client_error_logs (
  error_id     uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('js_error','unhandled_rejection','api_error','manual')),
  message      text not null,
  detail       jsonb,
  page         text,
  url          text,
  user_id      uuid references users(user_id),
  user_agent   text,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists idx_client_error_logs_time on client_error_logs(occurred_at desc);
create index if not exists idx_client_error_logs_kind on client_error_logs(kind);

alter table client_error_logs enable row level security;
drop policy if exists "client_error_logs_insert" on client_error_logs;
drop policy if exists "client_error_logs_admin_read" on client_error_logs;
drop policy if exists "client_error_logs_admin_delete" on client_error_logs;

-- 任何已登入使用者的瀏覽器都可以回報錯誤（寫入即止，不能讀取他人回報內容）。
create policy "client_error_logs_insert" on client_error_logs
  for insert to authenticated with check (true);
-- 只有管理員能在後台「系統健康」頁查看。
create policy "client_error_logs_admin_read" on client_error_logs
  for select to authenticated using (is_admin());
-- 只有管理員能清理舊紀錄（操作性資料，非業務稽核資料，允許刪除）。
create policy "client_error_logs_admin_delete" on client_error_logs
  for delete to authenticated using (is_admin());

comment on table client_error_logs is
  '前端錯誤自動回報（js_error/unhandled_rejection）與後端 API 失敗手動回報（manual/api_error）。維運用途，非業務稽核資料，管理員可定期清理。';
