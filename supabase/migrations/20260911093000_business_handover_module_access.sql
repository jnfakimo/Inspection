begin;

-- 電子交接簿採「角色開大系統、逐人開子系統」兩層授權。
create table if not exists public.user_handover_module_access (
  user_id uuid not null references public.users(user_id),
  module_key text not null,
  allowed boolean not null default true,
  granted_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,module_key)
);
alter table public.user_handover_module_access
  add column if not exists user_id uuid references public.users(user_id),
  add column if not exists module_key text,
  add column if not exists allowed boolean not null default true,
  add column if not exists granted_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
do $$ begin
  if not exists(select 1 from pg_constraint where conname='user_handover_module_key_check' and conrelid='public.user_handover_module_access'::regclass) then
    alter table public.user_handover_module_access add constraint user_handover_module_key_check
      check(module_key in ('records','mechanical','business','open-items','equipment','mechanical-schedule'));
  end if;
end $$;
create index if not exists idx_user_handover_module_allowed on public.user_handover_module_access(user_id,module_key) where allowed;

alter table public.user_handover_module_access enable row level security;
alter table public.user_handover_module_access force row level security;
revoke all on public.user_handover_module_access from anon;
revoke insert,update,delete on public.user_handover_module_access from authenticated;
grant select on public.user_handover_module_access to authenticated;
drop policy if exists user_handover_module_access_admin_read on public.user_handover_module_access;
create policy user_handover_module_access_admin_read on public.user_handover_module_access
  for select to authenticated using(public.active_rbac_role()='sysadmin');

create or replace function public.has_handover_module_access(p_module_key text)
returns boolean language sql stable security definer set search_path=''
as $$
  select public.active_rbac_role()='sysadmin' or (
    public.has_system_access('sys_handover') and exists(
      select 1 from public.user_handover_module_access a
      where a.user_id=public.active_user_id() and a.module_key=p_module_key and a.allowed
    )
  )
$$;
revoke all on function public.has_handover_module_access(text) from public,anon;
grant execute on function public.has_handover_module_access(text) to authenticated;

-- 不依角色或單位自動全開任何子系統。系統管理員本身由函式直接放行；其餘啟用帳號
-- 必須先具有角色的 sys_handover，再由權限頁逐人勾選需要的子系統。

-- 業管組交接表：僅保留交接分類、說明與出勤摘要；刪除採軟刪除並保留時間。
create table if not exists public.business_handover_entries (
  entry_id uuid primary key default gen_random_uuid(),
  handover_date date not null,
  shift_code text not null,
  category text not null,
  description text not null,
  expected_attendance integer not null default 0,
  absent_attendance integer not null default 0,
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_by uuid references public.users(user_id),
  deleted_at timestamptz
);
alter table public.business_handover_entries
  add column if not exists handover_date date,
  add column if not exists shift_code text,
  add column if not exists category text,
  add column if not exists description text,
  add column if not exists expected_attendance integer not null default 0,
  add column if not exists absent_attendance integer not null default 0,
  add column if not exists created_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(user_id),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_by uuid references public.users(user_id),
  add column if not exists deleted_at timestamptz;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='business_handover_shift_check' and conrelid='public.business_handover_entries'::regclass) then
    alter table public.business_handover_entries add constraint business_handover_shift_check check(shift_code in ('01-09','09-17','17-01'));
  end if;
  if not exists(select 1 from pg_constraint where conname='business_handover_category_check' and conrelid='public.business_handover_entries'::regclass) then
    alter table public.business_handover_entries add constraint business_handover_category_check check(category in ('事務事項','維修','其他'));
  end if;
  if not exists(select 1 from pg_constraint where conname='business_handover_attendance_check' and conrelid='public.business_handover_entries'::regclass) then
    alter table public.business_handover_entries add constraint business_handover_attendance_check check(expected_attendance between 0 and 50 and absent_attendance between 0 and expected_attendance);
  end if;
  if not exists(select 1 from pg_constraint where conname='business_handover_delete_metadata_check' and conrelid='public.business_handover_entries'::regclass) then
    alter table public.business_handover_entries add constraint business_handover_delete_metadata_check check((not is_deleted and deleted_by is null and deleted_at is null) or (is_deleted and deleted_by is not null and deleted_at is not null));
  end if;
