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

create index if not exists idx_audit_logs_operated_at_desc
  on audit_logs (operated_at desc);
create index if not exists idx_audit_logs_table_action_time
  on audit_logs (table_name, action, operated_at desc);
create index if not exists idx_audit_logs_operator_time
  on audit_logs (operator_id, operated_at desc);
create index if not exists idx_audit_logs_event_type
  on audit_logs ((changes ->> 'event_type'), operated_at desc)
  where changes ? 'event_type';

commit;
