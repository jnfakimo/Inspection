-- ============================================================
-- QR 掃描簽到記錄（通用：巡邏點標記 / 區域位置表空間）
-- Version 1.0  |  Run ONCE in Supabase SQL Editor（idempotent）
-- ============================================================
-- 用途：掃描 QR code 後記錄「誰、什麼時候、掃了哪個地點」。
-- target_type='marker' → target_id 對應 plan_markers.marker_id（例：巡邏點）
-- target_type='space'  → target_id 對應 floor_spaces.space_id（區域位置表空間）
-- 若之前已執行過 system/sql/patrol_checkins.sql（舊版、僅支援巡邏點），
-- 本檔取代該檔，請改執行本檔；patrol_checkins 資料表若已存在可忽略或自行清除。
-- ============================================================

create table if not exists checkin_logs (
  checkin_id   uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('marker','space')),
  target_id    uuid not null,
  floor_id     text,
  label        text,                                 -- 簽到當下的地點名稱快照
  user_id      uuid references users(user_id),
  user_name    text,                                 -- 簽到當下的人員姓名快照
  checkin_at   timestamptz not null default now()
);

create index if not exists idx_checkin_logs_target on checkin_logs(target_type,target_id);
create index if not exists idx_checkin_logs_time   on checkin_logs(checkin_at desc);

-- ── RLS ────────────────────────────────────────────────────
alter table checkin_logs enable row level security;
drop policy if exists "allow_all_for_now" on checkin_logs;
drop policy if exists "authenticated_only" on checkin_logs;
-- 僅在沒有任何正式政策（已被 full_commercial_hardening / 後續 migration 收緊）時才建立開放政策，
-- 避免重跑本檔重新打開權限。
do $$
declare policy_count int;
begin
  select count(*) into policy_count from pg_policies where schemaname='public' and tablename='checkin_logs';
  if policy_count = 0 then
    execute 'create policy "authenticated_only" on checkin_logs for all to authenticated using (true) with check (true)';
  end if;
end $$;
