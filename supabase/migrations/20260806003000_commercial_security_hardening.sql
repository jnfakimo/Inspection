-- Commercial security hardening: meeting-room RLS and anonymous grants.
-- Idempotent and data-preserving. No rows are deleted or rewritten.

begin;

alter table public.meeting_rooms enable row level security;
alter table public.meeting_rooms force row level security;
alter table public.meeting_bookings enable row level security;
alter table public.meeting_bookings force row level security;

revoke all on table public.meeting_rooms from anon;
revoke all on table public.meeting_bookings from anon;
revoke usage, select on sequence public.meeting_booking_no_seq from anon;

-- Remove legacy/public policies, including policies created manually in the
-- dashboard under names that are not present in the checked-in SQL.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
      and tablename in ('meeting_rooms','meeting_bookings')
  loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

create policy "meeting_rooms_authenticated_read"
  on public.meeting_rooms for select to authenticated
  using (true);

create policy "meeting_rooms_admin_insert"
  on public.meeting_rooms for insert to authenticated
  with check (public.is_admin());

create policy "meeting_rooms_admin_update"
  on public.meeting_rooms for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "meeting_bookings_authenticated_read"
  on public.meeting_bookings for select to authenticated
  using (true);

create policy "meeting_bookings_own_insert"
  on public.meeting_bookings for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.user_id=meeting_bookings.user_id
        and u.auth_id=auth.uid()
        and u.status='active'
    )
  );

create policy "meeting_bookings_own_or_admin_update"
  on public.meeting_bookings for update to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.users u
      where u.user_id=meeting_bookings.user_id
        and u.auth_id=auth.uid()
        and u.status='active'
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.users u
      where u.user_id=meeting_bookings.user_id
        and u.auth_id=auth.uid()
        and u.status='active'
    )
  );

grant select on table public.meeting_rooms to authenticated;
grant insert, update on table public.meeting_rooms to authenticated;
grant select, insert, update on table public.meeting_bookings to authenticated;
grant usage, select on sequence public.meeting_booking_no_seq to authenticated, service_role;
commit;
