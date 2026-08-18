-- 個人 Google Calendar OAuth 連線與會議預約同步佇列。
-- Token 僅由 Edge Function 以 GOOGLE_TOKEN_ENCRYPTION_KEY 加密後寫入，前端與 authenticated 角色不可讀取。
begin;

create table if not exists public.google_calendar_connections (
  connection_id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(user_id),
  google_subject text,
  google_email text not null,
  refresh_token_ciphertext text,
  granted_scope text,
  status text not null default 'active' check (status in ('active','disconnected','error')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  user_id uuid not null references public.users(user_id),
  return_to text not null,
  pkce_verifier_ciphertext text not null,
  user_agent_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.google_calendar_oauth_states add column if not exists pkce_verifier_ciphertext text;
alter table public.google_calendar_oauth_states add column if not exists user_agent_hash text;
-- OAuth state 最長僅存 10 分鐘；升級舊版結構時安全地清除未完成授權，再套用必填限制。
delete from public.google_calendar_oauth_states;
alter table public.google_calendar_oauth_states alter column pkce_verifier_ciphertext set not null;
alter table public.google_calendar_oauth_states alter column user_agent_hash set not null;

alter table public.meeting_bookings add column if not exists google_sync_enabled boolean not null default true;
alter table public.meeting_bookings add column if not exists google_event_id text;
alter table public.meeting_bookings add column if not exists google_calendar_sync_status text not null default 'not_connected';
alter table public.meeting_bookings add column if not exists google_calendar_synced_at timestamptz;
alter table public.meeting_bookings add column if not exists google_calendar_sync_error text;

do $$ begin
  alter table public.meeting_bookings add constraint meeting_bookings_google_sync_status_check
    check (google_calendar_sync_status in ('not_connected','disabled','pending','processing','synced','failed','cancelled'));
exception when duplicate_object then null;
end $$;

-- Google event ID 與同步狀態只能由受信任的 Edge Function／SECURITY DEFINER RPC 修改，
-- 避免瀏覽器偽造 event ID，誘使 worker 改寫或刪除使用者其他私人行程。
create or replace function public.protect_google_calendar_booking_fields()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' and (
      new.google_sync_enabled is distinct from true or new.google_event_id is not null
      or new.google_calendar_sync_status is distinct from 'not_connected'
      or new.google_calendar_synced_at is not null or new.google_calendar_sync_error is not null
    ) then raise exception 'Google 行事曆欄位不可由前端指定' using errcode='42501';
    elsif tg_op='UPDATE' and (
      new.google_sync_enabled is distinct from old.google_sync_enabled
      or new.google_event_id is distinct from old.google_event_id
      or new.google_calendar_sync_status is distinct from old.google_calendar_sync_status
      or new.google_calendar_synced_at is distinct from old.google_calendar_synced_at
      or new.google_calendar_sync_error is distinct from old.google_calendar_sync_error
    ) then raise exception 'Google 行事曆欄位不可由前端修改' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_google_calendar_booking_fields on public.meeting_bookings;
create trigger trg_protect_google_calendar_booking_fields
  before insert or update on public.meeting_bookings
  for each row execute function public.protect_google_calendar_booking_fields();
revoke all on function public.protect_google_calendar_booking_fields() from public,anon,authenticated;

create table if not exists public.google_calendar_sync_jobs (
  job_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.meeting_bookings(booking_id),
  action text not null check (action in ('upsert','delete')),
  status text not null default 'pending' check (status in ('pending','processing','synced','failed','skipped')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_google_calendar_sync_jobs_pending
  on public.google_calendar_sync_jobs(status,next_attempt_at,created_at);
create index if not exists idx_google_calendar_oauth_states_expiry
  on public.google_calendar_oauth_states(expires_at);
create unique index if not exists uq_google_calendar_connections_subject
  on public.google_calendar_connections(google_subject) where google_subject is not null;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_connections force row level security;
alter table public.google_calendar_connections add column if not exists google_subject text;
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_oauth_states force row level security;
alter table public.google_calendar_sync_jobs enable row level security;
alter table public.google_calendar_sync_jobs force row level security;

revoke all on table public.google_calendar_connections from public,anon,authenticated;
revoke all on table public.google_calendar_oauth_states from public,anon,authenticated;
revoke all on table public.google_calendar_sync_jobs from public,anon,authenticated;

create or replace function public.enqueue_google_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  requested_action text;
begin
  if not new.google_sync_enabled then
    if new.google_event_id is null then
      update public.meeting_bookings
      set google_calendar_sync_status='disabled',google_calendar_sync_error=null
      where booking_id=new.booking_id;
      delete from public.google_calendar_sync_jobs where booking_id=new.booking_id;
      return new;
    end if;
    requested_action:='delete';
  elsif new.status='cancelled' then
    if new.google_event_id is null then
      update public.meeting_bookings
      set google_calendar_sync_status='cancelled',google_calendar_sync_error=null
      where booking_id=new.booking_id;
      delete from public.google_calendar_sync_jobs where booking_id=new.booking_id;
      return new;
    end if;
    requested_action:='delete';
  elsif new.status in ('booked','checked_in') then
    requested_action:='upsert';
  else
    return new;
  end if;

  insert into public.google_calendar_sync_jobs(booking_id,action,status,attempt_count,next_attempt_at,last_error,updated_at)
  values(new.booking_id,requested_action,'pending',0,now(),null,now())
  on conflict(booking_id) do update set
    action=excluded.action,status='pending',attempt_count=0,next_attempt_at=now(),last_error=null,updated_at=now();

  update public.meeting_bookings
  set google_calendar_sync_status='pending',google_calendar_sync_error=null
  where booking_id=new.booking_id;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_google_calendar_sync on public.meeting_bookings;
create trigger trg_enqueue_google_calendar_sync
  after insert or update of room_id,user_id,purpose,booking_date,start_time,end_time,status,google_sync_enabled
  on public.meeting_bookings
  for each row execute function public.enqueue_google_calendar_sync();

revoke all on function public.enqueue_google_calendar_sync() from public,anon,authenticated;

-- 前端不可直接更新預約列；僅允許本人針對自己剛建立的預約切換同步設定。
create or replace function public.set_own_meeting_booking_google_sync(
  p_booking_ids uuid[],
  p_enabled boolean
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid;
  changed_count integer;
begin
  select user_id into actor_id from public.users
  where auth_id=auth.uid() and status='active';
  if actor_id is null then raise exception '找不到有效登入帳號'; end if;
  if coalesce(array_length(p_booking_ids,1),0)=0 or array_length(p_booking_ids,1)>52 then
    raise exception '預約清單無效';
  end if;
  update public.meeting_bookings
  set google_sync_enabled=coalesce(p_enabled,false)
  where booking_id=any(p_booking_ids) and user_id=actor_id;
  get diagnostics changed_count=row_count;
  return changed_count;
end;
$$;

revoke all on function public.set_own_meeting_booking_google_sync(uuid[],boolean) from public,anon;
grant execute on function public.set_own_meeting_booking_google_sync(uuid[],boolean) to authenticated;

-- Worker 以單一交易原子領取工作，避免兩個執行程序同時建立重複活動。
create or replace function public.claim_google_calendar_sync_jobs(p_limit integer default 20)
returns setof public.google_calendar_sync_jobs
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if p_limit not between 1 and 50 then raise exception '批次數量無效'; end if;
  return query
  with candidates as (
    select queued.job_id from public.google_calendar_sync_jobs queued
    where queued.status in ('pending','failed') and queued.next_attempt_at<=now() and queued.attempt_count<5
    order by queued.next_attempt_at,queued.created_at
    for update skip locked
    limit p_limit
  )
  update public.google_calendar_sync_jobs jobs
  set status='processing',updated_at=now()
  from candidates
  where jobs.job_id=candidates.job_id
  returning jobs.*;
end;
$$;

revoke all on function public.claim_google_calendar_sync_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_google_calendar_sync_jobs(integer) to service_role;

commit;
