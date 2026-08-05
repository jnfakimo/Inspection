-- ============================================================
-- 功能室/會議室預約系統 — 資料表
-- Run ONCE in Supabase SQL Editor（idempotent，可重複執行）
-- ============================================================

begin;

create extension if not exists btree_gist;

-- 1) 會議室主檔（可定義多間，後台管理維護，停用不刪除）
create table if not exists meeting_rooms (
  room_id    uuid primary key default gen_random_uuid(),
  name       text not null,
  capacity   int,
  floor      text,
  note       text,
  status     text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz default now(),
  created_by uuid references users(user_id)
);

-- 2) 預約紀錄：送出即生效，不需審核
create table if not exists meeting_bookings (
  booking_id    uuid primary key default gen_random_uuid(),
  room_id       uuid not null references meeting_rooms(room_id),
  user_id       uuid references users(user_id),
  purpose       text,
  booking_date  date not null,
  start_time    time not null,
  end_time      time not null,
  status        text not null default 'booked' check (status in ('booked','checked_in','cancelled','expired')),
  checked_in_at timestamptz,
  created_at    timestamptz default now()
);

create index if not exists idx_meeting_bookings_room_date on meeting_bookings(room_id, booking_date);
create index if not exists idx_meeting_bookings_user on meeting_bookings(user_id);

-- 3) 資料庫層防止同一房間同時段重複預約（不只是前端檢查）
alter table meeting_bookings add column if not exists time_range tstzrange
  generated always as (
    tstzrange(
      (booking_date + start_time) at time zone 'Asia/Taipei',
      (booking_date + end_time)   at time zone 'Asia/Taipei'
    )
  ) stored;

alter table meeting_bookings drop constraint if exists meeting_bookings_no_overlap;
alter table meeting_bookings add constraint meeting_bookings_no_overlap
  exclude using gist (room_id with =, time_range with &&)
  where (status in ('booked','checked_in'));

-- ── RLS：沿用 allow_all_for_now 慣例 ─────────────────────────
alter table meeting_rooms enable row level security;
alter table meeting_bookings enable row level security;
drop policy if exists "allow_all_for_now" on meeting_rooms;
drop policy if exists "allow_all_for_now" on meeting_bookings;
create policy "allow_all_for_now" on meeting_rooms for all using (true);
create policy "allow_all_for_now" on meeting_bookings for all using (true);

-- ── 永久資料保護 ──────────────────────────────────────────
-- meeting_rooms/meeting_bookings 已加進 permanent_data_protection.sql 的保護
-- 清單；建好這兩張表後，請「重新跑一次」permanent_data_protection.sql
-- （該檔是 idempotent，重跑安全）才會把禁止 DELETE/TRUNCATE 的觸發器
-- 實際掛上這兩張新表。

commit;
