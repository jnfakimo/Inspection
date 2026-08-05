-- ============================================================
-- 會議室預約 — 到期提醒／逾時取消 推播去重記錄表
-- 結構比照 patrol_timeout_notifications.sql
-- Run ONCE in Supabase SQL Editor（idempotent，可重複執行）
-- ============================================================

begin;

create table if not exists meeting_booking_notifications (
  notification_id   uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references meeting_bookings(booking_id),
  notification_type text not null check (notification_type in ('reminder','expired')),
  status            text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  line_response     text,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique(booking_id, notification_type)
);

alter table meeting_booking_notifications enable row level security;
drop policy if exists "allow_all_for_now" on meeting_booking_notifications;
create policy "allow_all_for_now" on meeting_booking_notifications for all using (true);

commit;
