-- 會議室預約：禁止過去時段、電話條件稽核、每週週期預約原子建立。
begin;

create or replace function public.guard_meeting_booking_input()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.status in ('booked','checked_in')
     and ((new.booking_date+new.start_time) at time zone 'Asia/Taipei')<=now() then
    raise exception using errcode='22023',message='開始時間已經過去，不能預約過去時段';
  end if;
  if nullif(btrim(coalesce(new.booker_phone,'')),'') is null
     and nullif(btrim(coalesce(new.contact_phone,'')),'') is null then
    raise exception using errcode='23514',message='系統未登記電話，聯繫電話為必填';
  end if;
  if nullif(btrim(coalesce(new.contact_phone,'')),'') is not null
     and length(regexp_replace(new.contact_phone,'[^0-9#*]','','g'))<4 then
    raise exception using errcode='23514',message='聯繫電話請至少填寫 4 碼的電話或分機';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_meeting_booking_input on public.meeting_bookings;
create trigger trg_guard_meeting_booking_input
  before insert or update of room_id,booking_date,start_time,end_time,booker_phone,contact_phone
  on public.meeting_bookings
  for each row execute function public.guard_meeting_booking_input();

create or replace function public.create_meeting_booking_series(
  p_room_id uuid,
  p_purpose text,
  p_booking_date date,
  p_start_time time,
  p_end_time time,
  p_booker_phone text default null,
  p_contact_phone text default null,
  p_repeat_weekly boolean default false,
  p_repeat_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.users%rowtype;
  candidate_date date;
  final_date date;
  occurrence_count integer:=0;
  conflict_no text;
  conflict_start time;
  conflict_end time;
  new_booking public.meeting_bookings%rowtype;
  created_bookings jsonb:='[]'::jsonb;
begin
  select * into actor from public.users where auth_id=auth.uid() and status='active' limit 1;
  if actor.user_id is null then raise exception '找不到有效的登入人員'; end if;
  if not exists(select 1 from public.meeting_rooms where room_id=p_room_id and status='active') then raise exception '找不到可預約的會議室'; end if;
  if nullif(btrim(coalesce(p_purpose,'')),'') is null then raise exception '請填寫會議名稱'; end if;
  if p_booking_date is null or p_start_time is null or p_end_time is null then raise exception '請填寫完整的日期與時段'; end if;
  if p_end_time<=p_start_time then raise exception '結束時間必須晚於開始時間'; end if;
  if extract(minute from p_start_time) not in (0,30) or extract(second from p_start_time)<>0
     or extract(minute from p_end_time) not in (0,30) or extract(second from p_end_time)<>0 then
    raise exception '預約時間只能使用 00 或 30 分';
  end if;
  if ((p_booking_date+p_start_time) at time zone 'Asia/Taipei')<=now() then raise exception '開始時間已經過去，不能預約過去時段'; end if;
  if nullif(btrim(coalesce(p_booker_phone,'')),'') is null and nullif(btrim(coalesce(p_contact_phone,'')),'') is null then
    raise exception '系統未登記電話，聯繫電話為必填';
  end if;
  if nullif(btrim(coalesce(p_contact_phone,'')),'') is not null
     and length(regexp_replace(p_contact_phone,'[^0-9#*]','','g'))<4 then
    raise exception '聯繫電話請至少填寫 4 碼的電話或分機';
  end if;

  final_date:=case when p_repeat_weekly then p_repeat_until else p_booking_date end;
  if final_date is null then raise exception '請選擇週期截止日期'; end if;
  if final_date<p_booking_date then raise exception '週期截止日期不得早於首次預約日期'; end if;
  if p_repeat_weekly and final_date>p_booking_date+357 then raise exception '週期預約最多 52 次'; end if;

  candidate_date:=p_booking_date;
  while candidate_date<=final_date loop
    occurrence_count:=occurrence_count+1;
    if occurrence_count>52 then raise exception '週期預約最多 52 次'; end if;
    conflict_no:=null;
    select b.booking_no,b.start_time,b.end_time into conflict_no,conflict_start,conflict_end
    from public.meeting_bookings b
    where b.room_id=p_room_id and b.booking_date=candidate_date
      and b.status in ('booked','checked_in')
      and p_start_time<b.end_time and p_end_time>b.start_time
    order by b.start_time limit 1;
    if conflict_no is not null then
      raise exception '週期預約衝突：% 已有預約單號 %（%–%）',candidate_date,conflict_no,to_char(conflict_start,'HH24:MI'),to_char(conflict_end,'HH24:MI');
    end if;
    candidate_date:=candidate_date+7;
  end loop;

  candidate_date:=p_booking_date;
  while candidate_date<=final_date loop
    insert into public.meeting_bookings(room_id,user_id,purpose,booker_phone,contact_phone,booking_date,start_time,end_time,status)
    values (p_room_id,actor.user_id,btrim(p_purpose),nullif(btrim(coalesce(p_booker_phone,'')),''),nullif(btrim(coalesce(p_contact_phone,'')),''),candidate_date,p_start_time,p_end_time,'booked')
    returning * into new_booking;
    created_bookings:=created_bookings||jsonb_build_array(jsonb_build_object('booking_id',new_booking.booking_id,'booking_no',new_booking.booking_no,'booking_date',new_booking.booking_date));
    insert into public.audit_logs(table_name,record_id,action,changes,operator_id,source)
    values ('meeting_bookings',new_booking.booking_id::text,'insert',jsonb_build_object('booking_no',new_booking.booking_no,'booking_date',new_booking.booking_date,'start_time',p_start_time,'end_time',p_end_time,'repeat_weekly',p_repeat_weekly,'repeat_until',case when p_repeat_weekly then final_date else null end),actor.user_id,'meetingroom');
    candidate_date:=candidate_date+7;
  end loop;

  return jsonb_build_object('count',occurrence_count,'repeat_weekly',p_repeat_weekly,'bookings',created_bookings);
end;
$$;

revoke all on function public.create_meeting_booking_series(uuid,text,date,time,time,text,text,boolean,date) from public,anon;
grant execute on function public.create_meeting_booking_series(uuid,text,date,time,time,text,text,boolean,date) to authenticated;

commit;
