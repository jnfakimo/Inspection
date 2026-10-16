-- Transactional, privacy-minimized LINE notification outbox for vehicle dispatch.
-- This migration only defines local schema/functions; it does not send messages.
begin;

alter table public.vehicle_dispatch_requests
  add column if not exists assignment_revision integer not null default 0;

create table if not exists public.vehicle_dispatch_notification_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.vehicle_dispatch_requests(request_id) on delete restrict,
  event_type text not null check (event_type in ('assignment', 'assignment_revoked')),
  dispatch_revision integer not null check (dispatch_revision > 0),
  recipient_user_id uuid not null references public.users(user_id) on delete restrict,
  retry_key uuid not null default gen_random_uuid() unique,
  state text not null default 'pending' check (state in (
    'pending', 'leased', 'sending', 'retry_wait', 'accepted', 'uncertain',
    'skipped_unavailable', 'cancelled', 'dead_letter'
  )),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_http_status smallint check (provider_http_status between 100 and 599),
  accepted_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_dispatch_notification_outbox_event_key
    unique (request_id, event_type, dispatch_revision, recipient_user_id),
  constraint vehicle_dispatch_notification_outbox_lease_check check (
    (state in ('leased', 'sending') and lease_token is not null and lease_expires_at is not null)
    or (state not in ('leased', 'sending') and lease_token is null and lease_expires_at is null)
  ),
  constraint vehicle_dispatch_notification_outbox_accepted_check check (
    (state = 'accepted' and accepted_at is not null)
    or (state <> 'accepted' and accepted_at is null)
  )
);

create index if not exists idx_vehicle_dispatch_notification_outbox_due
  on public.vehicle_dispatch_notification_outbox(next_attempt_at, created_at)
  where state in ('pending', 'retry_wait');
create index if not exists idx_vehicle_dispatch_notification_outbox_request
  on public.vehicle_dispatch_notification_outbox(request_id, dispatch_revision, event_type);
create index if not exists idx_vehicle_dispatch_notification_outbox_recipient
  on public.vehicle_dispatch_notification_outbox(recipient_user_id, created_at desc);

alter table public.vehicle_dispatch_notification_outbox enable row level security;
revoke all on public.vehicle_dispatch_notification_outbox from public, anon, authenticated;
grant all on public.vehicle_dispatch_notification_outbox to service_role;

comment on table public.vehicle_dispatch_notification_outbox is
  'Private transactional delivery queue. Stores no LINE ID, message text, passenger data, route, trip purpose, or dispatch notes.';
comment on column public.vehicle_dispatch_notification_outbox.retry_key is
  'Stable LINE X-Line-Retry-Key for every retry of this one outbox event.';
comment on column public.vehicle_dispatch_notification_outbox.state is
  'accepted means LINE accepted the API request, not that the recipient read the message.';

create or replace function public.bump_vehicle_dispatch_assignment_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.status = 'assigned' and (
        old.status is distinct from 'assigned'
        or old.driver_id is distinct from new.driver_id
        or old.vehicle_id is distinct from new.vehicle_id
      ))
      or (old.status = 'assigned' and new.status is distinct from 'assigned') then
    new.assignment_revision := old.assignment_revision + 1;
  else
    new.assignment_revision := old.assignment_revision;
  end if;
  return new;
end;
$$;

revoke all on function public.bump_vehicle_dispatch_assignment_revision() from public, anon, authenticated;

drop trigger if exists trg_vehicle_dispatch_assignment_revision on public.vehicle_dispatch_requests;
create trigger trg_vehicle_dispatch_assignment_revision
  before update on public.vehicle_dispatch_requests
  for each row execute function public.bump_vehicle_dispatch_assignment_revision();

create or replace function public.enqueue_vehicle_dispatch_line_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment_changed boolean;
  v_should_revoke boolean;
