-- 第一階段防濫用：由受信任的 Edge Functions 對已驗證帳號執行固定窗口限流，
-- 並收斂巡檢簽到紀錄的讀取範圍。僅新增保護，不刪除業務資料。
begin;

create table if not exists public.request_rate_limits (
  subject text not null,
  scope text not null,
  window_started timestamptz not null default clock_timestamp(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (subject, scope)
);

alter table public.request_rate_limits enable row level security;
alter table public.request_rate_limits force row level security;
revoke all on table public.request_rate_limits from public, anon, authenticated;

create or replace function public.enforce_request_rate_limit(
  p_subject text,
  p_scope text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject text := nullif(btrim(p_subject), '');
  v_limit integer;
  v_window_seconds integer := 60;
  v_now timestamptz := clock_timestamp();
  v_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = '僅限受信任的後端服務執行限流';
  end if;
  if v_subject is null or length(v_subject) > 200 then
    raise exception using errcode = '22023', message = '限流主體無效';
  end if;

  v_limit := case p_scope
    when 'app-api' then 60
    when 'app-api:module_data' then 30
    when 'app-api:dashboard' then 12
    when 'app-api:inspections' then 20
    when 'app-api:equipment_map' then 4
    when 'admin-api' then 30
    when 'admin-api:write' then 10
    when 'ipcam-proxy' then 30
    when 'patrol-checkin' then 12
    when 'audit-event' then 120
    else null
  end;
  if v_limit is null then
    raise exception using errcode = '22023', message = '不支援的限流範圍';
  end if;

  insert into public.request_rate_limits (
    subject, scope, window_started, request_count, updated_at
  ) values (
    v_subject, p_scope, v_now, 1, v_now
  )
  on conflict (subject, scope) do update set
    window_started = case
      when v_now - request_rate_limits.window_started >= make_interval(secs => v_window_seconds)
        then v_now
      else request_rate_limits.window_started
    end,
    request_count = case
      when v_now - request_rate_limits.window_started >= make_interval(secs => v_window_seconds)
        then 1
      else request_rate_limits.request_count + 1
    end,
    updated_at = v_now
  returning request_count into v_count;

  return v_count <= v_limit;
end;
$$;

revoke all on function public.enforce_request_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.enforce_request_rate_limit(text, text) to service_role;

alter table public.checkin_logs enable row level security;
alter table public.checkin_logs force row level security;
drop policy if exists "allow_all_for_now" on public.checkin_logs;
drop policy if exists "authenticated_only" on public.checkin_logs;
drop policy if exists "checkin_logs_patrol_read" on public.checkin_logs;
drop policy if exists "checkin_logs_select_authenticated" on public.checkin_logs;
drop policy if exists "checkin_logs_guardpatrol_read" on public.checkin_logs;
create policy checkin_logs_guardpatrol_read
  on public.checkin_logs for select to authenticated
  using (public.has_system_access('sys_guardpatrol'));

notify pgrst, 'reload schema';
commit;
