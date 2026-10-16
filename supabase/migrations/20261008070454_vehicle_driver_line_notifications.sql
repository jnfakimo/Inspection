-- Local-only implementation: verified driver LINE binding and account-link state.
-- The raw LINE identity is stored only in the service-role-only binding table.
begin;

create table if not exists public.vehicle_driver_line_bindings (
  user_id uuid primary key references public.users(user_id) on delete restrict,
  line_user_id text,
  state text not null default 'unlinked'
    check (state in ('linked', 'unlinked')),
  consented_at timestamptz,
  linked_at timestamptz,
  unlinked_at timestamptz,
  constraint vehicle_driver_line_binding_state_check check (
    (state = 'linked' and line_user_id is not null and consented_at is not null and linked_at is not null and unlinked_at is null)
    or (state = 'unlinked' and line_user_id is null and unlinked_at is not null)
  )
);

create unique index if not exists idx_vehicle_driver_line_bindings_active_line_id
  on public.vehicle_driver_line_bindings(line_user_id)
  where state = 'linked';

create table if not exists public.vehicle_line_link_intents (
  intent_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(user_id) on delete restrict,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending'
    check (state in ('pending', 'consumed', 'expired', 'cancelled')),
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  line_user_id_hash text check (line_user_id_hash is null or line_user_id_hash ~ '^[0-9a-f]{64}$'),
  constraint vehicle_line_link_intent_expiry_check check (expires_at > created_at)
);

create unique index if not exists idx_vehicle_line_link_intents_one_pending_per_user
  on public.vehicle_line_link_intents(user_id)
  where state = 'pending';

