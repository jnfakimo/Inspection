-- 讓平面圖 / 3D 巡檢頁能即時反映打卡狀態，不必等 30 秒輪詢。
-- idempotent：可重複執行。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'checkin_logs'
  ) then
    alter publication supabase_realtime add table public.checkin_logs;
  end if;
end $$;
