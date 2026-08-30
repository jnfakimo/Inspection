-- 市場行情情境模擬：保留每次基準、假設與推估結果，供後續追蹤。
-- 本模型只能新增，不允許更新、刪除或清空既有紀錄。

begin;

create table if not exists public.market_simulation_runs (
  simulation_id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  source_id uuid not null references public.market_data_sources(source_id),
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  base_totals jsonb not null check (jsonb_typeof(base_totals) = 'object'),
  assumptions jsonb not null check (jsonb_typeof(assumptions) = 'object'),
  projected_totals jsonb not null check (jsonb_typeof(projected_totals) = 'object'),
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  status text not null default 'completed' check (status in ('draft','completed'))
);

-- create table if not exists 不會補齊已存在資料表的欄位。
alter table public.market_simulation_runs add column if not exists simulation_id uuid default gen_random_uuid();
alter table public.market_simulation_runs add column if not exists name text not null;
alter table public.market_simulation_runs add column if not exists source_id uuid not null references public.market_data_sources(source_id);
alter table public.market_simulation_runs add column if not exists period_from date not null;
alter table public.market_simulation_runs add column if not exists period_to date not null;
alter table public.market_simulation_runs add column if not exists base_totals jsonb not null;
alter table public.market_simulation_runs add column if not exists assumptions jsonb not null;
alter table public.market_simulation_runs add column if not exists projected_totals jsonb not null;
alter table public.market_simulation_runs add column if not exists created_by uuid not null references public.users(user_id);
alter table public.market_simulation_runs add column if not exists created_at timestamptz not null default now();
alter table public.market_simulation_runs add column if not exists status text not null default 'completed';

create index if not exists idx_market_simulation_created
  on public.market_simulation_runs(created_at desc);
create index if not exists idx_market_simulation_owner_created
  on public.market_simulation_runs(created_by, created_at desc);

alter table public.market_simulation_runs enable row level security;

drop policy if exists market_simulation_read on public.market_simulation_runs;
drop policy if exists market_simulation_insert on public.market_simulation_runs;

create policy market_simulation_read on public.market_simulation_runs
  for select to authenticated using (
    (public.market_analytics_has_access() or public.market_analytics_can_manage())
    and (public.market_analytics_can_manage() or created_by = (
      select u.user_id from public.users u where u.auth_id = auth.uid() and u.status = 'active'
    ))
  );

create policy market_simulation_insert on public.market_simulation_runs
  for insert to authenticated with check (
    (public.market_analytics_has_access() or public.market_analytics_can_manage())
    and created_by = (
      select u.user_id from public.users u where u.auth_id = auth.uid() and u.status = 'active'
    )
  );

revoke update, delete, truncate on public.market_simulation_runs from anon, authenticated;
grant select, insert on public.market_simulation_runs to authenticated;

create or replace function public.reject_market_simulation_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  raise exception using
    errcode = '42501',
    message = '市場模擬紀錄為不可變更的追蹤資料';
end;
$$;
revoke all on function public.reject_market_simulation_mutation() from public;

drop trigger if exists trg_market_simulation_append_only on public.market_simulation_runs;
create trigger trg_market_simulation_append_only
before update or delete or truncate on public.market_simulation_runs
for each statement execute function public.reject_market_simulation_mutation();

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.market_simulation_runs;
    create trigger trg_prevent_removal
      before delete or truncate on public.market_simulation_runs
      for each statement execute function public.reject_physical_data_removal();
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
