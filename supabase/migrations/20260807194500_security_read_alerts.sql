-- 安全告警：大量資料讀取、重複拒絕存取及可疑檔案路徑。
-- 告警永久保存，只能由系統管理員檢視及標記已處理。

begin;

create table if not exists public.security_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  severity text not null default 'warning',
  title text not null,
  message text not null,
  operator_id uuid references public.users(user_id),
  actor_identifier text,
  ip_address text,
  resource text,
  event_count integer not null default 1,
  window_minutes integer not null default 0,
  status text not null default 'open',
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(user_id),
  constraint security_alerts_type_check
    check (alert_type in ('bulk_read','repeated_denied','suspicious_file')),
  constraint security_alerts_severity_check
    check (severity in ('warning','critical')),
  constraint security_alerts_status_check
    check (status in ('open','acknowledged')),
  constraint security_alerts_event_count_check check (event_count > 0),
  constraint security_alerts_window_check check (window_minutes >= 0)
);

alter table public.security_alerts add column if not exists alert_type text;
alter table public.security_alerts add column if not exists severity text not null default 'warning';
alter table public.security_alerts add column if not exists title text;
alter table public.security_alerts add column if not exists message text;
alter table public.security_alerts add column if not exists operator_id uuid references public.users(user_id);
alter table public.security_alerts add column if not exists actor_identifier text;
alter table public.security_alerts add column if not exists ip_address text;
alter table public.security_alerts add column if not exists resource text;
alter table public.security_alerts add column if not exists event_count integer not null default 1;
alter table public.security_alerts add column if not exists window_minutes integer not null default 0;
alter table public.security_alerts add column if not exists status text not null default 'open';
alter table public.security_alerts add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.security_alerts add column if not exists detected_at timestamptz not null default now();
alter table public.security_alerts add column if not exists last_seen_at timestamptz not null default now();
alter table public.security_alerts add column if not exists acknowledged_at timestamptz;
alter table public.security_alerts add column if not exists acknowledged_by uuid references public.users(user_id);

create index if not exists idx_security_alerts_open_time
  on public.security_alerts (status, detected_at desc);
create index if not exists idx_security_alerts_operator_time
  on public.security_alerts (operator_id, detected_at desc);
create index if not exists idx_security_alerts_ip_time
  on public.security_alerts (ip_address, detected_at desc);

alter table public.security_alerts enable row level security;

drop policy if exists security_alerts_admin_read on public.security_alerts;
create policy security_alerts_admin_read on public.security_alerts
  for select to authenticated using (public.is_admin());

drop policy if exists security_alerts_admin_update on public.security_alerts;
create policy security_alerts_admin_update on public.security_alerts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke insert, delete, truncate on public.security_alerts from anon, authenticated;
grant select, update on public.security_alerts to authenticated;

create or replace function public.reject_security_alert_removal()
returns trigger
language plpgsql
as $$
begin
  raise exception '安全告警永久保存：禁止刪除或清空 security_alerts。'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_prevent_security_alert_removal on public.security_alerts;
create trigger trg_prevent_security_alert_removal
  before delete or truncate on public.security_alerts
  for each statement execute function public.reject_security_alert_removal();

comment on table public.security_alerts is
  '永久安全告警：大量或廣泛資料讀取、重複拒絕存取及可疑檔案路徑。';

commit;