create table if not exists public.vehicle_line_account_link_nonces (
  nonce_id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.vehicle_line_link_intents(intent_id) on delete restrict,
  user_id uuid not null references public.users(user_id) on delete restrict,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  line_user_id_hash text not null check (line_user_id_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending'
    check (state in ('pending', 'linked', 'failed', 'expired', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint vehicle_line_account_link_nonce_expiry_check check (expires_at > created_at)
);

create index if not exists idx_vehicle_line_account_link_nonces_user_state
  on public.vehicle_line_account_link_nonces(user_id, state, expires_at);

alter table public.vehicle_driver_line_bindings enable row level security;
alter table public.vehicle_line_link_intents enable row level security;
alter table public.vehicle_line_account_link_nonces enable row level security;

revoke all on public.vehicle_driver_line_bindings from public, anon, authenticated;
revoke all on public.vehicle_line_link_intents from public, anon, authenticated;
revoke all on public.vehicle_line_account_link_nonces from public, anon, authenticated;
grant all on public.vehicle_driver_line_bindings to service_role;
grant all on public.vehicle_line_link_intents to service_role;
grant all on public.vehicle_line_account_link_nonces to service_role;

comment on table public.vehicle_driver_line_bindings is
  'Private driver-to-LINE identity binding; raw LINE user IDs are never returned to clients or written to logs.';
comment on table public.vehicle_line_link_intents is
  'Short-lived single-use link codes; stores only the SHA-256 code hash and consent timestamp.';
comment on table public.vehicle_line_account_link_nonces is
  'Short-lived single-use LINE account-link nonces; stores only hashes of nonce and LINE user ID.';

create or replace function public.consume_vehicle_line_link_intent(
  p_code_hash text,
  p_line_user_id_hash text,
  p_nonce_hash text,
  p_now timestamptz default now()
)
returns table (user_id uuid, intent_id uuid, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_intent public.vehicle_line_link_intents;
begin
  if p_code_hash !~ '^[0-9a-f]{64}$'
    or p_line_user_id_hash !~ '^[0-9a-f]{64}$'
    or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, null::uuid, 'invalid_request'::text;
    return;
  end if;

  select * into v_intent
  from public.vehicle_line_link_intents i
  where i.code_hash = p_code_hash
  for update;

  if not found then
    return query select null::uuid, null::uuid, 'invalid_or_expired'::text;
    return;
  end if;
  if v_intent.state <> 'pending' then
    return query select v_intent.user_id, v_intent.intent_id, 'already_used'::text;
    return;
  end if;
  if v_intent.expires_at <= p_now then
    update public.vehicle_line_link_intents set state = 'expired'
    where vehicle_line_link_intents.intent_id = v_intent.intent_id;
    return query select v_intent.user_id, v_intent.intent_id, 'expired'::text;
    return;
  end if;
  if v_intent.consented_at is null then
    update public.vehicle_line_link_intents set state = 'cancelled'
    where vehicle_line_link_intents.intent_id = v_intent.intent_id;
    return query select v_intent.user_id, v_intent.intent_id, 'consent_required'::text;
    return;
  end if;
  if not exists (
    select 1 from public.vehicle_dispatch_drivers d
    join public.users u on u.user_id = d.user_id and u.status = 'active'
    where d.user_id = v_intent.user_id and d.active
  ) then
    update public.vehicle_line_link_intents set state = 'cancelled'
    where vehicle_line_link_intents.intent_id = v_intent.intent_id;
    return query select v_intent.user_id, v_intent.intent_id, 'driver_inactive'::text;
    return;
  end if;
  if exists (
    select 1 from public.vehicle_driver_line_bindings b
    where b.user_id = v_intent.user_id and b.state = 'linked'
  ) then
    update public.vehicle_line_link_intents set state = 'cancelled'
    where vehicle_line_link_intents.intent_id = v_intent.intent_id;
    return query select v_intent.user_id, v_intent.intent_id, 'already_linked'::text;
    return;
  end if;

  update public.vehicle_line_link_intents
  set state = 'consumed', consumed_at = p_now, line_user_id_hash = p_line_user_id_hash
  where vehicle_line_link_intents.intent_id = v_intent.intent_id;
  insert into public.vehicle_line_account_link_nonces
    (intent_id, user_id, nonce_hash, line_user_id_hash, created_at, expires_at)
  values
    (v_intent.intent_id, v_intent.user_id, p_nonce_hash, p_line_user_id_hash,
      p_now, p_now + interval '10 minutes');
  return query select v_intent.user_id, v_intent.intent_id, 'ready'::text;
end;
$$;

create or replace function public.complete_vehicle_line_account_link(
  p_nonce_hash text,
  p_line_user_id_hash text,
  p_line_user_id text,
  p_link_result text,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nonce public.vehicle_line_account_link_nonces;
  v_binding public.vehicle_driver_line_bindings;
  v_has_binding boolean := false;
  v_consented_at timestamptz;
begin
  if p_nonce_hash !~ '^[0-9a-f]{64}$'
    or p_line_user_id_hash !~ '^[0-9a-f]{64}$'
    or nullif(btrim(coalesce(p_line_user_id, '')), '') is null
    or length(p_line_user_id) > 200
    or p_link_result not in ('ok', 'failed') then
    return 'invalid_request';
  end if;

  select * into v_nonce
  from public.vehicle_line_account_link_nonces n
  where n.nonce_hash = p_nonce_hash
  for update;
  if not found then return 'invalid_or_expired'; end if;
  if v_nonce.state <> 'pending' then return 'already_used'; end if;
  if v_nonce.expires_at <= p_now then
    update public.vehicle_line_account_link_nonces set state = 'expired', consumed_at = p_now
    where nonce_id = v_nonce.nonce_id;
    return 'expired';
  end if;
  if v_nonce.line_user_id_hash <> p_line_user_id_hash then return 'identity_mismatch'; end if;
  if p_link_result = 'failed' then
    update public.vehicle_line_account_link_nonces set state = 'failed', consumed_at = p_now
    where nonce_id = v_nonce.nonce_id;
    return 'line_verification_failed';
  end if;
  if not exists (
    select 1 from public.vehicle_dispatch_drivers d
    join public.users u on u.user_id = d.user_id and u.status = 'active'
    where d.user_id = v_nonce.user_id and d.active
  ) then
    update public.vehicle_line_account_link_nonces set state = 'rejected', consumed_at = p_now
    where nonce_id = v_nonce.nonce_id;
    return 'driver_inactive';
  end if;

  select * into v_binding
  from public.vehicle_driver_line_bindings b
  where b.user_id = v_nonce.user_id
  for update;
  v_has_binding := found;
  if v_has_binding then
    select i.consented_at into v_consented_at
    from public.vehicle_line_link_intents i
    where i.intent_id = v_nonce.intent_id;
  end if;
  if v_has_binding and v_binding.state = 'linked' then
    update public.vehicle_line_account_link_nonces set state = 'rejected', consumed_at = p_now
    where nonce_id = v_nonce.nonce_id;
    return case when v_binding.line_user_id = p_line_user_id then 'already_linked' else 'binding_conflict' end;
  end if;
  if exists (
    select 1 from public.vehicle_driver_line_bindings b
    where b.line_user_id = p_line_user_id and b.state = 'linked' and b.user_id <> v_nonce.user_id
  ) then
    update public.vehicle_line_account_link_nonces set state = 'rejected', consumed_at = p_now
    where nonce_id = v_nonce.nonce_id;
    return 'binding_conflict';
  end if;

  begin
    if v_has_binding then
      update public.vehicle_driver_line_bindings
      set line_user_id = p_line_user_id, state = 'linked',
          consented_at = v_consented_at, linked_at = p_now, unlinked_at = null
      where user_id = v_nonce.user_id;
    else
      insert into public.vehicle_driver_line_bindings
        (user_id, line_user_id, state, consented_at, linked_at)
      values (v_nonce.user_id, p_line_user_id, 'linked',
        (select i.consented_at from public.vehicle_line_link_intents i where i.intent_id = v_nonce.intent_id), p_now);
    end if;
  exception when unique_violation then
    update public.vehicle_line_account_link_nonces set state = 'rejected', consumed_at = p_now
    where nonce_id = v_nonce.nonce_id;
    return 'binding_conflict';
  end;

  update public.vehicle_line_account_link_nonces set state = 'linked', consumed_at = p_now
  where nonce_id = v_nonce.nonce_id;
  return 'linked';
end;
$$;

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
  return v_unlinked;
end;
$$;

revoke all on function public.consume_vehicle_line_link_intent(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_vehicle_line_account_link(text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.unlink_vehicle_line_account(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_vehicle_line_link_intent(text, text, text, timestamptz) to service_role;
grant execute on function public.complete_vehicle_line_account_link(text, text, text, text, timestamptz) to service_role;
grant execute on function public.unlink_vehicle_line_account(uuid, timestamptz) to service_role;

commit;
