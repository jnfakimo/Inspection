-- 機電課電子交接簿：依紙本三班制逐項記錄工作，並保留每日值班簽名。
create table if not exists public.mechanical_handover_entries (
  entry_id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift_code text not null check (shift_code in ('01-09','09-17','17-01')),
  category text not null,
  work_item text not null,
  details text,
  technician_ids uuid[] not null default '{}',
  result text not null default '正常',
  notes text,
  sort_order integer not null default 0,
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.mechanical_handover_entries add column if not exists work_date date;
alter table public.mechanical_handover_entries add column if not exists shift_code text;
alter table public.mechanical_handover_entries add column if not exists category text;
alter table public.mechanical_handover_entries add column if not exists work_item text;
alter table public.mechanical_handover_entries add column if not exists details text;
alter table public.mechanical_handover_entries add column if not exists technician_ids uuid[] not null default '{}';
alter table public.mechanical_handover_entries add column if not exists result text not null default '正常';
alter table public.mechanical_handover_entries add column if not exists notes text;
alter table public.mechanical_handover_entries add column if not exists sort_order integer not null default 0;
alter table public.mechanical_handover_entries add column if not exists created_by uuid references public.users(user_id);
alter table public.mechanical_handover_entries add column if not exists created_at timestamptz not null default now();
alter table public.mechanical_handover_entries add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_mechanical_handover_date_shift on public.mechanical_handover_entries(work_date desc,shift_code,sort_order);

create table if not exists public.mechanical_handover_signatures (
  signature_id uuid primary key default gen_random_uuid(),
  work_date date not null,
  shift_code text not null check (shift_code in ('01-09','09-17','17-01')),
  signer_id uuid references public.users(user_id),
  signed_at timestamptz,
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now(),
  unique(work_date,shift_code)
);
alter table public.mechanical_handover_signatures add column if not exists signer_id uuid references public.users(user_id);
alter table public.mechanical_handover_signatures add column if not exists signed_at timestamptz;
alter table public.mechanical_handover_signatures add column if not exists updated_by uuid references public.users(user_id);
alter table public.mechanical_handover_signatures add column if not exists updated_at timestamptz not null default now();

alter table public.mechanical_handover_entries enable row level security;
alter table public.mechanical_handover_entries force row level security;
alter table public.mechanical_handover_signatures enable row level security;
alter table public.mechanical_handover_signatures force row level security;
revoke all on public.mechanical_handover_entries, public.mechanical_handover_signatures from anon;
grant select,insert,update on public.mechanical_handover_entries, public.mechanical_handover_signatures to authenticated;
drop policy if exists mechanical_handover_entries_read on public.mechanical_handover_entries;
drop policy if exists mechanical_handover_entries_write on public.mechanical_handover_entries;
create policy mechanical_handover_entries_read on public.mechanical_handover_entries for select to authenticated using (public.has_system_access('sys_handover'));
create policy mechanical_handover_entries_write on public.mechanical_handover_entries for insert to authenticated with check (public.has_system_access('sys_handover') and created_by=public.active_user_id());
drop policy if exists mechanical_handover_signatures_read on public.mechanical_handover_signatures;
drop policy if exists mechanical_handover_signatures_write on public.mechanical_handover_signatures;
drop policy if exists mechanical_handover_signatures_update on public.mechanical_handover_signatures;
create policy mechanical_handover_signatures_read on public.mechanical_handover_signatures for select to authenticated using (public.has_system_access('sys_handover'));
create policy mechanical_handover_signatures_write on public.mechanical_handover_signatures for insert to authenticated with check (public.has_system_access('sys_handover') and updated_by=public.active_user_id());
create policy mechanical_handover_signatures_update on public.mechanical_handover_signatures for update to authenticated using (public.has_system_access('sys_handover')) with check (public.has_system_access('sys_handover') and updated_by=public.active_user_id());
