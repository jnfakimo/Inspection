begin;

-- Allow normal concurrent use of the dashboard and analytics pages.
-- Limits remain per authenticated subject (not shared by all users).
create or replace function public.enforce_request_rate_limit(
  p_subject text,
  p_scope text,
  p_ip_address text default null,
  p_request_id text default null,
  p_actor_id uuid default null
) returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_subject text := nullif(left(btrim(p_subject),200),'');
  v_scope text := nullif(left(btrim(p_scope),100),'');
  v_limit integer;
  v_window_seconds integer;
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_window_started timestamptz;
  v_allowed boolean;
  v_request_id text := coalesce(nullif(left(btrim(p_request_id),100),''),gen_random_uuid()::text);
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='僅限受信任的後端服務執行限流';
  end if;
  if v_subject is null or v_scope is null then
    raise exception using errcode='22023',message='限流主體或範圍無效';
  end if;

  -- These are per user and per scope. Analytics intentionally allows the
  -- comparison page's parallel summaries without affecting other modules.
  select maximum,seconds into v_limit,v_window_seconds
  from (values
    ('app-api',240,60),
    ('app-api:module_data',120,60),
    ('app-api:dashboard',60,60),
    ('app-api:inspections',60,60),
    ('app-api:equipment_map',30,60),
    ('admin-api',120,60),
    ('admin-api:write',30,60),
    ('ipcam-proxy',60,60),
    ('patrol-checkin',30,60),
    ('audit-event',240,60),
    ('client-error-report',30,900),
    ('username-login:captcha',30,600),
    ('username-login:account_application',5,86400),
    ('username-login:login',20,600)
  ) limits(scope,maximum,seconds)
  where limits.scope=v_scope;
  if v_limit is null then
    raise exception using errcode='22023',message='不支援的限流範圍';
  end if;

  insert into public.request_rate_limits(subject,scope,window_started,request_count,updated_at)
  values(v_subject,v_scope,v_now,1,v_now)
  on conflict(subject,scope) do update set
    window_started=case when v_now-public.request_rate_limits.window_started>=make_interval(secs=>v_window_seconds) then v_now else public.request_rate_limits.window_started end,
    request_count=case when v_now-public.request_rate_limits.window_started>=make_interval(secs=>v_window_seconds) then 1 else public.request_rate_limits.request_count+1 end,
    updated_at=v_now
  returning request_count,window_started into v_count,v_window_started;

  v_allowed := v_count<=v_limit;
  if not v_allowed and (v_count=v_limit+1 or (v_count & (v_count-1))=0) then
    insert into public.request_rate_limit_events(subject,actor_id,ip_address,scope,request_id,window_started,window_seconds,request_count,maximum_requests,allowed,occurred_at)
    values(v_subject,p_actor_id,nullif(left(btrim(p_ip_address),80),''),v_scope,v_request_id,v_window_started,v_window_seconds,v_count,v_limit,false,v_now);
  end if;
  return v_allowed;
end;
$$;

revoke all on function public.enforce_request_rate_limit(text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.enforce_request_rate_limit(text,text,text,text,uuid) to service_role;

commit;
