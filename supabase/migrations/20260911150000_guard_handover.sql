begin;

-- 駐衛警電子交接簿（SYS-04 子系統 guard）。
--
-- 1. 班別、班別時段、預定巡檢時段與排定人員一律以「駐衛警巡檢系統／巡檢排班」為唯一來源，
--    由 app-api 在伺服器端解析後快照寫入。交接簿不能改排班，只能另記實際值勤人員與代班說明。
-- 2. 流程：draft（交接中）→ submitted（交班人簽名）→ received（接班人簽名，內容鎖定）；
--    主管每日簽核後，當日全部交接紀錄不可再異動。
-- 3. 寫入只開放 service_role（app-api），authenticated 僅能讀。排班快照若允許前端權杖直寫，
--    任何有交接權限的人都能偽造「排定人員」，排班就不再是唯一來源。業管組／機電課交接表
--    可由前端權杖寫入，是因為它們沒有必須由伺服器保證的快照欄位。
-- 4. 主管簽核權限是 user_handover_module_access 的 guard-approve，由權限頁逐人指派。
--    駐警隊目前沒有任何 unit_supervisor，不能照機電課寫死「某單位課長才能簽」。

alter table public.user_handover_module_access drop constraint if exists user_handover_module_key_check;
alter table public.user_handover_module_access add constraint user_handover_module_key_check
  check(module_key in ('records','mechanical','business','guard','guard-approve','open-items','equipment','mechanical-schedule'));

create table if not exists public.guard_handover_logs (
  log_id uuid primary key default gen_random_uuid(),
  duty_date date not null,
  shift_name text not null,
  shift_order integer not null default 0,
  shift_start time not null,
  shift_end time not null,
  patrol_start time not null,
  patrol_end time not null,
  scheduled_user_ids uuid[] not null default '{}',
  actual_user_ids uuid[] not null default '{}',
  substitute_note text not null default '',
  duty_summary text not null default '',
  important_notes text not null default '',
  incidents jsonb not null default '[]'::jsonb,
  items jsonb not null default '[]'::jsonb,
  patrol_snapshot jsonb,
  status text not null default 'draft',
  handover_by uuid references public.users(user_id),
  handover_at timestamptz,
  takeover_by uuid references public.users(user_id),
  takeover_at timestamptz,
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_guard_handover_logs_duty_shift on public.guard_handover_logs(duty_date,shift_name);
create index if not exists idx_guard_handover_logs_duty_date on public.guard_handover_logs(duty_date desc,shift_order);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='guard_handover_status_check' and conrelid='public.guard_handover_logs'::regclass) then
    alter table public.guard_handover_logs add constraint guard_handover_status_check check(status in ('draft','submitted','received'));
  end if;
  if not exists(select 1 from pg_constraint where conname='guard_handover_sign_metadata_check' and conrelid='public.guard_handover_logs'::regclass) then
    alter table public.guard_handover_logs add constraint guard_handover_sign_metadata_check check(
      (status='draft' and handover_by is null and handover_at is null and takeover_by is null and takeover_at is null)
      or (status='submitted' and handover_by is not null and handover_at is not null and takeover_by is null and takeover_at is null)
      or (status='received' and handover_by is not null and handover_at is not null and takeover_by is not null and takeover_at is not null and takeover_by<>handover_by)
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='guard_handover_payload_check' and conrelid='public.guard_handover_logs'::regclass) then
    alter table public.guard_handover_logs add constraint guard_handover_payload_check check(
      jsonb_typeof(incidents)='array' and jsonb_array_length(incidents)<=50
      and jsonb_typeof(items)='array' and jsonb_array_length(items)<=40
      and char_length(duty_summary)<=4000 and char_length(important_notes)<=4000 and char_length(substitute_note)<=500
      and cardinality(actual_user_ids)<=20 and cardinality(scheduled_user_ids)<=20
    );
  end if;
end $$;

create table if not exists public.guard_handover_daily_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  duty_date date not null,
  approver_id uuid not null references public.users(user_id),
  approved_at timestamptz not null default now(),
  note text not null default '',
  shift_count integer not null default 0,
  received_count integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_guard_handover_approval_date on public.guard_handover_daily_approvals(duty_date);

