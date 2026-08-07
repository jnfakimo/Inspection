-- 全站稽核事件會持續累積；補上後台明細、日期篩選與操作者查詢所需索引。
-- 僅新增索引，不修改或刪除任何既有紀錄。

begin;

create index if not exists idx_audit_logs_operated_at_desc
  on public.audit_logs (operated_at desc);

create index if not exists idx_audit_logs_table_action_time
  on public.audit_logs (table_name, action, operated_at desc);

create index if not exists idx_audit_logs_operator_time
  on public.audit_logs (operator_id, operated_at desc);

create index if not exists idx_audit_logs_event_type
  on public.audit_logs ((changes ->> 'event_type'), operated_at desc)
  where changes ? 'event_type';

comment on table public.audit_logs is
  '永久稽核紀錄：登入/登出、系統與功能使用、資料新增修改及流程狀態異動。';

commit;
