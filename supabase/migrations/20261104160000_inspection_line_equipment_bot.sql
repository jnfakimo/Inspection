-- Private, single-use LINE account links for equipment enquiries.
begin;

create table public.inspection_line_bindings (
  user_id uuid primary key references public.users(user_id) on delete restrict,
  line_user_id text,
  state text not null check (state in ('linked', 'unlinked')),
  consented_at timestamptz,
  linked_at timestamptz,
  unlinked_at timestamptz,
  constraint inspection_line_binding_state_check check (
    (state = 'linked' and line_user_id ~ '^U[0-9a-fA-F]{32}$'
      and consented_at is not null and linked_at is not null and unlinked_at is null)
    or (state = 'unlinked' and line_user_id is null and unlinked_at is not null)
  )
);
create unique index inspection_line_bindings_active_line
  on public.inspection_line_bindings(line_user_id) where state = 'linked';

create table public.inspection_line_link_requests (
  request_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id) on delete restrict,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text unique check (nonce_hash is null or nonce_hash ~ '^[0-9a-f]{64}$'),
  line_user_id_hash text check (line_user_id_hash is null or line_user_id_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('pending', 'awaiting_line', 'linked', 'failed', 'cancelled', 'expired')),
  consented_at timestamptz not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint inspection_line_link_expiry_check check (expires_at > created_at)
);
create index inspection_line_link_requests_user on public.inspection_line_link_requests(user_id, created_at desc);

create table public.inspection_line_equipment_subscriptions (
  user_id uuid not null references public.users(user_id) on delete restrict,
  equipment_id uuid not null references public.equipment(equipment_id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, equipment_id)
);

create table public.inspection_line_alert_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.equipment_monitor_events(event_id) on delete restrict,
  equipment_id uuid not null references public.equipment(equipment_id) on delete restrict,
  user_id uuid not null references public.users(user_id) on delete restrict,
  message_text text not null,
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'sent', 'cancelled', 'dead_letter', 'uncertain')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  last_http_status integer,
  constraint inspection_line_alert_once unique (event_id, user_id)
);
create index inspection_line_alert_due on public.inspection_line_alert_outbox(state, next_attempt_at);

alter table public.inspection_line_bindings enable row level security;
alter table public.inspection_line_link_requests enable row level security;
alter table public.inspection_line_equipment_subscriptions enable row level security;
alter table public.inspection_line_alert_outbox enable row level security;
revoke all on public.inspection_line_bindings, public.inspection_line_link_requests,
  public.inspection_line_equipment_subscriptions, public.inspection_line_alert_outbox
  from public, anon, authenticated;
grant all on public.inspection_line_bindings, public.inspection_line_link_requests,
  public.inspection_line_equipment_subscriptions, public.inspection_line_alert_outbox to service_role;

create function public.enqueue_inspection_line_equipment_alert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_equipment text; v_code text; v_message text;
begin
  if new.severity not in ('warning', 'critical') or new.event_state <> 'open' then return new; end if;
  select left(regexp_replace(coalesce(e.name, '未命名設備'), '[[:cntrl:]]', ' ', 'g'), 100),
    left(regexp_replace(coalesce(e.asset_code, e.qr_code, e.equipment_id::text), '[[:cntrl:]]', ' ', 'g'), 80)
    into v_equipment, v_code from public.equipment e where e.equipment_id = new.equipment_id;
  v_message := '⚠️ 中央巡檢設備異常' || chr(10)
    || '設備：' || coalesce(v_equipment, '未命名設備') || '（' || coalesce(v_code, '未編號') || '）' || chr(10)
    || '等級：' || new.severity || chr(10)
    || '事件：' || left(regexp_replace(coalesce(new.title, '未命名事件'), '[[:cntrl:]]', ' ', 'g'), 150) || chr(10)
    || '發生時間：' || to_char(new.occurred_at at time zone 'Asia/Taipei', 'YYYY/MM/DD HH24:MI') || chr(10)
    || '請登入系統查看：https://jnfakimo.github.io/Inspection/v2/systems/equipment/monitoring/';
  insert into public.inspection_line_alert_outbox (event_id, equipment_id, user_id, message_text)
    select new.event_id, new.equipment_id, s.user_id, v_message
    from public.inspection_line_equipment_subscriptions s
    join public.inspection_line_bindings b on b.user_id = s.user_id
    join public.users u on u.user_id = s.user_id
    where s.equipment_id = new.equipment_id and s.active
      and b.state = 'linked' and u.status = 'active'
    on conflict (event_id, user_id) do nothing;
  return new;
