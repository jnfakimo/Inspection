-- 會議室預約：預約單號、系統電話快照及本次聯繫電話

alter table public.meeting_bookings add column if not exists booking_no text;
alter table public.meeting_bookings add column if not exists booker_phone text;
alter table public.meeting_bookings add column if not exists contact_phone text;

create sequence if not exists public.meeting_booking_no_seq;
grant usage, select on sequence public.meeting_booking_no_seq to anon, authenticated, service_role;

create or replace function public.gen_meeting_booking_no()
returns text
language sql
volatile
as $$
  select 'MR-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(nextval('public.meeting_booking_no_seq')::text,6,'0')
$$;

update public.meeting_bookings
set booking_no='MR-' || to_char(booking_date,'YYYYMMDD') || '-' || lpad(nextval('public.meeting_booking_no_seq')::text,6,'0')
where booking_no is null;

alter table public.meeting_bookings alter column booking_no set default public.gen_meeting_booking_no();
create unique index if not exists uq_meeting_bookings_booking_no on public.meeting_bookings(booking_no);
