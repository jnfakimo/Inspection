-- Create short-lived LINE link intents only through the authenticated app-api.
begin;

create or replace function public.create_vehicle_line_link_intent(
  p_user_id uuid,
  p_code_hash text,
  p_consented_at timestamptz,
  p_now timestamptz default now()
)
returns table (outcome text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_status text;
  v_expires_at timestamptz := p_now + interval '10 minutes';
begin
  if p_user_id is null
    or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_consented_at is null
    or p_now is null then
    return query select 'invalid_request'::text, null::timestamptz;
    return;
  end if;

  -- Serialize intent starts for this service account; callers may only pass their session user.
  select u.status into v_user_status
  from public.users u
  where u.user_id = p_user_id
  for update;
  if not found or v_user_status <> 'active' then
    return query select 'user_inactive'::text, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1 from public.vehicle_dispatch_drivers d
    where d.user_id = p_user_id and d.active
  ) then
    return query select 'driver_inactive'::text, null::timestamptz;
    return;
  end if;

  if exists (
    select 1 from public.vehicle_driver_line_bindings b
    where b.user_id = p_user_id and b.state = 'linked'
  ) then
    return query select 'already_linked'::text, null::timestamptz;
    return;
  end if;

  update public.vehicle_line_link_intents
  set state = 'cancelled'
  where user_id = p_user_id and state = 'pending';

  update public.vehicle_line_account_link_nonces
  set state = 'cancelled', consumed_at = p_now
  where user_id = p_user_id and state = 'pending';

  insert into public.vehicle_line_link_intents
    (user_id, code_hash, state, consented_at, created_at, expires_at)
  values
    (p_user_id, p_code_hash, 'pending', p_consented_at, p_now, v_expires_at);

  return query select 'created'::text, v_expires_at;
end;
$$;

revoke all on function public.create_vehicle_line_link_intent(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_vehicle_line_link_intent(uuid, text, timestamptz, timestamptz)
  to service_role;

commit;
