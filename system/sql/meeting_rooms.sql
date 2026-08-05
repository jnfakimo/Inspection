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
  booking_no    text unique,
  room_id       uuid not null references meeting_rooms(room_id),
  user_id       uuid references users(user_id),
  purpose       text,
  booker_phone  text,
  contact_phone text,
  booking_date  date not null,
  start_time    time not null,
  end_time      time not null,
  status        text not null default 'booked' check (status in ('booked','checked_in','cancelled','expired')),
  checked_in_at timestamptz,
  created_at    timestamptz default now()
);

-- create table if not exists 不會替既有環境增加欄位，故同步補上 idempotent ALTER。
alter table meeting_bookings add column if not exists booking_no text;
alter table meeting_bookings add column if not exists booker_phone text;
alter table meeting_bookings add column if not exists contact_phone text;

create sequence if not exists meeting_booking_no_seq;
revoke usage, select on sequence meeting_booking_no_seq from anon;
grant usage, select on sequence meeting_booking_no_seq to authenticated, service_role;
create or replace function gen_meeting_booking_no()
returns text language sql volatile as $$
  select 'MR-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(nextval('meeting_booking_no_seq')::text,6,'0')
$$;

update meeting_bookings
set booking_no='MR-' || to_char(booking_date,'YYYYMMDD') || '-' || lpad(nextval('meeting_booking_no_seq')::text,6,'0')
where booking_no is null;

alter table meeting_bookings alter column booking_no set default gen_meeting_booking_no();
create unique index if not exists uq_meeting_bookings_booking_no on meeting_bookings(booking_no);

alter table meeting_bookings drop constraint if exists meeting_bookings_valid_time;
alter table meeting_bookings add constraint meeting_bookings_valid_time check (end_time > start_time);
alter table meeting_bookings drop constraint if exists meeting_bookings_half_hour_slots;
alter table meeting_bookings add constraint meeting_bookings_half_hour_slots check (
  extract(minute from start_time) in (0,30) and extract(second from start_time)=0 and
  extract(minute from end_time) in (0,30) and extract(second from end_time)=0
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

-- 4) 輸入稽核：禁止過去時段；系統電話空白時，聯繫電話必填。
create or replace function guard_meeting_booking_input()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status in ('booked','checked_in') and ((new.booking_date+new.start_time) at time zone 'Asia/Taipei')<=now() then
    raise exception using errcode='22023',message='開始時間已經過去，不能預約過去時段';
  end if;
  if nullif(btrim(coalesce(new.booker_phone,'')),'') is null and nullif(btrim(coalesce(new.contact_phone,'')),'') is null then
    raise exception using errcode='23514',message='系統未登記電話，聯繫電話為必填';
  end if;
  if nullif(btrim(coalesce(new.contact_phone,'')),'') is not null and length(regexp_replace(new.contact_phone,'[^0-9#*]','','g'))<4 then
    raise exception using errcode='23514',message='聯繫電話請至少填寫 4 碼的電話或分機';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_meeting_booking_input on meeting_bookings;
create trigger trg_guard_meeting_booking_input
  before insert or update of room_id,booking_date,start_time,end_time,booker_phone,contact_phone on meeting_bookings
  for each row execute function guard_meeting_booking_input();

