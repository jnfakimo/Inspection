-- V2 異常流量與錯誤爆量監測補強。
-- 只新增/更新安全狀態與設定，不刪除任何業務、告警或歷程資料。

begin;

-- Management API 執行的 migration 也要有版本防重放；同檔再次執行時在任何
-- 設定或 schema 變更前直接中止，避免把管理員後續調整覆回預設值。
create table if not exists public.system_migration_log (
  version text primary key,
  applied_at timestamptz not null default clock_timestamp()
);
alter table public.system_migration_log enable row level security;
alter table public.system_migration_log force row level security;
revoke all on public.system_migration_log from public,anon,authenticated;
do $$
begin
  if exists (
    select 1 from public.system_migration_log
    where version='20260825170000_security_monitoring_hardening'
  ) then
    raise exception 'migration 20260825170000_security_monitoring_hardening 已套用，拒絕重複執行'
      using errcode='55000';
  end if;
end;
$$;

-- line_notify_security_alerts 為唯一正式設定鍵。舊 V2 鍵僅作雙向相容，
-- 避免舊頁面寫入後與真正發送器狀態分歧。依系統擁有者指示正式啟用。
insert into public.system_settings(key,value,updated_at) values
  ('line_notify_security_alerts','true',now()),
  ('line_notify_security','true',now()),
  ('line_notify_error_threshold','true',now()),
  ('error_threshold_window_minutes','15',now()),
  ('error_threshold_count','20',now()),
  ('error_threshold_cooldown_minutes','60',now())
on conflict (key) do update
set value=excluded.value,
    updated_at=excluded.updated_at;

create or replace function public.sync_security_line_setting_alias()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_target text;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.key='line_notify_security_alerts' then
    v_target := 'line_notify_security';
  elsif new.key='line_notify_security' then
    v_target := 'line_notify_security_alerts';
  else
    return new;
  end if;
  insert into public.system_settings(key,value,updated_at)
  values(v_target,case when new.value='true' then 'true' else 'false' end,now())
  on conflict(key) do update
  set value=excluded.value, updated_at=excluded.updated_at
  where public.system_settings.value is distinct from excluded.value;
  return new;
end;
$$;

drop trigger if exists trg_sync_security_line_setting_alias on public.system_settings;
create trigger trg_sync_security_line_setting_alias
after insert or update of value on public.system_settings
for each row
when (new.key in ('line_notify_security_alerts','line_notify_security'))
execute function public.sync_security_line_setting_alias();

revoke all on function public.sync_security_line_setting_alias() from public,anon,authenticated;

-- 新增伺服器端告警類型；既有告警不改寫。
alter table public.security_alerts drop constraint if exists security_alerts_type_check;
alter table public.security_alerts add constraint security_alerts_type_check
  check (alert_type in (
    'bulk_read','repeated_denied','suspicious_file',
    'rate_limit','login_bruteforce','error_threshold'
  ));

-- 舊索引只處理已登入人員；匿名來源改依告警類型＋資源聚合。每個 IP 的限流
-- 證據仍在 request_rate_limit_events，告警與 LINE 不會被 botnet 來源數放大。
-- 較舊重複列不刪除，只標示已處理並保留證據。
with ranked as (
  select alert_id,
         row_number() over (
           partition by alert_type,md5(coalesce(resource,''))
           order by last_seen_at desc,detected_at desc,alert_id desc
         ) as item_rank
  from public.security_alerts
  where status='open' and operator_id is null
)
update public.security_alerts a
set status='acknowledged',
    acknowledged_at=coalesce(a.acknowledged_at,now()),
    details=coalesce(a.details,'{}'::jsonb)||jsonb_build_object(
      'auto_deduplicated',true,
      'auto_deduplicated_reason','建立伺服器端告警並發保護',
      'auto_deduplicated_at',now()
    )
from ranked r
where a.alert_id=r.alert_id and r.item_rank>1;

