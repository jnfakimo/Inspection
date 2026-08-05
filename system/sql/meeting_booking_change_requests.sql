-- ============================================================
-- 會議室預約變更申請與本人取消
-- 原申請人同意時，以單一資料庫交易取消原預約並建立申請者的新預約。
-- ============================================================

begin;

create table if not exists meeting_booking_change_requests (
  request_id             uuid primary key default gen_random_uuid(),
  target_booking_id      uuid not null references meeting_bookings(booking_id),
  requester_id           uuid not null references users(user_id),
  requested_meeting_name text not null,
  requester_phone        text,
  contact_phone          text not null,
  reason                 text,
  status                 text not null default 'pending'
                         check (status in ('pending','approved','rejected','cancelled')),
  responded_by           uuid references users(user_id),
  responded_at           timestamptz,
  response_note          text,
  created_booking_id     uuid references meeting_bookings(booking_id),
  created_at             timestamptz not null default now()
);

alter table meeting_booking_change_requests add column if not exists requested_meeting_name text;
alter table meeting_booking_change_requests add column if not exists requester_phone text;
alter table meeting_booking_change_requests add column if not exists contact_phone text;
alter table meeting_booking_change_requests add column if not exists reason text;
alter table meeting_booking_change_requests add column if not exists status text default 'pending';
alter table meeting_booking_change_requests add column if not exists responded_by uuid references users(user_id);
alter table meeting_booking_change_requests add column if not exists responded_at timestamptz;
alter table meeting_booking_change_requests add column if not exists response_note text;
alter table meeting_booking_change_requests add column if not exists created_booking_id uuid references meeting_bookings(booking_id);
alter table meeting_booking_change_requests add column if not exists created_at timestamptz default now();

create index if not exists idx_meeting_change_target on meeting_booking_change_requests(target_booking_id,created_at desc);
create index if not exists idx_meeting_change_requester on meeting_booking_change_requests(requester_id,created_at desc);
create unique index if not exists uq_meeting_change_pending_requester
  on meeting_booking_change_requests(target_booking_id,requester_id)
  where status='pending';

alter table meeting_booking_change_requests enable row level security;
drop policy if exists "meeting_change_authenticated_select" on meeting_booking_change_requests;
create policy "meeting_change_authenticated_select"
  on meeting_booking_change_requests for select to authenticated using (
    requester_id in (select user_id from users where auth_id=auth.uid() and status='active')
    or exists (
      select 1 from meeting_bookings b
      join users u on u.user_id=b.user_id
      where b.booking_id=target_booking_id and u.auth_id=auth.uid() and u.status='active'
    )
  );
grant select on meeting_booking_change_requests to authenticated;