-- 5) 單筆／每週週期預約：先稽核完整週期，無衝突才在同一交易內全部建立。
create or replace function create_meeting_booking_series(
  p_room_id uuid,p_purpose text,p_booking_date date,p_start_time time,p_end_time time,
  p_booker_phone text default null,p_contact_phone text default null,
  p_repeat_weekly boolean default false,p_repeat_until date default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor users%rowtype; candidate_date date; final_date date; occurrence_count integer:=0;
  conflict_no text; conflict_start time; conflict_end time; new_booking meeting_bookings%rowtype;
  created_bookings jsonb:='[]'::jsonb;
begin
  select * into actor from users where auth_id=auth.uid() and status='active' limit 1;
  if actor.user_id is null then raise exception '找不到有效的登入人員'; end if;
  if not exists(select 1 from meeting_rooms where room_id=p_room_id and status='active') then raise exception '找不到可預約的會議室'; end if;
  if nullif(btrim(coalesce(p_purpose,'')),'') is null then raise exception '請填寫會議名稱'; end if;
  if p_booking_date is null or p_start_time is null or p_end_time is null then raise exception '請填寫完整的日期與時段'; end if;
  if p_end_time<=p_start_time then raise exception '結束時間必須晚於開始時間'; end if;
  if extract(minute from p_start_time) not in (0,30) or extract(second from p_start_time)<>0 or extract(minute from p_end_time) not in (0,30) or extract(second from p_end_time)<>0 then raise exception '預約時間只能使用 00 或 30 分'; end if;
  if ((p_booking_date+p_start_time) at time zone 'Asia/Taipei')<=now() then raise exception '開始時間已經過去，不能預約過去時段'; end if;
  if nullif(btrim(coalesce(p_booker_phone,'')),'') is null and nullif(btrim(coalesce(p_contact_phone,'')),'') is null then raise exception '系統未登記電話，聯繫電話為必填'; end if;
  if nullif(btrim(coalesce(p_contact_phone,'')),'') is not null and length(regexp_replace(p_contact_phone,'[^0-9#*]','','g'))<4 then raise exception '聯繫電話請至少填寫 4 碼的電話或分機'; end if;
  final_date:=case when p_repeat_weekly then p_repeat_until else p_booking_date end;
  if final_date is null then raise exception '請選擇週期截止日期'; end if;
  if final_date<p_booking_date then raise exception '週期截止日期不得早於首次預約日期'; end if;
  if p_repeat_weekly and final_date>p_booking_date+357 then raise exception '週期預約最多 52 次'; end if;
  candidate_date:=p_booking_date;
  while candidate_date<=final_date loop
    occurrence_count:=occurrence_count+1; if occurrence_count>52 then raise exception '週期預約最多 52 次'; end if;
    conflict_no:=null;
    select b.booking_no,b.start_time,b.end_time into conflict_no,conflict_start,conflict_end from meeting_bookings b
      where b.room_id=p_room_id and b.booking_date=candidate_date and b.status in ('booked','checked_in') and p_start_time<b.end_time and p_end_time>b.start_time order by b.start_time limit 1;
    if conflict_no is not null then raise exception '週期預約衝突：% 已有預約單號 %（%–%）',candidate_date,conflict_no,to_char(conflict_start,'HH24:MI'),to_char(conflict_end,'HH24:MI'); end if;
    candidate_date:=candidate_date+7;
  end loop;
  candidate_date:=p_booking_date;
  while candidate_date<=final_date loop
    insert into meeting_bookings(room_id,user_id,purpose,booker_phone,contact_phone,booking_date,start_time,end_time,status)
      values(p_room_id,actor.user_id,btrim(p_purpose),nullif(btrim(coalesce(p_booker_phone,'')),''),nullif(btrim(coalesce(p_contact_phone,'')),''),candidate_date,p_start_time,p_end_time,'booked') returning * into new_booking;
    created_bookings:=created_bookings||jsonb_build_array(jsonb_build_object('booking_id',new_booking.booking_id,'booking_no',new_booking.booking_no,'booking_date',new_booking.booking_date));
    insert into audit_logs(table_name,record_id,action,changes,operator_id,source) values('meeting_bookings',new_booking.booking_id::text,'insert',jsonb_build_object('booking_no',new_booking.booking_no,'booking_date',new_booking.booking_date,'start_time',p_start_time,'end_time',p_end_time,'repeat_weekly',p_repeat_weekly,'repeat_until',case when p_repeat_weekly then final_date else null end),actor.user_id,'meetingroom');
    candidate_date:=candidate_date+7;
  end loop;
  return jsonb_build_object('count',occurrence_count,'repeat_weekly',p_repeat_weekly,'bookings',created_bookings);
end;
$$;
revoke all on function create_meeting_booking_series(uuid,text,date,time,time,text,text,boolean,date) from public,anon;
grant execute on function create_meeting_booking_series(uuid,text,date,time,time,text,text,boolean,date) to authenticated;

-- ── RLS：會議室資料僅供已登入人員使用 ───────────────────────
alter table meeting_rooms enable row level security;
alter table meeting_rooms force row level security;
alter table meeting_bookings enable row level security;
alter table meeting_bookings force row level security;
revoke all on table meeting_rooms from anon;
revoke all on table meeting_bookings from anon;
drop policy if exists "allow_all_for_now" on meeting_rooms;
drop policy if exists "allow_all_for_now" on meeting_bookings;
drop policy if exists "authenticated_only" on meeting_rooms;
drop policy if exists "authenticated_only" on meeting_bookings;
create policy "authenticated_only" on meeting_rooms for all to authenticated using (true) with check (true);
create policy "authenticated_only" on meeting_bookings for all to authenticated using (true) with check (true);

-- ── 永久資料保護 ──────────────────────────────────────────
-- meeting_rooms/meeting_bookings 已加進 permanent_data_protection.sql 的保護
-- 清單；建好這兩張表後，請「重新跑一次」permanent_data_protection.sql
-- （該檔是 idempotent，重跑安全）才會把禁止 DELETE/TRUNCATE 的觸發器
-- 實際掛上這兩張新表。

commit;
