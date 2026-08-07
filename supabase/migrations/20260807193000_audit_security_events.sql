-- 安全稽核事件：登入嘗試、資料讀取、檔案存取與拒絕存取。
-- 僅新增查詢索引與文件說明，不修改或刪除既有紀錄。

begin;

create index if not exists idx_audit_logs_ip_auth_time
  on public.audit_logs (ip_address, operated_at desc)
  where table_name = 'auth' and action = 'login';

create index if not exists idx_audit_logs_unidentified_time
  on public.audit_logs (operated_at desc)
  where operator_id is null;

comment on table public.audit_logs is
  '永久稽核紀錄：登入與失敗嘗試、系統與功能使用、資料與檔案讀取、拒絕存取、資料異動及流程狀態。';

commit;
