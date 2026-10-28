-- 空白環境依序套用 migration 時，20260820100000 會把報修狀態縮回四種。
-- 現行派工及驗收 RPC 會同步 assigned、pending_review 等狀態，必須保留完整集合。
-- 只修正 CHECK；不變更 RLS、權限、觸發器、密碼政策或任何既有資料。
begin;
alter table public.repair_requests drop constraint if exists repair_requests_status_check;
alter table public.repair_requests add constraint repair_requests_status_check
  check (status in (
    'pending','transferred','assigned','accepted','in_progress','waiting_parts',
    'waiting_vendor','pending_review','completed','closed','returned','rejected',
    'cancelled','overdue'
  ));
notify pgrst, 'reload schema';
commit;
