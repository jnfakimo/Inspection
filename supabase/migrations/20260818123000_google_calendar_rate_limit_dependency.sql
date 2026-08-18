-- Ensure the authenticated API rate limiter required by google-calendar exists.
-- This migration is intentionally scoped and idempotent so environments that
-- have not yet applied the broader backend security migration can still use
-- the personal Google Calendar integration safely.
begin;

create table if not exists public.api_rate_limits (
  rate_key text primary key,
  window_started timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;
revoke all on table public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_scope text default 'app-api',
  p_window_seconds integer default 60,
  p_max_requests integer default 120
) returns boolean
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_uid text := auth.uid()::text;
  v_scope text := regexp_replace(coalesce(p_scope,'app-api'), '[^a-zA-Z0-9:_-]', '', 'g');
  v_key text;
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='未登入';
  end if;
  if p_window_seconds not between 10 and 3600 or p_max_requests not between 10 and 1000 then
    raise exception using errcode='22023', message='限流參數無效';
  end if;

  v_key := v_uid || ':' || left(v_scope,40);
  insert into public.api_rate_limits(rate_key,window_started,request_count,updated_at)
  values(v_key,v_now,1,v_now)
  on conflict(rate_key) do update set
    window_started = case
      when v_now - api_rate_limits.window_started >= make_interval(secs => p_window_seconds) then v_now
      else api_rate_limits.window_started
    end,
    request_count = case
      when v_now - api_rate_limits.window_started >= make_interval(secs => p_window_seconds) then 1
      else api_rate_limits.request_count + 1
    end,
    updated_at = v_now
  returning * into v_row;

  return v_row.request_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_api_rate_limit(text,integer,integer) from public, anon;
grant execute on function public.consume_api_rate_limit(text,integer,integer) to authenticated;

commit;