end $$;
create index if not exists idx_business_handover_date_shift on public.business_handover_entries(handover_date desc,shift_code,created_at);

create or replace function public.guard_business_handover_entry()
returns trigger language plpgsql security definer set search_path=''
as $$
declare actor uuid:=public.active_user_id();
begin
  if actor is null then raise exception using errcode='42501',message='active business handover actor is required'; end if;
  if tg_op='UPDATE' then
    if new.entry_id is distinct from old.entry_id or new.handover_date is distinct from old.handover_date or new.shift_code is distinct from old.shift_code or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception using errcode='23514',message='business handover identity fields are immutable';
    end if;
    if old.is_deleted then raise exception using errcode='23514',message='deleted business handover entry is immutable'; end if;
    new.updated_by:=actor; new.updated_at:=now();
    if new.is_deleted then new.deleted_by:=actor; new.deleted_at:=coalesce(new.deleted_at,now()); else new.deleted_by:=null; new.deleted_at:=null; end if;
  else
    new.created_by:=actor; new.updated_by:=actor; new.is_deleted:=false; new.deleted_by:=null; new.deleted_at:=null;
  end if;
  return new;
end
$$;
revoke all on function public.guard_business_handover_entry() from public,anon,authenticated;
drop trigger if exists trg_guard_business_handover_entry on public.business_handover_entries;
create trigger trg_guard_business_handover_entry before insert or update on public.business_handover_entries for each row execute function public.guard_business_handover_entry();

alter table public.business_handover_entries enable row level security;
alter table public.business_handover_entries force row level security;
revoke all on public.business_handover_entries from anon;
grant select,insert,update on public.business_handover_entries to authenticated;
drop policy if exists business_handover_entries_read on public.business_handover_entries;
drop policy if exists business_handover_entries_insert on public.business_handover_entries;
drop policy if exists business_handover_entries_update on public.business_handover_entries;
create policy business_handover_entries_read on public.business_handover_entries for select to authenticated using(public.has_handover_module_access('business'));
create policy business_handover_entries_insert on public.business_handover_entries for insert to authenticated with check(public.has_handover_module_access('business') and created_by=public.active_user_id());
create policy business_handover_entries_update on public.business_handover_entries for update to authenticated using(public.has_handover_module_access('business')) with check(public.has_handover_module_access('business') and updated_by=public.active_user_id());

-- 現有交接資料改由子系統權限保護；大系統權限仍是必要的第一層。
drop policy if exists mechanical_handover_entries_read on public.mechanical_handover_entries;
drop policy if exists mechanical_handover_entries_write on public.mechanical_handover_entries;
drop policy if exists mechanical_handover_entries_update on public.mechanical_handover_entries;
create policy mechanical_handover_entries_read on public.mechanical_handover_entries for select to authenticated using(public.has_handover_module_access('mechanical'));
create policy mechanical_handover_entries_write on public.mechanical_handover_entries for insert to authenticated with check(public.has_handover_module_access('mechanical') and created_by=public.active_user_id());
create policy mechanical_handover_entries_update on public.mechanical_handover_entries for update to authenticated using(public.has_handover_module_access('mechanical')) with check(public.has_handover_module_access('mechanical') and updated_by=public.active_user_id());

drop policy if exists mechanical_handover_signatures_read on public.mechanical_handover_signatures;
drop policy if exists mechanical_handover_signatures_write on public.mechanical_handover_signatures;
drop policy if exists mechanical_handover_signatures_update on public.mechanical_handover_signatures;
create policy mechanical_handover_signatures_read on public.mechanical_handover_signatures for select to authenticated using(public.has_handover_module_access('mechanical'));
create policy mechanical_handover_signatures_write on public.mechanical_handover_signatures for insert to authenticated with check(public.has_handover_module_access('mechanical') and updated_by=public.active_user_id());
create policy mechanical_handover_signatures_update on public.mechanical_handover_signatures for update to authenticated using(public.has_handover_module_access('mechanical')) with check(public.has_handover_module_access('mechanical') and updated_by=public.active_user_id());