create unique index if not exists ux_security_alerts_open_anonymous_type_resource
  on public.security_alerts(alert_type,(md5(coalesce(resource,''))))
  where status='open' and operator_id is null;

-- client_error_logs 只允許由已驗證身分的 audit-event Edge Function 代寫；
-- 瀏覽器不可再用 user_id=null 或自訂未來 occurred_at 灌入錯誤門檻。
drop policy if exists client_errors_own_insert on public.client_error_logs;
drop policy if exists client_error_logs_insert on public.client_error_logs;
revoke insert on public.client_error_logs from authenticated;

-- 新稽核事件已不再複製姓名、帳號、Email 與部門名稱；離職去識別化時也同步
-- 清理舊 audit_logs JSON 的直接識別欄位，但保留 operator_id 與不可刪歷程。
create or replace function public.deidentify_departed_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_target record;
  v_placeholder text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.users u
    where u.auth_id=auth.uid() and u.status='active'
      and (u.role='admin' or u.rbac_role in ('admin','sysadmin'))
  ) then
    raise exception '僅限已登入的系統管理員執行個資去識別化'
      using errcode='42501';
  end if;
  select * into v_target from public.users where user_id=p_user_id;
  if v_target is null then
    raise exception '找不到指定的使用者' using errcode='P0002';
  end if;
  if v_target.status<>'inactive' then
    raise exception '只能對已停用（離職）的帳號執行去識別化，請先將該帳號停用'
      using errcode='22023';
  end if;
  v_placeholder:='已離職人員-'||right(p_user_id::text,4);
  update public.users set
    name=v_placeholder,
    phone=null,
    email=null,
    username='deidentified-'||p_user_id::text
  where user_id=p_user_id;
  update public.audit_logs
  set changes=jsonb_set(
    coalesce(changes,'{}'::jsonb),'{actor}',
    (coalesce(changes->'actor','{}'::jsonb)
      -'username'-'email'-'name'-'department')
      ||jsonb_build_object('user_id',p_user_id,'display','已去識別化'),
    true
  )
  where operator_id=p_user_id and jsonb_typeof(changes->'actor')='object';
end;
$$;
revoke all on function public.deidentify_departed_user(uuid) from public;
grant execute on function public.deidentify_departed_user(uuid) to authenticated;

update public.audit_logs a
set changes=jsonb_set(
  coalesce(a.changes,'{}'::jsonb),'{actor}',
  (coalesce(a.changes->'actor','{}'::jsonb)
    -'username'-'email'-'name'-'department')
    ||jsonb_build_object('user_id',a.operator_id,'display','已去識別化'),
  true
)
from public.users u
where a.operator_id=u.user_id
  and u.username like 'deidentified-%'
  and jsonb_typeof(a.changes->'actor')='object';

-- LINE 每次嘗試皆用 append-only 資料列保存，不再只覆寫 details JSON。
create table if not exists public.security_alert_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.security_alerts(alert_id),
  channel text not null default 'line' check (channel in ('line','in_app')),
  status text not null check (status in ('sent','failed','disabled','not_configured')),
  http_status integer,
  response_summary text,
  attempted_at timestamptz not null default clock_timestamp()
);
alter table public.security_alert_deliveries add column if not exists delivery_id uuid default gen_random_uuid();
alter table public.security_alert_deliveries add column if not exists alert_id uuid references public.security_alerts(alert_id);
alter table public.security_alert_deliveries add column if not exists channel text not null default 'line';
alter table public.security_alert_deliveries add column if not exists status text;
alter table public.security_alert_deliveries add column if not exists http_status integer;
alter table public.security_alert_deliveries add column if not exists response_summary text;
alter table public.security_alert_deliveries add column if not exists attempted_at timestamptz not null default clock_timestamp();

create index if not exists idx_security_alert_deliveries_alert_time
  on public.security_alert_deliveries(alert_id,attempted_at desc);
create index if not exists idx_security_alert_deliveries_status_time
  on public.security_alert_deliveries(status,attempted_at desc);

