-- 機電交接簿：未完成工作以新紀錄接續（保留來源鏈），每日由課長簽核。
alter table public.mechanical_handover_entries
  add column if not exists carry_source_id uuid references public.mechanical_handover_entries(entry_id);
create unique index if not exists uq_mechanical_handover_carry_source
  on public.mechanical_handover_entries(carry_source_id) where carry_source_id is not null;
create index if not exists idx_mechanical_handover_open_lineage
  on public.mechanical_handover_entries(work_date desc, shift_code, result, carry_source_id);

create table if not exists public.mechanical_handover_daily_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  work_date date not null unique,
  approver_id uuid not null references public.users(user_id),
  approved_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);
alter table public.mechanical_handover_daily_approvals add column if not exists work_date date;
alter table public.mechanical_handover_daily_approvals add column if not exists approver_id uuid references public.users(user_id);
alter table public.mechanical_handover_daily_approvals add column if not exists approved_at timestamptz not null default now();
alter table public.mechanical_handover_daily_approvals add column if not exists note text;
alter table public.mechanical_handover_daily_approvals add column if not exists created_at timestamptz not null default now();
create unique index if not exists uq_mechanical_handover_daily_approval_date
  on public.mechanical_handover_daily_approvals(work_date);

create or replace function public.can_approve_mechanical_handover()
returns boolean language sql stable security definer set search_path=''
as $$
  select public.active_rbac_role()='sysadmin' or (
    public.active_rbac_role()='unit_supervisor' and exists(
      select 1 from public.users u
      join public.departments d on d.dept_id=u.dept_id
      where u.user_id=public.active_user_id() and u.status='active'
        and d.name='機電課' and d.level=2 and d.status='active'
    )
  )
$$;
revoke all on function public.can_approve_mechanical_handover() from public,anon;
grant execute on function public.can_approve_mechanical_handover() to authenticated;

create or replace function public.guard_mechanical_handover_entry()
returns trigger language plpgsql security definer set search_path=''
as $$
declare source_row public.mechanical_handover_entries%rowtype;
declare source_slot bigint;
declare target_slot bigint;
begin
  if exists(select 1 from public.mechanical_handover_daily_approvals a where a.work_date=new.work_date) then
    raise exception using errcode='23514',message='approved mechanical handover day is locked';
  end if;
  if new.carry_source_id is not null then
    select * into source_row from public.mechanical_handover_entries
      where entry_id=new.carry_source_id for update;
    if not found then
      raise exception using errcode='23503',message='mechanical carry source does not exist';
    end if;
    if source_row.result not in ('處理中','待料','待廠商','交下班續辦','無法處理') then
      raise exception using errcode='23514',message='completed mechanical work cannot be carried';
    end if;
    source_slot := (source_row.work_date-date '2000-01-01')::bigint*3
      + array_position(array['01-09','09-17','17-01'],source_row.shift_code)-1;
    target_slot := (new.work_date-date '2000-01-01')::bigint*3
      + array_position(array['01-09','09-17','17-01'],new.shift_code)-1;
    if target_slot <= source_slot then
      raise exception using errcode='23514',message='mechanical carry target must be a later shift';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.guard_mechanical_handover_entry() from public,anon,authenticated;
drop trigger if exists trg_guard_mechanical_handover_entry on public.mechanical_handover_entries;
create trigger trg_guard_mechanical_handover_entry before insert on public.mechanical_handover_entries
for each row execute function public.guard_mechanical_handover_entry();

create or replace function public.guard_mechanical_handover_signature()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from public.mechanical_handover_daily_approvals a where a.work_date=new.work_date) then
    raise exception using errcode='23514',message='approved mechanical handover day is locked';
  end if;
  return new;
end
$$;
revoke all on function public.guard_mechanical_handover_signature() from public,anon,authenticated;
drop trigger if exists trg_guard_mechanical_handover_signature on public.mechanical_handover_signatures;
create trigger trg_guard_mechanical_handover_signature before insert or update on public.mechanical_handover_signatures
for each row execute function public.guard_mechanical_handover_signature();

alter table public.mechanical_handover_daily_approvals enable row level security;
alter table public.mechanical_handover_daily_approvals force row level security;
revoke all on public.mechanical_handover_daily_approvals from anon;
grant select,insert on public.mechanical_handover_daily_approvals to authenticated;
drop policy if exists mechanical_handover_daily_approvals_read on public.mechanical_handover_daily_approvals;
drop policy if exists mechanical_handover_daily_approvals_write on public.mechanical_handover_daily_approvals;
create policy mechanical_handover_daily_approvals_read on public.mechanical_handover_daily_approvals
  for select to authenticated using (public.has_system_access('sys_handover'));
create policy mechanical_handover_daily_approvals_write on public.mechanical_handover_daily_approvals
  for insert to authenticated with check (
    public.has_system_access('sys_handover') and approver_id=public.active_user_id()
    and public.can_approve_mechanical_handover()
  );
