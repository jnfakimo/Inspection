begin;

-- 機電交接工作採軟刪除，保留建立、最後修改與刪除的人員／時間。
alter table public.mechanical_handover_entries
  add column if not exists updated_by uuid references public.users(user_id),
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mechanical_handover_delete_metadata_check'
      and conrelid = 'public.mechanical_handover_entries'::regclass
  ) then
    alter table public.mechanical_handover_entries
      add constraint mechanical_handover_delete_metadata_check check (
        (not is_deleted and deleted_at is null and deleted_by is null)
        or (is_deleted and deleted_at is not null and deleted_by is not null)
      );
  end if;
end
$$;

create index if not exists idx_mechanical_handover_date_deleted
  on public.mechanical_handover_entries(work_date desc,is_deleted,shift_code,sort_order);

-- 已刪除的續辦紀錄不應占住來源，後續班別可重新接續。
drop index if exists public.uq_mechanical_handover_carry_source;
create unique index uq_mechanical_handover_carry_source
  on public.mechanical_handover_entries(carry_source_id)
  where carry_source_id is not null and not is_deleted;

grant select,insert,update on public.mechanical_handover_entries to authenticated;
drop policy if exists mechanical_handover_entries_update on public.mechanical_handover_entries;
create policy mechanical_handover_entries_update on public.mechanical_handover_entries
  for update to authenticated
  using (public.has_system_access('sys_handover'))
  with check (
    public.has_system_access('sys_handover')
    and updated_by=public.active_user_id()
  );

create or replace function public.guard_mechanical_handover_entry()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  source_row public.mechanical_handover_entries%rowtype;
  source_slot bigint;
  target_slot bigint;
  actor_id uuid := public.active_user_id();
begin
  if tg_op='UPDATE' then
    if actor_id is null then
      raise exception using errcode='42501',message='active mechanical handover actor is required';
    end if;
    if new.entry_id is distinct from old.entry_id
      or new.work_date is distinct from old.work_date
      or new.shift_code is distinct from old.shift_code
      or new.carry_source_id is distinct from old.carry_source_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception using errcode='23514',message='mechanical handover identity fields are immutable';
    end if;
    if old.is_deleted then
      raise exception using errcode='23514',message='deleted mechanical handover entry is immutable';
    end if;
    if exists(select 1 from public.mechanical_handover_daily_approvals a where a.work_date=old.work_date) then
      raise exception using errcode='23514',message='approved mechanical handover day is locked';
    end if;

    new.updated_by := actor_id;
    new.updated_at := now();
    if new.is_deleted then
      new.deleted_by := actor_id;
      new.deleted_at := coalesce(new.deleted_at,now());
    else
      new.deleted_by := null;
      new.deleted_at := null;
    end if;
  else
    if exists(select 1 from public.mechanical_handover_daily_approvals a where a.work_date=new.work_date) then
      raise exception using errcode='23514',message='approved mechanical handover day is locked';
    end if;
    new.is_deleted := false;
    new.deleted_by := null;
    new.deleted_at := null;
    new.updated_by := coalesce(new.updated_by,new.created_by);
    new.updated_at := coalesce(new.updated_at,now());

    if new.carry_source_id is not null then
      select * into source_row from public.mechanical_handover_entries
        where entry_id=new.carry_source_id and not is_deleted for update;
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
  end if;
  return new;
end
$$;
revoke all on function public.guard_mechanical_handover_entry() from public,anon,authenticated;
drop trigger if exists trg_guard_mechanical_handover_entry on public.mechanical_handover_entries;
create trigger trg_guard_mechanical_handover_entry
before insert or update on public.mechanical_handover_entries
for each row execute function public.guard_mechanical_handover_entry();

comment on column public.mechanical_handover_entries.is_deleted is
  '軟刪除標記；資料仍保留並以刪除線顯示';
comment on column public.mechanical_handover_entries.updated_by is
  '最後修改人，完整每次異動另記於 audit_logs';

commit;
