begin;

-- 業管組交接簿多階主管批核紀錄（一市場主任、營業部副理、營業部經理）
create table if not exists public.business_handover_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  handover_date date not null,
  stage text not null,
  stage_label text not null,
  approver_id uuid not null references public.users(user_id),
  approved_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_business_handover_approval_stage unique (handover_date, stage)
);

alter table public.business_handover_approvals
  add column if not exists approval_id uuid primary key default gen_random_uuid(),
  add column if not exists handover_date date not null,
  add column if not exists stage text not null,
  add column if not exists stage_label text not null,
  add column if not exists approver_id uuid not null references public.users(user_id),
  add column if not exists approved_at timestamptz not null default now(),
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_handover_stage_check' and conrelid='public.business_handover_approvals'::regclass) then
    alter table public.business_handover_approvals add constraint business_handover_stage_check
      check(stage in ('director', 'deputy_manager', 'manager'));
  end if;
end $$;

create index if not exists idx_business_handover_approvals_date
  on public.business_handover_approvals(handover_date desc, stage);

alter table public.business_handover_approvals enable row level security;
alter table public.business_handover_approvals force row level security;
revoke all on public.business_handover_approvals from anon;
grant select, insert, update on public.business_handover_approvals to authenticated;

drop policy if exists business_handover_approvals_read on public.business_handover_approvals;
drop policy if exists business_handover_approvals_insert on public.business_handover_approvals;
drop policy if exists business_handover_approvals_update on public.business_handover_approvals;

create policy business_handover_approvals_read on public.business_handover_approvals
  for select to authenticated using(public.has_handover_module_access('business'));

create policy business_handover_approvals_insert on public.business_handover_approvals
  for insert to authenticated with check(
    public.has_handover_module_access('business') and approver_id = public.active_user_id()
  );

create policy business_handover_approvals_update on public.business_handover_approvals
  for update to authenticated using(
    public.has_handover_module_access('business')
  ) with check(
    public.has_handover_module_access('business') and approver_id = public.active_user_id()
  );

comment on table public.business_handover_approvals is '業管組交接簿多階批核紀錄（一市場主任、營業部副理、營業部經理）';

commit;
