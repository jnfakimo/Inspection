-- 非系統管理員大量讀取資料時，永久記錄該工作階段並立即停止後續資料存取。
-- security_session_blocks 只保存安全證據，不刪除任何業務資料或人員資料。

begin;

create table if not exists public.security_session_blocks (
  block_id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id uuid not null references public.users(user_id),
  alert_id uuid references public.security_alerts(alert_id),
  reason text not null default 'non_admin_bulk_read',
  details jsonb not null default '{}'::jsonb,
  blocked_at timestamptz not null default now(),
  constraint security_session_blocks_reason_check
    check (reason in ('non_admin_bulk_read'))
);

alter table public.security_session_blocks add column if not exists session_id text;
alter table public.security_session_blocks add column if not exists user_id uuid references public.users(user_id);
alter table public.security_session_blocks add column if not exists alert_id uuid references public.security_alerts(alert_id);
alter table public.security_session_blocks add column if not exists reason text not null default 'non_admin_bulk_read';
alter table public.security_session_blocks add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.security_session_blocks add column if not exists blocked_at timestamptz not null default now();

create unique index if not exists ux_security_session_blocks_session
  on public.security_session_blocks(session_id);
create index if not exists idx_security_session_blocks_user_time
  on public.security_session_blocks(user_id, blocked_at desc);
create index if not exists idx_security_session_blocks_alert
  on public.security_session_blocks(alert_id);

alter table public.security_session_blocks enable row level security;
alter table public.security_session_blocks force row level security;

drop policy if exists security_session_blocks_admin_read on public.security_session_blocks;
create policy security_session_blocks_admin_read on public.security_session_blocks
  for select to authenticated using (public.is_admin());

revoke all on table public.security_session_blocks from anon, authenticated;
grant select on table public.security_session_blocks to authenticated;

create or replace function public.security_session_allowed()
returns boolean
language sql
security definer
stable
set search_path=public,pg_temp
as $$
  select auth.uid() is not null
    and (
      nullif(auth.jwt() ->> 'session_id','') is null
      or not exists (
        select 1
        from public.security_session_blocks b
        where b.session_id = auth.jwt() ->> 'session_id'
      )
    )
$$;

revoke all on function public.security_session_allowed() from public,anon;
grant execute on function public.security_session_allowed() to authenticated;

-- 全站既有 RLS 都共用 active_user_id / active_rbac_role；在這一層加入
-- session 阻擋後，舊 JWT 即使尚未自然到期，也無法再通過資料讀取規則。
create or replace function public.active_user_id()
returns uuid language sql security definer stable
set search_path=public,pg_temp as $$
  select user_id from public.users
  where auth_id=auth.uid()
    and status='active'
    and public.security_session_allowed()
  limit 1
$$;

create or replace function public.active_rbac_role()
returns text language sql security definer stable
set search_path=public,pg_temp as $$
  select coalesce(
    rbac_role,
    case role
      when 'admin' then 'sysadmin'
      when 'supervisor' then 'unit_supervisor'
      when 'maintenance' then 'technician'
      when 'inspector' then 'reporter'
      else role
    end
  )
  from public.users
  where auth_id=auth.uid()
    and status='active'
    and public.security_session_allowed()
  limit 1
$$;

revoke all on function public.active_user_id() from public,anon;
revoke all on function public.active_rbac_role() from public,anon;
grant execute on function public.active_user_id() to authenticated;
grant execute on function public.active_rbac_role() to authenticated;

-- 會議室與推播訂閱曾使用「只要 authenticated 即可」的舊式規則，
-- 改為同樣尊重 session 阻擋，避免被強制離線後仍以舊 JWT 讀取。
do $$
begin
  if to_regclass('public.meeting_rooms') is not null then
    drop policy if exists meeting_rooms_authenticated_read on public.meeting_rooms;
    create policy meeting_rooms_authenticated_read on public.meeting_rooms
      for select to authenticated using (public.active_user_id() is not null);
  end if;

  if to_regclass('public.meeting_bookings') is not null then
    drop policy if exists meeting_bookings_authenticated_read on public.meeting_bookings;
    drop policy if exists meeting_bookings_own_insert on public.meeting_bookings;
    drop policy if exists meeting_bookings_own_or_admin_update on public.meeting_bookings;
    create policy meeting_bookings_authenticated_read on public.meeting_bookings
      for select to authenticated using (public.active_user_id() is not null);
    create policy meeting_bookings_own_insert on public.meeting_bookings
      for insert to authenticated with check (user_id=public.active_user_id());
    create policy meeting_bookings_own_or_admin_update on public.meeting_bookings
      for update to authenticated
      using (public.is_admin() or user_id=public.active_user_id())
      with check (public.is_admin() or user_id=public.active_user_id());
  end if;

  if to_regclass('public.meeting_booking_change_requests') is not null then
    drop policy if exists meeting_change_authenticated_select on public.meeting_booking_change_requests;
    create policy meeting_change_authenticated_select
      on public.meeting_booking_change_requests for select to authenticated using (
        public.active_user_id() is not null
        and (
          requester_id=public.active_user_id()
          or exists (
            select 1 from public.meeting_bookings b
            where b.booking_id=target_booking_id
              and b.user_id=public.active_user_id()
          )
        )
      );
  end if;

  if to_regclass('public.fcm_subscriptions') is not null then
    drop policy if exists fcm_subscriptions_select_own on public.fcm_subscriptions;
    drop policy if exists fcm_subscriptions_insert_own on public.fcm_subscriptions;
    drop policy if exists fcm_subscriptions_update_own on public.fcm_subscriptions;
    drop policy if exists fcm_subscriptions_delete_own on public.fcm_subscriptions;
    create policy fcm_subscriptions_select_own on public.fcm_subscriptions
      for select to authenticated using (public.security_session_allowed() and auth.uid()=user_id);
    create policy fcm_subscriptions_insert_own on public.fcm_subscriptions
      for insert to authenticated with check (public.security_session_allowed() and auth.uid()=user_id);
    create policy fcm_subscriptions_update_own on public.fcm_subscriptions
      for update to authenticated
      using (public.security_session_allowed() and auth.uid()=user_id)
      with check (public.security_session_allowed() and auth.uid()=user_id);
    create policy fcm_subscriptions_delete_own on public.fcm_subscriptions
      for delete to authenticated using (public.security_session_allowed() and auth.uid()=user_id);
  end if;
end
$$;

create or replace function public.reject_security_session_block_removal()
returns trigger
language plpgsql
as $$
begin
  raise exception '安全工作階段阻擋紀錄永久保存：禁止刪除或清空。'
    using errcode='55000';
end;
$$;

drop trigger if exists trg_prevent_security_session_block_removal on public.security_session_blocks;
create trigger trg_prevent_security_session_block_removal
  before delete or truncate on public.security_session_blocks
  for each statement execute function public.reject_security_session_block_removal();

comment on table public.security_session_blocks is
  '非系統管理員大量讀取後的永久工作階段阻擋與強制離線證據。';
comment on function public.security_session_allowed() is
  'RLS 共用防線：已被安全機制阻擋的 session_id 一律拒絕後續資料存取。';

commit;
