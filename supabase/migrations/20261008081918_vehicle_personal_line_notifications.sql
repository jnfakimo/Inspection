-- Server-owned personal vehicle LINE preferences and an isolated synthetic test path.
-- This migration changes local schema only; it does not send messages or schedule work.
begin;

create table if not exists public.vehicle_line_notification_settings (
  singleton_id boolean primary key default true check (singleton_id),
  personal_enabled boolean not null default false,
  assignment_enabled boolean not null default false,
  assignment_revoked_enabled boolean not null default false,
  test_enabled boolean not null default false,
  test_recipient_user_id uuid references public.users(user_id) on delete restrict,
  updated_by uuid references public.users(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.vehicle_line_notification_settings(singleton_id)
values (true)
on conflict (singleton_id) do nothing;

alter table public.vehicle_line_notification_settings enable row level security;
revoke all on public.vehicle_line_notification_settings from public, anon, authenticated;
grant select, insert, update on public.vehicle_line_notification_settings to service_role;

comment on table public.vehicle_line_notification_settings is
  'Server-owned preferences for personal vehicle LINE notices. All switches default off; group LINE settings are separate.';
comment on column public.vehicle_line_notification_settings.test_recipient_user_id is
  'Server-resolved active profile for the single synthetic test recipient; never supplied by the browser.';

create table if not exists public.vehicle_line_notification_test_runs (
  test_run_id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.users(user_id) on delete restrict,
  created_by uuid not null references public.users(user_id) on delete restrict,
  state text not null default 'pending' check (state in (
    'pending', 'leased', 'sending', 'accepted', 'uncertain', 'dead_letter', 'suppressed', 'cancelled'
  )),
  retry_key uuid not null default gen_random_uuid() unique,
  attempts smallint not null default 0 check (attempts between 0 and 1),
  lease_token uuid,
  lease_expires_at timestamptz,
  first_attempt_at timestamptz,
  accepted_at timestamptz,
  provider_http_status smallint check (provider_http_status between 100 and 599),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  constraint vehicle_line_notification_test_run_lease_check check (
    (state in ('leased', 'sending') and lease_token is not null and lease_expires_at is not null)
    or (state not in ('leased', 'sending') and lease_token is null and lease_expires_at is null)
  ),
  constraint vehicle_line_notification_test_run_accepted_check check (
    (state = 'accepted' and accepted_at is not null)
    or (state <> 'accepted' and accepted_at is null)
  )
);

create index if not exists idx_vehicle_line_notification_test_runs_pending
  on public.vehicle_line_notification_test_runs(created_at)
  where state in ('pending', 'leased');
alter table public.vehicle_line_notification_test_runs enable row level security;
revoke all on public.vehicle_line_notification_test_runs from public, anon, authenticated;
grant all on public.vehicle_line_notification_test_runs to service_role;
comment on table public.vehicle_line_notification_test_runs is
  'One-use synthetic LINE test events. No vehicle request id or dispatch data is stored; tests are never claimed by production batches.';

create or replace function public.vehicle_line_personal_event_enabled(p_event_type text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select s.personal_enabled and case p_event_type
        when 'assignment' then s.assignment_enabled
        when 'assignment_revoked' then s.assignment_revoked_enabled
        else false
      end
    from public.vehicle_line_notification_settings s
    where s.singleton_id = true
  ), false);
$$;
revoke all on function public.vehicle_line_personal_event_enabled(text) from public, anon, authenticated;
grant execute on function public.vehicle_line_personal_event_enabled(text) to service_role;

-- Close the rollout gap: the earlier outbox trigger can enqueue before this
-- preference gate is installed. Disabled rows must not become a backlog that
-- is released if an administrator enables notifications later.
update public.vehicle_dispatch_notification_outbox o
set state = case when o.state = 'sending' then 'uncertain' else 'cancelled' end,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = case when o.state = 'sending'
      then 'preferences_changed_in_flight' else 'preferences_disabled' end,
    updated_at = now()
where o.state in ('pending', 'retry_wait', 'leased', 'sending')
  and not public.vehicle_line_personal_event_enabled(o.event_type);

create or replace function public.guard_vehicle_dispatch_line_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.vehicle_line_personal_event_enabled(new.event_type) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_vehicle_dispatch_line_notification_insert() from public, anon, authenticated;

drop trigger if exists trg_guard_vehicle_dispatch_line_notification_insert
  on public.vehicle_dispatch_notification_outbox;
create trigger trg_guard_vehicle_dispatch_line_notification_insert
  before insert on public.vehicle_dispatch_notification_outbox
  for each row execute function public.guard_vehicle_dispatch_line_notification_insert();

create or replace function public.save_vehicle_line_notification_settings(
  p_personal_enabled boolean,
  p_assignment_enabled boolean,
  p_assignment_revoked_enabled boolean,
  p_test_enabled boolean,
  p_test_recipient_user_id uuid,
  p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_personal_enabled is null or p_assignment_enabled is null
      or p_assignment_revoked_enabled is null or p_test_enabled is null then
    raise exception 'invalid_notification_preferences' using errcode = '22023';
  end if;

  if p_test_recipient_user_id is not null and not exists (
    select 1 from public.users u
    join public.vehicle_dispatch_drivers d on d.user_id = u.user_id and d.active
    where u.user_id = p_test_recipient_user_id
      and u.username = '022443'
      and u.status = 'active'
  ) then
    raise exception 'test_recipient_not_eligible' using errcode = '22023';
  end if;
  if p_test_enabled and p_test_recipient_user_id is null then
    raise exception 'test_recipient_not_configured' using errcode = '22023';
  end if;

  insert into public.vehicle_line_notification_settings(
    singleton_id, personal_enabled, assignment_enabled, assignment_revoked_enabled,
    test_enabled, test_recipient_user_id, updated_by, updated_at
  ) values (
    true, p_personal_enabled, p_assignment_enabled, p_assignment_revoked_enabled,
    p_test_enabled, p_test_recipient_user_id, p_updated_by, now()
  )
  on conflict (singleton_id) do update set
    personal_enabled = excluded.personal_enabled,
    assignment_enabled = excluded.assignment_enabled,
    assignment_revoked_enabled = excluded.assignment_revoked_enabled,
    test_enabled = excluded.test_enabled,
    test_recipient_user_id = excluded.test_recipient_user_id,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  -- A disabled setting cancels every item that has not entered an external request.
  -- A request already in flight becomes uncertain and is never blindly retried.
  update public.vehicle_dispatch_notification_outbox o
  set state = case when o.state = 'sending' then 'uncertain' else 'cancelled' end,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = case when o.state = 'sending'
        then 'preferences_changed_in_flight' else 'preferences_disabled' end,
      updated_at = now()
  where o.state in ('pending', 'retry_wait', 'leased', 'sending')
    and not (
      p_personal_enabled and case o.event_type
        when 'assignment' then p_assignment_enabled
        when 'assignment_revoked' then p_assignment_revoked_enabled
        else false
      end
    );

  update public.vehicle_line_notification_test_runs t
  set state = case when t.state = 'sending' then 'uncertain' else 'cancelled' end,
      lease_token = null,
      lease_expires_at = null
  where t.state in ('pending', 'leased', 'sending')
    and (not p_test_enabled or t.recipient_user_id is distinct from p_test_recipient_user_id);
end;
$$;
revoke all on function public.save_vehicle_line_notification_settings(boolean, boolean, boolean, boolean, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.save_vehicle_line_notification_settings(boolean, boolean, boolean, boolean, uuid, uuid)
  to service_role;

create or replace function public.create_vehicle_line_notification_test(
  p_created_by uuid,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_recipient uuid;
  v_test_enabled boolean;
  v_run_id uuid;
begin
  select s.test_enabled, s.test_recipient_user_id
  into v_test_enabled, v_recipient
  from public.vehicle_line_notification_settings s
  where s.singleton_id = true
  for share;
  if not found or not v_test_enabled or v_recipient is null then
    raise exception 'test_mode_disabled' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.users u
    join public.vehicle_dispatch_drivers d on d.user_id = u.user_id and d.active
    join public.vehicle_driver_line_bindings b on b.user_id = u.user_id and b.state = 'linked'
    where u.user_id = v_recipient and u.username = '022443' and u.status = 'active'
      and b.line_user_id ~ '^U[0-9A-Fa-f]{32}$'
  ) then
    raise exception 'test_recipient_not_ready' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.user_id = p_created_by and u.status = 'active') then
    raise exception 'test_actor_not_active' using errcode = '22023';
  end if;

  insert into public.vehicle_line_notification_test_runs(recipient_user_id, created_by, created_at, expires_at)
  values (v_recipient, p_created_by, v_now, v_now + interval '5 minutes')
  returning test_run_id into v_run_id;
  return v_run_id;
end;
$$;
revoke all on function public.create_vehicle_line_notification_test(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_vehicle_line_notification_test(uuid, timestamptz) to service_role;

create or replace function public.claim_vehicle_line_notification_test(
  p_test_run_id uuid,
  p_now timestamptz default now(),
  p_lease_seconds integer default 90
)
returns table(test_run_id uuid, lease_token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v public.vehicle_line_notification_test_runs%rowtype;
  v_enabled boolean;
  v_recipient uuid;
begin
  select s.test_enabled, s.test_recipient_user_id into v_enabled, v_recipient
  from public.vehicle_line_notification_settings s where s.singleton_id = true for share;
  select * into v from public.vehicle_line_notification_test_runs t
  where t.test_run_id = p_test_run_id for update;
  if not found then return; end if;
  if v.state <> 'pending' or v.expires_at <= v_now then
    if v.state = 'pending' then
      update public.vehicle_line_notification_test_runs t set state = 'cancelled' where t.test_run_id = v.test_run_id;
    end if;
    return;
  end if;
  if not coalesce(v_enabled, false) or v_recipient is distinct from v.recipient_user_id
      or not exists (
        select 1 from public.users u
        join public.vehicle_dispatch_drivers d on d.user_id = u.user_id and d.active
        join public.vehicle_driver_line_bindings b on b.user_id = u.user_id and b.state = 'linked'
        where u.user_id = v.recipient_user_id and u.username = '022443' and u.status = 'active'
          and b.line_user_id ~ '^U[0-9A-Fa-f]{32}$'
      ) then
    update public.vehicle_line_notification_test_runs t set state = 'suppressed' where t.test_run_id = v.test_run_id;
    return;
  end if;
  return query update public.vehicle_line_notification_test_runs t
    set state = 'leased', lease_token = gen_random_uuid(),
        lease_expires_at = v_now + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 300)))
    where t.test_run_id = v.test_run_id and t.state = 'pending'
    returning t.test_run_id, t.lease_token;
end;
$$;
revoke all on function public.claim_vehicle_line_notification_test(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_vehicle_line_notification_test(uuid, timestamptz, integer) to service_role;

create or replace function public.prepare_vehicle_line_notification_test(
  p_test_run_id uuid,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns table(outcome text, line_user_id text, retry_key uuid, message_text text, attempts integer, first_attempt_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v public.vehicle_line_notification_test_runs%rowtype;
  v_enabled boolean;
  v_recipient uuid;
  v_line_user_id text;
begin
  select s.test_enabled, s.test_recipient_user_id into v_enabled, v_recipient
  from public.vehicle_line_notification_settings s where s.singleton_id = true for share;
  select t.* into v from public.vehicle_line_notification_test_runs t
  where t.test_run_id = p_test_run_id and t.state = 'leased'
    and t.lease_token = p_lease_token and t.lease_expires_at > v_now
  for update;
  if not found then
    return query select 'lease_lost'::text, null::text, null::uuid, null::text, null::integer, null::timestamptz;
    return;
  end if;
  if v.expires_at <= v_now or v.attempts >= 1
      or not coalesce(v_enabled, false) or v_recipient is distinct from v.recipient_user_id then
    update public.vehicle_line_notification_test_runs set state = 'cancelled', lease_token = null, lease_expires_at = null
    where test_run_id = v.test_run_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts::integer, v.first_attempt_at;
    return;
  end if;
  select b.line_user_id into v_line_user_id
  from public.users u
  join public.vehicle_dispatch_drivers d on d.user_id = u.user_id and d.active
  join public.vehicle_driver_line_bindings b on b.user_id = u.user_id and b.state = 'linked'
  where u.user_id = v.recipient_user_id and u.username = '022443' and u.status = 'active'
    and b.line_user_id ~ '^U[0-9A-Fa-f]{32}$';
  if v_line_user_id is null then
    update public.vehicle_line_notification_test_runs set state = 'suppressed', lease_token = null, lease_expires_at = null
    where test_run_id = v.test_run_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts::integer, v.first_attempt_at;
    return;
  end if;
  update public.vehicle_line_notification_test_runs t
  set state = 'sending', attempts = 1, first_attempt_at = v_now, lease_expires_at = v_now + interval '2 minutes'
  where t.test_run_id = v.test_run_id and t.state = 'leased' and t.lease_token = p_lease_token;
  return query select 'ready'::text, v_line_user_id, v.retry_key,
    '公務車個人 LINE 通知測試：此為管理員發起的合成測試，沒有建立或變更任何派車案件。'::text,
    1, v_now;
end;
$$;
revoke all on function public.prepare_vehicle_line_notification_test(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.prepare_vehicle_line_notification_test(uuid, uuid, timestamptz) to service_role;

create or replace function public.finish_vehicle_line_notification_test(
  p_test_run_id uuid,
  p_lease_token uuid,
  p_resolution text,
  p_http_status smallint default null,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_state text;
begin
  select t.state into v_state from public.vehicle_line_notification_test_runs t
  where t.test_run_id = p_test_run_id and t.state = 'sending' and t.lease_token = p_lease_token
  for update;
  if not found then return 'lease_lost'; end if;
  if p_resolution = 'accepted' and p_http_status between 200 and 299 then
    update public.vehicle_line_notification_test_runs set state = 'accepted', accepted_at = v_now,
      provider_http_status = p_http_status, lease_token = null, lease_expires_at = null
    where test_run_id = p_test_run_id;
    return 'accepted';
  elsif p_resolution = 'uncertain' and (p_http_status is null or p_http_status = 409 or p_http_status between 500 and 599) then
    update public.vehicle_line_notification_test_runs set state = 'uncertain', provider_http_status = p_http_status,
      lease_token = null, lease_expires_at = null where test_run_id = p_test_run_id;
    return 'uncertain';
  elsif p_resolution = 'dead_letter' and p_http_status between 300 and 499 then
    update public.vehicle_line_notification_test_runs set state = 'dead_letter', provider_http_status = p_http_status,
      lease_token = null, lease_expires_at = null where test_run_id = p_test_run_id;
    return 'dead_letter';
  end if;
  return 'invalid_resolution';
end;
$$;
revoke all on function public.finish_vehicle_line_notification_test(uuid, uuid, text, smallint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finish_vehicle_line_notification_test(uuid, uuid, text, smallint, timestamptz)
  to service_role;

-- Re-check the server-owned preference at both queue claim and the final prepare step.
create or replace function public.claim_vehicle_dispatch_line_notifications(
  p_limit integer default 20,
  p_lease_seconds integer default 90,
  p_now timestamptz default now()
)
returns table(outbox_id uuid, lease_token uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
begin
  update public.vehicle_dispatch_notification_outbox o
  set state = 'uncertain', lease_token = null, lease_expires_at = null,
      last_error_code = 'retry_window_expired', updated_at = v_now
  where o.state in ('retry_wait', 'leased', 'sending')
    and o.first_attempt_at <= v_now - interval '23 hours'
    and (o.state not in ('leased', 'sending') or o.lease_expires_at <= v_now);

  return query
  with candidates as (
    select o.outbox_id
    from public.vehicle_dispatch_notification_outbox o
    where public.vehicle_line_personal_event_enabled(o.event_type)
      and ((o.state in ('pending', 'retry_wait') and o.next_attempt_at <= v_now)
        or (o.state in ('leased', 'sending') and o.lease_expires_at <= v_now))
      and (o.first_attempt_at is null or o.first_attempt_at > v_now - interval '23 hours')
    order by o.next_attempt_at, o.created_at, o.outbox_id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.vehicle_dispatch_notification_outbox o
    set state = 'leased', lease_token = gen_random_uuid(),
        lease_expires_at = v_now + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 300))),
        updated_at = v_now
    from candidates c where o.outbox_id = c.outbox_id
    returning o.outbox_id, o.lease_token
  )
  select c.outbox_id, c.lease_token from claimed c;
end;
$$;
revoke all on function public.claim_vehicle_dispatch_line_notifications(integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_vehicle_dispatch_line_notifications(integer, integer, timestamptz)
  to service_role;

create or replace function public.prepare_vehicle_dispatch_line_notification(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns table(outcome text, line_user_id text, retry_key uuid, message_text text, attempts integer, first_attempt_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v record;
  v_message text;
begin
  select o.*, r.status as current_status, r.driver_id as current_driver_id,
         r.assignment_revision as current_revision,
         u.status as user_status, d.active as driver_active,
         b.state as binding_state, b.line_user_id as bound_line_user_id
  into v
  from public.vehicle_dispatch_notification_outbox o
  join public.vehicle_dispatch_requests r on r.request_id = o.request_id
  left join public.users u on u.user_id = o.recipient_user_id
  left join public.vehicle_dispatch_drivers d on d.user_id = o.recipient_user_id
  left join public.vehicle_driver_line_bindings b on b.user_id = o.recipient_user_id
  where o.outbox_id = p_outbox_id and o.state = 'leased'
    and o.lease_token = p_lease_token and o.lease_expires_at > v_now
  for update of o;
  if not found then
    return query select 'lease_lost'::text, null::text, null::uuid, null::text, null::integer, null::timestamptz;
    return;
  end if;

  if not public.vehicle_line_personal_event_enabled(v.event_type) then
    update public.vehicle_dispatch_notification_outbox set state = 'cancelled', lease_token = null,
      lease_expires_at = null, last_error_code = 'preferences_disabled', updated_at = v_now
    where outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;
  if v.first_attempt_at is not null and v.first_attempt_at <= v_now - interval '23 hours' then
    update public.vehicle_dispatch_notification_outbox set state = 'uncertain', lease_token = null,
      lease_expires_at = null, last_error_code = 'retry_window_expired', updated_at = v_now
    where outbox_id = p_outbox_id;
    return query select 'retry_window_expired'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;
  if v.user_status is distinct from 'active' or v.driver_active is distinct from true
      or v.binding_state is distinct from 'linked' or v.bound_line_user_id is null
      or v.bound_line_user_id !~ '^U[0-9A-Fa-f]{32}$' then
    update public.vehicle_dispatch_notification_outbox set state = 'skipped_unavailable', lease_token = null,
      lease_expires_at = null, last_error_code = 'recipient_unavailable', updated_at = v_now
    where outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;
  if v.event_type = 'assignment' and not (v.current_status = 'assigned'
      and v.current_driver_id = v.recipient_user_id and v.current_revision = v.dispatch_revision) then
    update public.vehicle_dispatch_notification_outbox set state = 'cancelled', lease_token = null,
      lease_expires_at = null, last_error_code = 'assignment_changed', updated_at = v_now
    where outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;
  if v.event_type = 'assignment_revoked' and v.current_status = 'assigned'
      and v.current_driver_id = v.recipient_user_id and v.current_revision = v.dispatch_revision then
    update public.vehicle_dispatch_notification_outbox set state = 'cancelled', lease_token = null,
      lease_expires_at = null, last_error_code = 'revocation_no_longer_current', updated_at = v_now
    where outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;

  v_message := coalesce(v.message_text,
    '公務車派車資訊已更新，請登入系統查看：https://jnfakimo.github.io/Inspection/v2/systems/vehicle/requests/');
  update public.vehicle_dispatch_notification_outbox o
  set state = 'sending', attempts = o.attempts + 1,
      first_attempt_at = coalesce(o.first_attempt_at, v_now), message_text = v_message,
      lease_expires_at = v_now + interval '2 minutes', updated_at = v_now
  where o.outbox_id = p_outbox_id
  returning o.attempts, o.first_attempt_at into v.attempts, v.first_attempt_at;
  return query select 'ready'::text, v.bound_line_user_id, v.retry_key,
    v_message, v.attempts, v.first_attempt_at;
end;
$$;
revoke all on function public.prepare_vehicle_dispatch_line_notification(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.prepare_vehicle_dispatch_line_notification(uuid, uuid, timestamptz)
  to service_role;

commit;