-- 只將「已被阻擋」的限流事件永久保存：IP、範圍、視窗、計數與 request-id。
-- 正常放行僅保留 request_rate_limits 當前視窗計數，避免無上限收集人員流量。
-- 兩者都不存 Authorization、Token、Cookie 或請求內容。
create table if not exists public.request_rate_limit_events (
  event_id uuid primary key default gen_random_uuid(),
  subject text not null,
  actor_id uuid references public.users(user_id),
  ip_address text,
  scope text not null,
  request_id text not null,
  window_started timestamptz not null,
  window_seconds integer not null check (window_seconds > 0),
  request_count integer not null check (request_count > 0),
  maximum_requests integer not null check (maximum_requests > 0),
  allowed boolean not null default false check (allowed=false),
  occurred_at timestamptz not null default clock_timestamp()
);
alter table public.request_rate_limit_events add column if not exists event_id uuid default gen_random_uuid();
alter table public.request_rate_limit_events add column if not exists subject text;
alter table public.request_rate_limit_events add column if not exists actor_id uuid references public.users(user_id);
alter table public.request_rate_limit_events add column if not exists ip_address text;
alter table public.request_rate_limit_events add column if not exists scope text;
alter table public.request_rate_limit_events add column if not exists request_id text;
alter table public.request_rate_limit_events add column if not exists window_started timestamptz;
alter table public.request_rate_limit_events add column if not exists window_seconds integer;
alter table public.request_rate_limit_events add column if not exists request_count integer;
alter table public.request_rate_limit_events add column if not exists maximum_requests integer;
alter table public.request_rate_limit_events add column if not exists allowed boolean;
alter table public.request_rate_limit_events add column if not exists occurred_at timestamptz not null default clock_timestamp();

create index if not exists idx_request_rate_limit_events_scope_time
  on public.request_rate_limit_events(scope,occurred_at desc);
create index if not exists idx_request_rate_limit_events_ip_time
  on public.request_rate_limit_events(ip_address,occurred_at desc)
  where ip_address is not null;
create index if not exists idx_request_rate_limit_events_denied_time
  on public.request_rate_limit_events(occurred_at desc)
  where allowed=false;
create index if not exists idx_request_rate_limit_events_request
  on public.request_rate_limit_events(request_id,scope);

create or replace function public.reject_security_monitor_history_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '資安監測歷程永久保存：禁止修改、刪除或清空 %。',tg_table_name
    using errcode='55000';
end;
$$;
revoke all on function public.reject_security_monitor_history_change() from public,anon,authenticated;

drop trigger if exists trg_protect_security_alert_deliveries on public.security_alert_deliveries;
create trigger trg_protect_security_alert_deliveries
before update or delete or truncate on public.security_alert_deliveries
for each statement execute function public.reject_security_monitor_history_change();

drop trigger if exists trg_protect_request_rate_limit_events on public.request_rate_limit_events;
create trigger trg_protect_request_rate_limit_events
before update or delete or truncate on public.request_rate_limit_events
for each statement execute function public.reject_security_monitor_history_change();

drop trigger if exists trg_protect_system_migration_log on public.system_migration_log;
create trigger trg_protect_system_migration_log
before update or delete or truncate on public.system_migration_log
for each statement execute function public.reject_security_monitor_history_change();

alter table public.security_alert_deliveries enable row level security;
alter table public.security_alert_deliveries force row level security;
alter table public.request_rate_limit_events enable row level security;
alter table public.request_rate_limit_events force row level security;

drop policy if exists security_alert_deliveries_admin_read on public.security_alert_deliveries;
create policy security_alert_deliveries_admin_read on public.security_alert_deliveries
  for select to authenticated using (public.is_admin());
drop policy if exists request_rate_limit_events_admin_read on public.request_rate_limit_events;
create policy request_rate_limit_events_admin_read on public.request_rate_limit_events
  for select to authenticated using (public.is_admin());

revoke all on public.security_alert_deliveries from public,anon,authenticated;
revoke all on public.request_rate_limit_events from public,anon,authenticated;
grant select on public.security_alert_deliveries to authenticated;
grant select on public.request_rate_limit_events to authenticated;

