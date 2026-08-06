-- Idempotent first-party client error monitoring; no third-party telemetry.
create table if not exists public.client_error_logs (
  error_id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('js_error','unhandled_rejection','api_error','manual')),
  message text not null,
  detail jsonb,
  page text,
  url text,
  user_id uuid references public.users(user_id),
  user_agent text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_client_error_logs_time on public.client_error_logs(occurred_at desc);
create index if not exists idx_client_error_logs_kind on public.client_error_logs(kind);
alter table public.client_error_logs enable row level security;
alter table public.client_error_logs force row level security;
revoke all on public.client_error_logs from anon;
grant select,insert on public.client_error_logs to authenticated;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='client_error_logs'
  loop execute format('drop policy if exists %I on public.client_error_logs',p.policyname); end loop;
end $$;
create policy client_errors_admin_read on public.client_error_logs for select to authenticated using(public.is_admin());
create policy client_errors_own_insert on public.client_error_logs for insert to authenticated
  with check(user_id is null or user_id=public.active_user_id());
