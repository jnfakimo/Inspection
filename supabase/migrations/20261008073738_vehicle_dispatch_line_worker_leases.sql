-- Server-only lease and delivery RPCs for the vehicle LINE notification outbox.
-- The worker is the only caller; the request body never supplies a recipient or message.
begin;

alter table public.vehicle_dispatch_notification_outbox
  add column if not exists first_attempt_at timestamptz,
  add column if not exists provider_accepted_request_id text,
  add column if not exists message_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_dispatch_notification_outbox'::regclass
      and conname = 'vehicle_dispatch_notification_outbox_accepted_request_id_check'
  ) then
    alter table public.vehicle_dispatch_notification_outbox
      add constraint vehicle_dispatch_notification_outbox_accepted_request_id_check
      check (provider_accepted_request_id is null or (
        length(provider_accepted_request_id) between 1 and 200
        and provider_accepted_request_id !~ '[[:cntrl:]]'
      ));
  end if;
end;
$$;

comment on column public.vehicle_dispatch_notification_outbox.first_attempt_at is
  'Start of the stable LINE retry-key window; retries stop before LINE’s 24-hour key expiry.';
comment on column public.vehicle_dispatch_notification_outbox.provider_accepted_request_id is
  'LINE x-line-accepted-request-id, when a retry confirms an earlier API acceptance.';
comment on column public.vehicle_dispatch_notification_outbox.message_text is
  'Immutable generic notification body shared by retries; contains no dispatch or personal details.';
comment on table public.vehicle_dispatch_notification_outbox is
  'Private transactional queue. Stores no LINE ID, personal data, route, trip purpose, or dispatch details; message_text is only a fixed generic notice shared by retries.';

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
  -- Once the provider retry-key window is nearly over, preserve an unknown result
  -- as uncertain instead of allowing a late duplicate request.
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
    where (
      (o.state in ('pending', 'retry_wait') and o.next_attempt_at <= v_now)
      or (o.state in ('leased', 'sending') and o.lease_expires_at <= v_now)
    )
      and (o.first_attempt_at is null or o.first_attempt_at > v_now - interval '23 hours')
    order by o.next_attempt_at, o.created_at, o.outbox_id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ), claimed as (
    update public.vehicle_dispatch_notification_outbox o
    set state = 'leased',
        lease_token = gen_random_uuid(),
        lease_expires_at = v_now + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 300))),
        updated_at = v_now
    from candidates c
    where o.outbox_id = c.outbox_id
    returning o.outbox_id, o.lease_token
  )
  select c.outbox_id, c.lease_token from claimed c;
end;
$$;