-- 取代舊的「只覆寫一列計數」版本。預設參數讓尚未更新的 Edge Function
-- 繼續只傳 subject/scope 也能運作。
drop function if exists public.enforce_request_rate_limit(text,text);
drop function if exists public.enforce_request_rate_limit(text,text,text,text,uuid);
create function public.enforce_request_rate_limit(
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

  select maximum,seconds into v_limit,v_window_seconds
  from (values
    ('app-api',60,60),
    ('app-api:module_data',30,60),
    ('app-api:dashboard',12,60),
    ('app-api:inspections',20,60),
    ('app-api:equipment_map',4,60),
    ('admin-api',30,60),
    ('admin-api:write',10,60),
    ('ipcam-proxy',30,60),
    ('patrol-checkin',12,60),
    ('audit-event',120,60),
    ('client-error-report',10,900),
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
    window_started=case
      when v_now-public.request_rate_limits.window_started>=make_interval(secs=>v_window_seconds) then v_now
      else public.request_rate_limits.window_started end,
    request_count=case
      when v_now-public.request_rate_limits.window_started>=make_interval(secs=>v_window_seconds) then 1
      else public.request_rate_limits.request_count+1 end,
    updated_at=v_now
  returning request_count,window_started into v_count,v_window_started;

  v_allowed := v_count<=v_limit;
  -- 第一次拒絕一定保存；後續只在計數達 2 的次方時保存檢查點。
  -- 即使攻擊持續，永久歷程也只以對數成長，不會把每個 429 放大成 DB 寫入。
  if not v_allowed and (
    v_count=v_limit+1 or (v_count & (v_count-1))=0
  ) then
    insert into public.request_rate_limit_events(
      subject,actor_id,ip_address,scope,request_id,window_started,window_seconds,
      request_count,maximum_requests,allowed,occurred_at
    ) values(
      v_subject,p_actor_id,nullif(left(btrim(p_ip_address),80),''),v_scope,v_request_id,
      v_window_started,v_window_seconds,v_count,v_limit,false,v_now
    );
  end if;
  return v_allowed;
end;
$$;

revoke all on function public.enforce_request_rate_limit(text,text,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.enforce_request_rate_limit(text,text,text,text,uuid)
  to service_role;

-- 同時保留告警 details 的最新狀態（舊 UI 相容）與 append-only 送達歷程。
create or replace function public.record_security_alert_line_delivery(
  p_alert_id uuid,
  p_status text,
  p_http_status integer default null,
  p_response text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_response text:=left(coalesce(p_response,''),500);
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='僅限受信任的後端服務記錄送達結果';
  end if;
  if p_status not in ('sent','failed','disabled','not_configured') then
    raise exception '不支援的 LINE 推播狀態';
  end if;

  insert into public.security_alert_deliveries(
    alert_id,channel,status,http_status,response_summary,attempted_at
  ) values(p_alert_id,'line',p_status,p_http_status,v_response,v_now);

  update public.security_alerts
  set details=coalesce(details,'{}'::jsonb)||jsonb_build_object(
    'line_notification',jsonb_build_object(
      'status',p_status,
      'attempted_at',v_now,
      'sent_at',case when p_status='sent' then v_now else null end,
      'http_status',p_http_status,
      'response',v_response
    )
  )
  where alert_id=p_alert_id;
end;
$$;

revoke all on function public.record_security_alert_line_delivery(uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.record_security_alert_line_delivery(uuid,text,integer,text)
  to service_role;

comment on table public.request_rate_limit_events is
  '永久保存受信任後端首次阻擋與指數檢查點，不包含認證秘密或請求內容。';
comment on table public.security_alert_deliveries is
  '資安告警每次 LINE 送達嘗試的不可變更歷程。';

insert into public.system_migration_log(version)
values('20260825170000_security_monitoring_hardening');

notify pgrst,'reload schema';
commit;