begin
  v_assignment_changed := new.status = 'assigned' and (
    old.status is distinct from 'assigned'
    or old.driver_id is distinct from new.driver_id
    or old.vehicle_id is distinct from new.vehicle_id
  );
  v_should_revoke := old.status = 'assigned'
    and (new.status is distinct from 'assigned'
      or old.driver_id is distinct from new.driver_id
      or old.vehicle_id is distinct from new.vehicle_id)
    and new.status is distinct from 'completed';

  if old.status = 'assigned' and (
      new.status is distinct from 'assigned'
      or old.driver_id is distinct from new.driver_id
      or old.vehicle_id is distinct from new.vehicle_id
    ) then
    -- A queued/leased notice has not started its provider request and is safe to suppress.
    update public.vehicle_dispatch_notification_outbox
    set state = 'cancelled', lease_token = null, lease_expires_at = null,
        last_error_code = 'assignment_changed', updated_at = now()
    where request_id = old.request_id
      and event_type = 'assignment'
      and dispatch_revision = old.assignment_revision
      and recipient_user_id = old.driver_id
      and state in ('pending', 'retry_wait', 'leased');

    -- A provider call may already be in flight. Mark it uncertain; never blindly resend it.
    update public.vehicle_dispatch_notification_outbox
    set state = 'uncertain', lease_token = null, lease_expires_at = null,
        last_error_code = 'assignment_changed_in_flight', updated_at = now()
    where request_id = old.request_id
      and event_type = 'assignment'
      and dispatch_revision = old.assignment_revision
      and recipient_user_id = old.driver_id
      and state = 'sending';

    if v_should_revoke and old.driver_id is not null and exists (
      select 1 from public.vehicle_dispatch_notification_outbox o
      where o.request_id = old.request_id
        and o.event_type = 'assignment'
        and o.dispatch_revision = old.assignment_revision
        and o.recipient_user_id = old.driver_id
        and o.state in ('accepted', 'sending', 'uncertain')
    ) then
      insert into public.vehicle_dispatch_notification_outbox
        (request_id, event_type, dispatch_revision, recipient_user_id, state, last_error_code)
      values (
        old.request_id, 'assignment_revoked', old.assignment_revision, old.driver_id,
        case when exists (
          select 1 from public.vehicle_driver_line_bindings b
          join public.vehicle_dispatch_drivers d on d.user_id = b.user_id and d.active
          join public.users u on u.user_id = d.user_id and u.status = 'active'
          where b.user_id = old.driver_id and b.state = 'linked'
        ) then 'pending' else 'skipped_unavailable' end,
        case when exists (
          select 1 from public.vehicle_driver_line_bindings b
          join public.vehicle_dispatch_drivers d on d.user_id = b.user_id and d.active
          join public.users u on u.user_id = d.user_id and u.status = 'active'
          where b.user_id = old.driver_id and b.state = 'linked'
        ) then null else 'recipient_unavailable' end
      )
      on conflict (request_id, event_type, dispatch_revision, recipient_user_id) do nothing;
    end if;
  end if;

  if v_assignment_changed and new.driver_id is not null then
    insert into public.vehicle_dispatch_notification_outbox
      (request_id, event_type, dispatch_revision, recipient_user_id, state, last_error_code)
    values (
      new.request_id, 'assignment', new.assignment_revision, new.driver_id,
      case when exists (
        select 1 from public.vehicle_driver_line_bindings b
        join public.vehicle_dispatch_drivers d on d.user_id = b.user_id and d.active
        join public.users u on u.user_id = d.user_id and u.status = 'active'
        where b.user_id = new.driver_id and b.state = 'linked'
      ) then 'pending' else 'skipped_unavailable' end,
      case when exists (
        select 1 from public.vehicle_driver_line_bindings b
        join public.vehicle_dispatch_drivers d on d.user_id = b.user_id and d.active
        join public.users u on u.user_id = d.user_id and u.status = 'active'
        where b.user_id = new.driver_id and b.state = 'linked'
      ) then null else 'recipient_unavailable' end
    )
    on conflict (request_id, event_type, dispatch_revision, recipient_user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.enqueue_vehicle_dispatch_line_notifications() from public, anon, authenticated;

drop trigger if exists trg_enqueue_vehicle_dispatch_line_notifications on public.vehicle_dispatch_requests;
create trigger trg_enqueue_vehicle_dispatch_line_notifications
  after update of status, driver_id, vehicle_id on public.vehicle_dispatch_requests
  for each row execute function public.enqueue_vehicle_dispatch_line_notifications();

-- Unlinking suppresses every event that has not started a provider call.
create or replace function public.unlink_vehicle_line_account(
  p_user_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unlinked boolean := false;
begin
  update public.vehicle_driver_line_bindings
  set line_user_id = null, state = 'unlinked', unlinked_at = p_now
  where user_id = p_user_id and state = 'linked';
  v_unlinked := found;

  update public.vehicle_line_link_intents
  set state = 'cancelled'
  where user_id = p_user_id and state = 'pending';

  update public.vehicle_line_account_link_nonces
  set state = 'cancelled', consumed_at = p_now
  where user_id = p_user_id and state = 'pending';

  update public.vehicle_dispatch_notification_outbox
  set state = 'cancelled', lease_token = null, lease_expires_at = null,
      last_error_code = 'recipient_unlinked', updated_at = p_now
  where recipient_user_id = p_user_id and state in ('pending', 'retry_wait', 'leased');

  update public.vehicle_dispatch_notification_outbox
  set state = 'uncertain', lease_token = null, lease_expires_at = null,
      last_error_code = 'recipient_unlinked_in_flight', updated_at = p_now
  where recipient_user_id = p_user_id and state = 'sending';

  return v_unlinked;
end;
$$;

revoke all on function public.unlink_vehicle_line_account(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.unlink_vehicle_line_account(uuid, timestamptz) to service_role;

commit;