revoke all on function public.claim_vehicle_dispatch_line_notifications(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_vehicle_dispatch_line_notifications(integer, integer, timestamptz) to service_role;

create or replace function public.prepare_vehicle_dispatch_line_notification(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns table(
  outcome text,
  line_user_id text,
  retry_key uuid,
  message_text text,
  attempts integer,
  first_attempt_at timestamptz
)
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
  where o.outbox_id = p_outbox_id
    and o.state = 'leased'
    and o.lease_token = p_lease_token
    and o.lease_expires_at > v_now
  for update of o;

  if not found then
    return query select 'lease_lost'::text, null::text, null::uuid, null::text, null::integer, null::timestamptz;
    return;
  end if;

  if v.first_attempt_at is not null and v.first_attempt_at <= v_now - interval '23 hours' then
    update public.vehicle_dispatch_notification_outbox o
    set state = 'uncertain', lease_token = null, lease_expires_at = null,
        last_error_code = 'retry_window_expired', updated_at = v_now
    where o.outbox_id = p_outbox_id;
    return query select 'retry_window_expired'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;

  if v.user_status is distinct from 'active'
      or v.driver_active is distinct from true
      or v.binding_state is distinct from 'linked'
      or v.bound_line_user_id is null
      or v.bound_line_user_id !~ '^U[0-9A-Fa-f]{32}$' then
    update public.vehicle_dispatch_notification_outbox o
    set state = 'skipped_unavailable', lease_token = null, lease_expires_at = null,
        last_error_code = 'recipient_unavailable', updated_at = v_now
    where o.outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;

  if v.event_type = 'assignment' and not (
      v.current_status = 'assigned'
      and v.current_driver_id = v.recipient_user_id
      and v.current_revision = v.dispatch_revision
  ) then
    update public.vehicle_dispatch_notification_outbox o
    set state = 'cancelled', lease_token = null, lease_expires_at = null,
        last_error_code = 'assignment_changed', updated_at = v_now
    where o.outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;

  if v.event_type = 'assignment_revoked' and (
      v.current_status = 'assigned'
      and v.current_driver_id = v.recipient_user_id
      and v.current_revision = v.dispatch_revision
  ) then
    update public.vehicle_dispatch_notification_outbox o
    set state = 'cancelled', lease_token = null, lease_expires_at = null,
        last_error_code = 'revocation_no_longer_current', updated_at = v_now
    where o.outbox_id = p_outbox_id;
    return query select 'suppressed'::text, null::text, null::uuid, null::text, v.attempts, v.first_attempt_at;
    return;
  end if;

  v_message := coalesce(v.message_text,
    '公務車派車資訊已更新，請登入系統查看：' ||
    'https://jnfakimo.github.io/Inspection/v2/systems/vehicle/requests/');

  update public.vehicle_dispatch_notification_outbox o
  set state = 'sending',
      attempts = o.attempts + 1,
      first_attempt_at = coalesce(o.first_attempt_at, v_now),
      message_text = v_message,
      lease_expires_at = v_now + interval '2 minutes',
      updated_at = v_now
  where o.outbox_id = p_outbox_id
  returning o.attempts, o.first_attempt_at into v.attempts, v.first_attempt_at;

  return query select 'ready'::text, v.bound_line_user_id, v.retry_key,
    v_message, v.attempts, v.first_attempt_at;
end;
$$;

revoke all on function public.prepare_vehicle_dispatch_line_notification(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.prepare_vehicle_dispatch_line_notification(uuid, uuid, timestamptz) to service_role;

create or replace function public.finish_vehicle_dispatch_line_notification(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_resolution text,
  p_http_status smallint default null,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null,
  p_accepted_request_id text default null,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v public.vehicle_dispatch_notification_outbox%rowtype;
  v_final_resolution text := p_resolution;
  v_final_error text := p_error_code;
begin
  select * into v
  from public.vehicle_dispatch_notification_outbox o
  where o.outbox_id = p_outbox_id and o.state = 'sending' and o.lease_token = p_lease_token
  for update;
  if not found then return 'lease_lost'; end if;

  if p_resolution = 'accepted' then
    if not coalesce((p_http_status between 200 and 299)
        or (p_http_status = 409 and p_accepted_request_id is not null), false) then
      return 'invalid_resolution';
    end if;
  elsif p_resolution = 'retry_wait' then
    if not (p_http_status is null or p_http_status between 500 and 599)
        or p_next_attempt_at is null or p_next_attempt_at <= v_now then
      return 'invalid_resolution';
    end if;
    if v.attempts >= 8 or v.first_attempt_at <= v_now - interval '23 hours'
        or p_next_attempt_at >= v.first_attempt_at + interval '23 hours' then
      v_final_resolution := 'uncertain';
      v_final_error := case when v.attempts >= 8 then 'max_attempts' else 'retry_window_expired' end;
    end if;
  elsif p_resolution = 'uncertain' then
    if not (p_http_status is null or p_http_status between 500 and 599 or p_http_status = 409) then
      return 'invalid_resolution';
    end if;
  elsif p_resolution = 'dead_letter' then
    if not coalesce(p_http_status between 300 and 499 or p_error_code = 'invalid_payload', false) then
      return 'invalid_resolution';
    end if;
  else
    return 'invalid_resolution';
  end if;

  if v_final_resolution = 'accepted' then
    update public.vehicle_dispatch_notification_outbox o
    set state = 'accepted', accepted_at = v_now, provider_http_status = p_http_status,
        provider_accepted_request_id = p_accepted_request_id,
        last_error_code = null, lease_token = null, lease_expires_at = null, updated_at = v_now
    where o.outbox_id = p_outbox_id and o.state = 'sending' and o.lease_token = p_lease_token;
  elsif v_final_resolution = 'retry_wait' then
    update public.vehicle_dispatch_notification_outbox o
    set state = 'retry_wait', next_attempt_at = p_next_attempt_at, provider_http_status = p_http_status,
        last_error_code = v_final_error, lease_token = null, lease_expires_at = null, updated_at = v_now
    where o.outbox_id = p_outbox_id and o.state = 'sending' and o.lease_token = p_lease_token;
  else
    update public.vehicle_dispatch_notification_outbox o
    set state = v_final_resolution, provider_http_status = p_http_status,
        last_error_code = v_final_error, lease_token = null, lease_expires_at = null, updated_at = v_now
    where o.outbox_id = p_outbox_id and o.state = 'sending' and o.lease_token = p_lease_token;
  end if;

  return case when found then v_final_resolution else 'lease_lost' end;
end;
$$;

revoke all on function public.finish_vehicle_dispatch_line_notification(uuid, uuid, text, smallint, text, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_vehicle_dispatch_line_notification(uuid, uuid, text, smallint, text, timestamptz, text, timestamptz) to service_role;

commit;