create or replace function create_meeting_booking_change_request(
  p_target_booking_id uuid,
  p_meeting_name text,
  p_contact_phone text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  actor users%rowtype;
  target meeting_bookings%rowtype;
  new_request_id uuid;
begin
  select * into actor from users where auth_id=auth.uid() and status='active' limit 1;
  if actor.user_id is null then raise exception '找不到有效的登入人員'; end if;
  if nullif(btrim(p_meeting_name),'') is null then raise exception '請填寫會議名稱'; end if;
  if length(regexp_replace(coalesce(p_contact_phone,''),'[^0-9#*]','','g')) < 4 then
    raise exception '請填寫至少 4 碼的聯繫電話或分機';
  end if;

  select * into target from meeting_bookings where booking_id=p_target_booking_id for share;
  if target.booking_id is null then raise exception '找不到原預約'; end if;
  if target.user_id is null then raise exception '原預約沒有可審核的申請人'; end if;
  if target.user_id=actor.user_id then raise exception '自己的預約請直接使用取消功能'; end if;
  if target.status<>'booked' then raise exception '原預約目前無法提出變更申請'; end if;
  if ((target.booking_date+target.end_time) at time zone 'Asia/Taipei')<=now() then
    raise exception '已結束的預約不能提出變更申請';
  end if;

  insert into meeting_booking_change_requests(
    target_booking_id,requester_id,requested_meeting_name,requester_phone,contact_phone,reason
  ) values (
    target.booking_id,actor.user_id,btrim(p_meeting_name),actor.phone,btrim(p_contact_phone),nullif(btrim(p_reason),'')
  ) returning request_id into new_request_id;

  insert into audit_logs(table_name,record_id,action,changes,operator_id,source)
  values (
    'meeting_booking_change_requests',new_request_id::text,'insert',
    jsonb_build_object('target_booking_id',target.booking_id,'status','pending'),
    actor.user_id,'meetingroom'
  );
  return new_request_id;
exception
  when unique_violation then raise exception '你已對此預約提出待審中的變更申請';
end;
$$;

create or replace function respond_meeting_booking_change_request(
  p_request_id uuid,
  p_approve boolean
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor users%rowtype;
  req meeting_booking_change_requests%rowtype;
  target meeting_bookings%rowtype;
  new_booking meeting_bookings%rowtype;
begin
  select * into actor from users where auth_id=auth.uid() and status='active' limit 1;
  if actor.user_id is null then raise exception '找不到有效的登入人員'; end if;

  select * into req from meeting_booking_change_requests where request_id=p_request_id for update;
  if req.request_id is null then raise exception '找不到變更申請'; end if;
  if req.status<>'pending' then raise exception '此申請已經處理'; end if;

  select * into target from meeting_bookings where booking_id=req.target_booking_id for update;
  if target.booking_id is null then raise exception '找不到原預約'; end if;
  if target.user_id is null or target.user_id<>actor.user_id then raise exception '只有原申請人可以審核此變更申請'; end if;

  if not p_approve then
    update meeting_booking_change_requests
    set status='rejected',responded_by=actor.user_id,responded_at=now()
    where request_id=req.request_id;
    insert into audit_logs(table_name,record_id,action,changes,operator_id,source)
    values (
      'meeting_booking_change_requests',req.request_id::text,'update',
      jsonb_build_object('before',jsonb_build_object('status','pending'),'after',jsonb_build_object('status','rejected')),
      actor.user_id,'meetingroom'
    );
    return jsonb_build_object('status','rejected');
  end if;

  if target.status<>'booked' then raise exception '原預約狀態已變更，無法同意'; end if;
  if ((target.booking_date+target.end_time) at time zone 'Asia/Taipei')<=now() then
    raise exception '原預約已結束，無法同意';
  end if;

  update meeting_bookings set status='cancelled' where booking_id=target.booking_id;

  insert into meeting_bookings(
    room_id,user_id,purpose,booker_phone,contact_phone,booking_date,start_time,end_time,status
  ) values (
    target.room_id,req.requester_id,req.requested_meeting_name,req.requester_phone,
    req.contact_phone,target.booking_date,target.start_time,target.end_time,'booked'
  ) returning * into new_booking;

  update meeting_booking_change_requests
  set status='approved',responded_by=actor.user_id,responded_at=now(),created_booking_id=new_booking.booking_id
  where request_id=req.request_id;

  update meeting_booking_change_requests
  set status='rejected',responded_by=actor.user_id,responded_at=now(),
      response_note='原預約已由其他申請者承接'
  where target_booking_id=target.booking_id and request_id<>req.request_id and status='pending';

  insert into audit_logs(table_name,record_id,action,changes,operator_id,source)
  values (
    'meeting_bookings',target.booking_id::text,'update',
    jsonb_build_object('before',jsonb_build_object('status','booked'),'after',jsonb_build_object('status','cancelled'),'change_request_id',req.request_id),
    actor.user_id,'meetingroom'
  );
  insert into audit_logs(table_name,record_id,action,changes,operator_id,source)
  values (
    'meeting_bookings',new_booking.booking_id::text,'insert',
    jsonb_build_object('booking_no',new_booking.booking_no,'source_request_id',req.request_id),
    actor.user_id,'meetingroom'
  );
  return jsonb_build_object('status','approved','booking_id',new_booking.booking_id,'booking_no',new_booking.booking_no);
end;
$$;

create or replace function cancel_own_meeting_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  actor users%rowtype;
  target meeting_bookings%rowtype;
begin
  select * into actor from users where auth_id=auth.uid() and status='active' limit 1;
  if actor.user_id is null then raise exception '找不到有效的登入人員'; end if;

  select * into target from meeting_bookings where booking_id=p_booking_id for update;
  if target.booking_id is null then raise exception '找不到預約'; end if;
  if target.user_id<>actor.user_id then raise exception '只能取消自己的預約'; end if;
  if target.status<>'booked' then raise exception '此預約目前無法取消'; end if;

  update meeting_bookings set status='cancelled' where booking_id=target.booking_id;
  update meeting_booking_change_requests
  set status='cancelled',responded_by=actor.user_id,responded_at=now(),response_note='原申請人已取消預約'
  where target_booking_id=target.booking_id and status='pending';

  insert into audit_logs(table_name,record_id,action,changes,operator_id,source)
  values (
    'meeting_bookings',target.booking_id::text,'update',
    jsonb_build_object('before',jsonb_build_object('status','booked'),'after',jsonb_build_object('status','cancelled')),
    actor.user_id,'meetingroom'
  );
  return true;
end;
$$;

revoke all on function create_meeting_booking_change_request(uuid,text,text,text) from public,anon;
revoke all on function respond_meeting_booking_change_request(uuid,boolean) from public,anon;
revoke all on function cancel_own_meeting_booking(uuid) from public,anon;
grant execute on function create_meeting_booking_change_request(uuid,text,text,text) to authenticated;
grant execute on function respond_meeting_booking_change_request(uuid,boolean) to authenticated;
grant execute on function cancel_own_meeting_booking(uuid) to authenticated;

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on meeting_booking_change_requests;
    create trigger trg_prevent_removal
      before delete or truncate on meeting_booking_change_requests
      for each statement execute function reject_physical_data_removal();
  end if;
end $$;

commit;