-- 狀態機由資料庫把關：app-api 算錯或被繞過時，這裡仍會拒絕不合法的轉換。
create or replace function public.protect_guard_handover_log()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  content_keys text[] := array['status','handover_by','handover_at','takeover_by','takeover_at','patrol_snapshot','updated_by','updated_at'];
begin
  if tg_op='INSERT' then
    if new.status<>'draft' then raise exception using errcode='23514',message='guard handover must start as draft'; end if;
    new.handover_by:=null; new.handover_at:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
    new.updated_by:=new.created_by; new.created_at:=now(); new.updated_at:=now();
    return new;
  end if;

  if new.log_id is distinct from old.log_id or new.duty_date is distinct from old.duty_date or new.shift_name is distinct from old.shift_name
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='guard handover identity fields are immutable';
  end if;
  if exists(select 1 from public.guard_handover_daily_approvals a where a.duty_date=old.duty_date) then
    raise exception using errcode='23514',message='guard handover day has been approved and is locked';
  end if;
  if old.status='received' then
    raise exception using errcode='23514',message='received guard handover is immutable';
  end if;
  -- 交班送出後，內容與排班快照一律鎖定，只能推進到接班或撤回。
  if old.status='submitted' and (to_jsonb(new)-content_keys) is distinct from (to_jsonb(old)-content_keys) then
    raise exception using errcode='23514',message='submitted guard handover content is locked';
  end if;

  if old.status='draft' and new.status='draft' then
    new.handover_by:=null; new.handover_at:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='draft' and new.status='submitted' then
    if new.handover_by is distinct from new.updated_by then
      raise exception using errcode='23514',message='handover signer must be the acting user';
    end if;
    new.handover_at:=now(); new.takeover_by:=null; new.takeover_at:=null;
  elsif old.status='submitted' and new.status='draft' then
    if new.updated_by is distinct from old.handover_by then
      raise exception using errcode='23514',message='only the handover signer can withdraw';
    end if;
    new.handover_by:=null; new.handover_at:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='submitted' and new.status='received' then
    if new.takeover_by is distinct from new.updated_by or new.takeover_by=old.handover_by then
      raise exception using errcode='23514',message='takeover signer must be the acting user and differ from the handover signer';
    end if;
    new.handover_by:=old.handover_by; new.handover_at:=old.handover_at; new.patrol_snapshot:=old.patrol_snapshot; new.takeover_at:=now();
  else
    raise exception using errcode='23514',message='invalid guard handover status transition';
  end if;
  new.updated_at:=now();
  return new;
end
$$;
revoke all on function public.protect_guard_handover_log() from public,anon,authenticated;
drop trigger if exists trg_protect_guard_handover_log on public.guard_handover_logs;
create trigger trg_protect_guard_handover_log before insert or update on public.guard_handover_logs
  for each row execute function public.protect_guard_handover_log();

create or replace function public.protect_guard_handover_approval()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    raise exception using errcode='23514',message='guard handover approval is immutable';
  end if;
  if new.duty_date>=(now() at time zone 'Asia/Taipei')::date then
    raise exception using errcode='23514',message='guard handover can only be approved from the next day';
  end if;
  if exists(select 1 from public.guard_handover_logs l where l.duty_date=new.duty_date and l.status<>'received') then
    raise exception using errcode='23514',message='all guard handovers of the day must be received before approval';
  end if;
  new.approved_at:=now(); new.created_at:=now();
  return new;
end
$$;
revoke all on function public.protect_guard_handover_approval() from public,anon,authenticated;
drop trigger if exists trg_protect_guard_handover_approval on public.guard_handover_daily_approvals;
create trigger trg_protect_guard_handover_approval before insert or update on public.guard_handover_daily_approvals
  for each row execute function public.protect_guard_handover_approval();

drop trigger if exists trg_prevent_removal on public.guard_handover_logs;
create trigger trg_prevent_removal before delete or truncate on public.guard_handover_logs
  for each statement execute function public.reject_physical_data_removal();
drop trigger if exists trg_prevent_removal on public.guard_handover_daily_approvals;
create trigger trg_prevent_removal before delete or truncate on public.guard_handover_daily_approvals
  for each statement execute function public.reject_physical_data_removal();

alter table public.guard_handover_logs enable row level security;
alter table public.guard_handover_logs force row level security;
revoke all on public.guard_handover_logs from anon,authenticated;
grant select on public.guard_handover_logs to authenticated;
grant select,insert,update on public.guard_handover_logs to service_role;
drop policy if exists guard_handover_logs_read on public.guard_handover_logs;
create policy guard_handover_logs_read on public.guard_handover_logs for select to authenticated
  using(public.has_handover_module_access('guard') or public.has_handover_module_access('guard-approve'));

alter table public.guard_handover_daily_approvals enable row level security;
alter table public.guard_handover_daily_approvals force row level security;
revoke all on public.guard_handover_daily_approvals from anon,authenticated;
grant select on public.guard_handover_daily_approvals to authenticated;
grant select,insert on public.guard_handover_daily_approvals to service_role;
drop policy if exists guard_handover_approvals_read on public.guard_handover_daily_approvals;
create policy guard_handover_approvals_read on public.guard_handover_daily_approvals for select to authenticated
  using(public.has_handover_module_access('guard') or public.has_handover_module_access('guard-approve'));

comment on table public.guard_handover_logs is '駐衛警交接簿：每值班日每班一筆；班別、時段與排定人員為巡檢排班快照，寫入只走 app-api';
comment on table public.guard_handover_daily_approvals is '駐衛警交接簿主管每日簽核；簽核後當日交接全部鎖定';

notify pgrst, 'reload schema';

commit;
