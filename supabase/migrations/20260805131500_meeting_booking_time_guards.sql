-- 會議室預約：資料庫層限制有效起訖與 30 分鐘時段

alter table public.meeting_bookings drop constraint if exists meeting_bookings_valid_time;
alter table public.meeting_bookings add constraint meeting_bookings_valid_time
  check (end_time > start_time);

alter table public.meeting_bookings drop constraint if exists meeting_bookings_half_hour_slots;
alter table public.meeting_bookings add constraint meeting_bookings_half_hour_slots check (
  extract(minute from start_time) in (0,30) and extract(second from start_time)=0 and
  extract(minute from end_time) in (0,30) and extract(second from end_time)=0
);