end $$;
create trigger inspection_line_equipment_alert_enqueue
  after insert or update of severity, event_state on public.equipment_monitor_events
  for each row execute function public.enqueue_inspection_line_equipment_alert();
revoke all on function public.enqueue_inspection_line_equipment_alert() from public, anon, authenticated;

create function public.create_inspection_line_link(
  p_user_id uuid, p_code_hash text, p_consented_at timestamptz, p_now timestamptz default now()
) returns table (outcome text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_expiry timestamptz := p_now + interval '10 minutes';
begin
  if p_user_id is null or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_consented_at is null or p_now is null then
    return query select 'invalid_request'::text, null::timestamptz; return;
  end if;
  perform 1 from public.users where user_id = p_user_id and status = 'active' for update;
  if not found then
    return query select 'user_inactive'::text, null::timestamptz; return;
  end if;
  if exists (select 1 from public.inspection_line_bindings
      where user_id = p_user_id and state = 'linked') then
    return query select 'already_linked'::text, null::timestamptz; return;
  end if;
  update public.inspection_line_link_requests set state = 'cancelled', consumed_at = p_now
    where user_id = p_user_id and state in ('pending', 'awaiting_line');
  insert into public.inspection_line_link_requests
    (user_id, code_hash, state, consented_at, created_at, expires_at)
    values (p_user_id, p_code_hash, 'pending', p_consented_at, p_now, v_expiry);
  return query select 'created'::text, v_expiry;
end $$;

create function public.consume_inspection_line_link(
  p_code_hash text, p_line_user_id_hash text, p_nonce_hash text, p_now timestamptz default now()
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.inspection_line_link_requests;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$' or p_line_user_id_hash !~ '^[0-9a-f]{64}$'
    or p_nonce_hash !~ '^[0-9a-f]{64}$' or p_now is null then return 'invalid_request'; end if;
  select * into v_request from public.inspection_line_link_requests
    where code_hash = p_code_hash for update;
  if not found then return 'invalid_or_expired'; end if;
  if v_request.state <> 'pending' then return 'already_used'; end if;
  if v_request.expires_at <= p_now then
    update public.inspection_line_link_requests set state = 'expired', consumed_at = p_now
      where request_id = v_request.request_id;
    return 'expired';
  end if;
  if not exists (select 1 from public.users where user_id = v_request.user_id and status = 'active') then
    update public.inspection_line_link_requests set state = 'cancelled', consumed_at = p_now
      where request_id = v_request.request_id;
    return 'user_inactive';
  end if;
  if exists (select 1 from public.inspection_line_bindings
      where user_id = v_request.user_id and state = 'linked') then
    update public.inspection_line_link_requests set state = 'cancelled', consumed_at = p_now
      where request_id = v_request.request_id;
    return 'already_linked';
  end if;
  update public.inspection_line_link_requests
    set state = 'awaiting_line', nonce_hash = p_nonce_hash,
      line_user_id_hash = p_line_user_id_hash, expires_at = p_now + interval '10 minutes'
    where request_id = v_request.request_id;
  return 'ready';
end $$;

create function public.complete_inspection_line_link(
  p_nonce_hash text, p_line_user_id_hash text, p_line_user_id text,
  p_result text, p_now timestamptz default now()
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.inspection_line_link_requests;
begin
  if p_nonce_hash !~ '^[0-9a-f]{64}$' or p_line_user_id_hash !~ '^[0-9a-f]{64}$'
    or p_line_user_id !~ '^U[0-9a-fA-F]{32}$'
    or p_line_user_id_hash <> encode(sha256(convert_to(p_line_user_id, 'UTF8')), 'hex')
    or p_result not in ('ok', 'failed') or p_now is null then return 'invalid_request'; end if;
  select * into v_request from public.inspection_line_link_requests
    where nonce_hash = p_nonce_hash;
  if not found then return 'invalid_or_expired'; end if;
  -- Serialize completion with unlink and a new intent for the same account.
  perform 1 from public.users where user_id = v_request.user_id for update;
  select * into v_request from public.inspection_line_link_requests
    where nonce_hash = p_nonce_hash for update;
  if v_request.state <> 'awaiting_line' then return 'already_used'; end if;
  if v_request.expires_at <= p_now then
    update public.inspection_line_link_requests set state = 'expired', consumed_at = p_now
      where request_id = v_request.request_id;
    return 'expired';
  end if;
  if v_request.line_user_id_hash <> p_line_user_id_hash then return 'identity_mismatch'; end if;
  if p_result = 'failed' then
    update public.inspection_line_link_requests set state = 'failed', consumed_at = p_now
      where request_id = v_request.request_id;
    return 'line_verification_failed';
  end if;
  if not exists (select 1 from public.users where user_id = v_request.user_id and status = 'active') then
    update public.inspection_line_link_requests set state = 'cancelled', consumed_at = p_now
      where request_id = v_request.request_id;
    return 'user_inactive';
  end if;
  if exists (select 1 from public.inspection_line_bindings
      where user_id = v_request.user_id and state = 'linked') then
    return 'already_linked';
  end if;
  if exists (select 1 from public.inspection_line_bindings
      where line_user_id = p_line_user_id and state = 'linked') then
    return 'binding_conflict';
  end if;
  begin
    insert into public.inspection_line_bindings
      (user_id, line_user_id, state, consented_at, linked_at, unlinked_at)
      values (v_request.user_id, p_line_user_id, 'linked', v_request.consented_at, p_now, null)
      on conflict (user_id) do update
      set line_user_id = excluded.line_user_id, state = 'linked',
        consented_at = excluded.consented_at, linked_at = excluded.linked_at, unlinked_at = null;
  exception when unique_violation then return 'binding_conflict';
  end;
  update public.inspection_line_link_requests set state = 'linked', consumed_at = p_now
    where request_id = v_request.request_id;
  return 'linked';
end $$;

create function public.unlink_inspection_line(p_user_id uuid, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_changed boolean;
begin
  perform 1 from public.users where user_id = p_user_id for update;
  update public.inspection_line_bindings
    set line_user_id = null, state = 'unlinked', unlinked_at = p_now
    where user_id = p_user_id and state = 'linked';
  v_changed := found;
  update public.inspection_line_link_requests set state = 'cancelled', consumed_at = p_now
    where user_id = p_user_id and state in ('pending', 'awaiting_line');
  update public.inspection_line_equipment_subscriptions set active = false, updated_at = p_now
    where user_id = p_user_id and active;
  update public.inspection_line_alert_outbox
    set state = 'cancelled', lease_token = null, lease_until = null
    where user_id = p_user_id and state in ('pending', 'leased');
  return v_changed;
end $$;

create function public.subscribe_inspection_line_equipment(
  p_user_id uuid, p_equipment_id uuid, p_now timestamptz default now()
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user_id is null or p_equipment_id is null or p_now is null then return 'invalid_request'; end if;
  perform 1 from public.users where user_id = p_user_id and status = 'active' for update;
  if not found then return 'user_inactive'; end if;
  if not exists (select 1 from public.inspection_line_bindings
      where user_id = p_user_id and state = 'linked') then return 'unlinked'; end if;
  if not exists (select 1 from public.equipment where equipment_id = p_equipment_id) then
    return 'equipment_missing';
  end if;
  if not exists (select 1 from public.inspection_line_equipment_subscriptions
      where user_id = p_user_id and equipment_id = p_equipment_id and active)
    and (select count(*) from public.inspection_line_equipment_subscriptions
      where user_id = p_user_id and active) >= 100 then return 'limit_reached'; end if;
  insert into public.inspection_line_equipment_subscriptions
    (user_id, equipment_id, active, created_at, updated_at)
    values (p_user_id, p_equipment_id, true, p_now, p_now)
    on conflict (user_id, equipment_id) do update set active = true, updated_at = p_now;
  return 'subscribed';
end $$;

create function public.unsubscribe_inspection_line_equipment(
  p_user_id uuid, p_equipment_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_changed boolean;
begin
  if p_user_id is null or p_equipment_id is null then return false; end if;
  perform 1 from public.users where user_id = p_user_id for update;
  update public.inspection_line_equipment_subscriptions
    set active = false, updated_at = p_now
    where user_id = p_user_id and equipment_id = p_equipment_id and active;
  v_changed := found;
  update public.inspection_line_alert_outbox
    set state = 'cancelled', lease_token = null, lease_until = null
    where user_id = p_user_id and equipment_id = p_equipment_id and state in ('pending', 'leased');
  return v_changed;
end $$;

create function public.claim_inspection_line_alerts(
  p_limit integer default 20, p_lease_seconds integer default 90, p_now timestamptz default now()
) returns table(outbox_id uuid, lease_token uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 50 or p_lease_seconds not between 30 and 300 or p_now is null then
    raise exception 'invalid claim parameters' using errcode = '22023';
  end if;
  return query
    with candidates as (
      select o.outbox_id from public.inspection_line_alert_outbox o
      where (o.state = 'pending' or (o.state = 'leased' and o.lease_until <= p_now))
        and o.next_attempt_at <= p_now
      order by o.next_attempt_at, o.created_at, o.outbox_id
      for update skip locked limit p_limit
    ), claimed as (
      update public.inspection_line_alert_outbox o
      set state = 'leased', lease_token = gen_random_uuid(),
        lease_until = p_now + make_interval(secs => p_lease_seconds),
        attempts = o.attempts + 1,
        first_attempt_at = coalesce(o.first_attempt_at, p_now)
      from candidates c where o.outbox_id = c.outbox_id
      returning o.outbox_id, o.lease_token
    ) select c.outbox_id, c.lease_token from claimed c;
end $$;

create function public.finish_inspection_line_alert(
  p_outbox_id uuid, p_lease_token uuid, p_resolution text,
  p_http_status integer default null, p_next_attempt_at timestamptz default null,
  p_now timestamptz default now()
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_state text;
begin
  if p_resolution not in ('sent', 'retry', 'cancelled', 'dead_letter', 'uncertain') then return 'invalid_request'; end if;
  update public.inspection_line_alert_outbox
  set state = case when p_resolution = 'retry' then 'pending' else p_resolution end,
    lease_token = null, lease_until = null,
    next_attempt_at = case when p_resolution = 'retry'
      then coalesce(p_next_attempt_at, p_now + interval '1 minute') else next_attempt_at end,
    sent_at = case when p_resolution = 'sent' then p_now else sent_at end,
    last_http_status = p_http_status
  where outbox_id = p_outbox_id and state = 'leased' and lease_token = p_lease_token
  returning state into v_state;
  return coalesce(v_state, 'lease_lost');
end $$;

revoke all on function public.create_inspection_line_link(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_inspection_line_link(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_inspection_line_link(text, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.unlink_inspection_line(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.subscribe_inspection_line_equipment(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.unsubscribe_inspection_line_equipment(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_inspection_line_alerts(integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.finish_inspection_line_alert(uuid, uuid, text, integer, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_inspection_line_link(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function public.consume_inspection_line_link(text, text, text, timestamptz) to service_role;
grant execute on function public.complete_inspection_line_link(text, text, text, text, timestamptz) to service_role;
grant execute on function public.unlink_inspection_line(uuid, timestamptz) to service_role;
grant execute on function public.subscribe_inspection_line_equipment(uuid, uuid, timestamptz) to service_role;
grant execute on function public.unsubscribe_inspection_line_equipment(uuid, uuid, timestamptz) to service_role;
grant execute on function public.claim_inspection_line_alerts(integer, integer, timestamptz) to service_role;
grant execute on function public.finish_inspection_line_alert(uuid, uuid, text, integer, timestamptz, timestamptz) to service_role;
commit;
