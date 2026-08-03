-- ============================================================
-- 稽核紀錄擴充：登入／登出事件（含 IP、裝置資訊）
-- Run ONCE in Supabase SQL Editor（idempotent，可重複執行）
-- ============================================================

begin;

alter table audit_logs add column if not exists ip_address text;
alter table audit_logs add column if not exists user_agent text;

alter table audit_logs drop constraint if exists audit_logs_action_check;
alter table audit_logs add constraint audit_logs_action_check
  check (action in ('insert','update','status_change','login','logout'));

commit;
