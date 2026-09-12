begin;

-- 系統管理員可從既有資安告警解除單一來源 IP 的帳號申請限流。
-- 只重設可變動的目前視窗；security_alerts、request_rate_limit_events 與 audit_logs
-- 都保留，避免「解除」被誤作刪除資安證據的管道。
create or replace function public.admin_release_account_application_rate_limit(
  p_alert_id uuid,
  p_operator_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alert public.security_alerts%rowtype;
  v_operator_role text;
  v_operator_legacy_role text;
  v_operator_status text;
  v_ip text;
  v_scope constant text := 'username-login:account_application';
  v_released_at timestamptz := clock_timestamp();
  v_previous_count integer := 0;
  v_previous_window_started timestamptz;
  v_release jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = '僅限受信任的後端服務解除帳號申請限制';
  end if;
  if p_alert_id is null or p_operator_id is null then
    raise exception using errcode = '22023', message = '告警或操作者識別碼無效';
  end if;

  select rbac_role, role, status
    into v_operator_role, v_operator_legacy_role, v_operator_status
  from public.users
  where user_id = p_operator_id;
  if not found or v_operator_status <> 'active'
      or not (v_operator_role = 'sysadmin' or v_operator_legacy_role = 'admin') then
    raise exception using errcode = '42501', message = '僅限系統管理員解除帳號申請限制';
  end if;

  select * into v_alert
  from public.security_alerts
  where alert_id = p_alert_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '找不到指定資安告警';
  end if;
  if coalesce(v_alert.alert_type, '') not in ('rate_limit', 'rate_limit_exceeded')
      or coalesce(v_alert.resource, '') <> v_scope then
    raise exception using errcode = '22023', message = '此告警不是帳號申請限流事件';
  end if;
  if coalesce(v_alert.details, '{}'::jsonb) ? 'manual_unblock' then
    raise exception using errcode = '22023', message = '此帳號申請限制已由系統管理員解除';
  end if;

  v_ip := nullif(btrim(v_alert.ip_address), '');
  if v_ip is null or length(v_ip) > 80 or v_ip ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = '告警沒有可解除的有效來源 IP';
  end if;

  select request_count, window_started
    into v_previous_count, v_previous_window_started
  from public.request_rate_limits
  where subject = v_ip and scope = v_scope
  for update;
  if not found then
    v_previous_count := 0;
    v_previous_window_started := null;
  end if;

  insert into public.request_rate_limits(subject, scope, window_started, request_count, updated_at)
  values(v_ip, v_scope, v_released_at, 0, v_released_at)
  on conflict(subject, scope) do update set
    window_started = excluded.window_started,
    request_count = 0,
    updated_at = excluded.updated_at;

  v_release := jsonb_build_object(
    'released_at', v_released_at,
    'released_by', p_operator_id,
    'scope', v_scope,
    'previous_request_count', v_previous_count,
    'previous_window_started', v_previous_window_started
  );

  update public.security_alerts set
    status = case when status = 'open' then 'acknowledged' else status end,
    acknowledged_at = case when status = 'open' then v_released_at else acknowledged_at end,
    acknowledged_by = case when status = 'open' then p_operator_id else acknowledged_by end,
    details = jsonb_set(coalesce(details, '{}'::jsonb), '{manual_unblock}', v_release, true)
  where alert_id = p_alert_id;

  insert into public.audit_logs(
    table_name, record_id, action, changes, operator_id, operated_at, source, ip_address
  ) values (
    'request_rate_limits', p_alert_id::text, 'status_change',
    jsonb_build_object(
      'event_type', 'account_application_rate_limit_released',
      'alert_id', p_alert_id,
      'scope', v_scope,
      'ip_address', v_ip,
      'previous_request_count', v_previous_count,
      'previous_window_started', v_previous_window_started,
      'released_at', v_released_at
    ),
    p_operator_id, v_released_at, 'v2-admin', v_ip
  );

  return jsonb_build_object(
    'released', true,
    'alert_id', p_alert_id,
    'ip_address', v_ip,
    'previous_request_count', v_previous_count,
    'released_at', v_released_at
  );
end;
$$;

revoke all on function public.admin_release_account_application_rate_limit(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_release_account_application_rate_limit(uuid, uuid)
  to service_role;

comment on function public.admin_release_account_application_rate_limit(uuid, uuid) is
  '系統管理員解除單一 IP 的帳號申請限流；保留原告警、阻擋事件並新增稽核紀錄。';

notify pgrst, 'reload schema';

commit;