drop policy if exists mechanical_handover_daily_approvals_read on public.mechanical_handover_daily_approvals;
drop policy if exists mechanical_handover_daily_approvals_write on public.mechanical_handover_daily_approvals;
create policy mechanical_handover_daily_approvals_read on public.mechanical_handover_daily_approvals for select to authenticated using(public.has_handover_module_access('mechanical'));
create policy mechanical_handover_daily_approvals_write on public.mechanical_handover_daily_approvals for insert to authenticated with check(public.has_handover_module_access('mechanical') and approver_id=public.active_user_id() and public.can_approve_mechanical_handover() and work_date<(now() at time zone 'Asia/Taipei')::date);

drop policy if exists mechanical_schedule_read on public.mechanical_schedule_assignments;
create policy mechanical_schedule_read on public.mechanical_schedule_assignments for select to authenticated using(public.has_handover_module_access('mechanical-schedule') or public.has_handover_module_access('mechanical'));
drop policy if exists mechanical_staff_market_read on public.mechanical_staff_market_scopes;
create policy mechanical_staff_market_read on public.mechanical_staff_market_scopes for select to authenticated using(public.has_handover_module_access('mechanical-schedule') or public.has_handover_module_access('mechanical'));

drop policy if exists handover_records_system_read on public.handover_records;
drop policy if exists handover_records_own_insert on public.handover_records;
drop policy if exists handover_records_party_update on public.handover_records;
create policy handover_records_system_read on public.handover_records for select to authenticated using(public.has_handover_module_access('records'));
create policy handover_records_own_insert on public.handover_records for insert to authenticated with check(public.has_handover_module_access('records') and created_by=public.active_user_id());
create policy handover_records_party_update on public.handover_records for update to authenticated using(public.has_handover_module_access('records') and (public.is_admin() or created_by=public.active_user_id() or handover_by=public.active_user_id() or takeover_by=public.active_user_id())) with check(public.has_handover_module_access('records') and (public.is_admin() or created_by=public.active_user_id() or handover_by=public.active_user_id() or takeover_by=public.active_user_id()));

drop policy if exists handover_cases_system_read on public.handover_cases;
drop policy if exists handover_cases_own_insert on public.handover_cases;
drop policy if exists handover_cases_party_update on public.handover_cases;
create policy handover_cases_system_read on public.handover_cases for select to authenticated using(public.has_handover_module_access('open-items'));
create policy handover_cases_own_insert on public.handover_cases for insert to authenticated with check(public.has_handover_module_access('open-items') and created_by=public.active_user_id());
create policy handover_cases_party_update on public.handover_cases for update to authenticated using(public.has_handover_module_access('open-items') and (public.is_admin() or created_by=public.active_user_id() or assigned_to=public.active_user_id())) with check(public.has_handover_module_access('open-items') and (public.is_admin() or created_by=public.active_user_id() or assigned_to=public.active_user_id()));
drop policy if exists handover_logs_system_read on public.handover_case_logs;
drop policy if exists handover_logs_own_insert on public.handover_case_logs;
create policy handover_logs_system_read on public.handover_case_logs for select to authenticated using(public.has_handover_module_access('open-items'));
create policy handover_logs_own_insert on public.handover_case_logs for insert to authenticated with check(public.has_handover_module_access('open-items') and created_by=public.active_user_id());
drop policy if exists handover_attachments_system_read on public.handover_case_attachments;
drop policy if exists handover_attachments_own_insert on public.handover_case_attachments;
create policy handover_attachments_system_read on public.handover_case_attachments for select to authenticated using(public.has_handover_module_access('open-items'));
create policy handover_attachments_own_insert on public.handover_case_attachments for insert to authenticated with check(public.has_handover_module_access('open-items') and uploaded_by=public.active_user_id());

drop policy if exists handoverfiles_authenticated_select on storage.objects;
drop policy if exists handoverfiles_authenticated_insert on storage.objects;
create policy handoverfiles_authenticated_select on storage.objects for select to authenticated
  using(bucket_id='handover-attachments' and public.has_handover_module_access('open-items') and public.storage_object_is_indexed(bucket_id,name));
create policy handoverfiles_authenticated_insert on storage.objects for insert to authenticated
  with check(bucket_id='handover-attachments' and public.has_handover_module_access('open-items') and (storage.foldername(name))[1] is not null);

comment on table public.user_handover_module_access is '電子交接簿逐人子系統授權；必須同時具備角色的 sys_handover 大系統權限';
comment on table public.business_handover_entries is '業管組三班交接事項與出勤摘要，刪除採可稽核的軟刪除';

commit;
