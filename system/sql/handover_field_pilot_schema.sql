-- 電子交接簿現場調整版 — Supabase / PostgreSQL
-- 先於正式整合前建立獨立資料表，避免影響 handover_records。

create table if not exists handover_field_pilot_records (
  record_id uuid primary key default gen_random_uuid(),
  record_date date not null,
  shift_code text not null,
  shift_start time not null,
  shift_end time not null,
  handover_by uuid references users(user_id),
  supervisor_id uuid references users(user_id),
  instruction text not null default '',
  items jsonb not null default '[]'::jsonb,
  notes text not null default '',
  supervisor_note text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted','reviewed','closed')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references users(user_id),
  created_by uuid references users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (record_date, shift_code)
);

alter table handover_field_pilot_records
  add column if not exists supervisor_note text not null default '';

create index if not exists idx_hfp_date on handover_field_pilot_records(record_date desc);
create index if not exists idx_hfp_status on handover_field_pilot_records(status);

alter table handover_field_pilot_records enable row level security;
drop policy if exists "handover_field_pilot_authenticated" on handover_field_pilot_records;
create policy "handover_field_pilot_authenticated"
  on handover_field_pilot_records for all to authenticated
  using (true) with check (true);

create or replace function set_handover_field_pilot_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_hfp_updated_at on handover_field_pilot_records;
create trigger trg_hfp_updated_at
before update on handover_field_pilot_records
for each row execute function set_handover_field_pilot_updated_at();

create table if not exists handover_field_pilot_audit (
  audit_id uuid primary key default gen_random_uuid(),
  record_id uuid not null references handover_field_pilot_records(record_id) on delete cascade,
  action text not null,
  actor_id uuid references users(user_id),
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_hfp_audit_record on handover_field_pilot_audit(record_id, created_at desc);
alter table handover_field_pilot_audit enable row level security;
drop policy if exists "handover_field_pilot_audit_authenticated" on handover_field_pilot_audit;
create policy "handover_field_pilot_audit_authenticated"
  on handover_field_pilot_audit for all to authenticated
  using (true) with check (true);
