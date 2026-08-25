-- 帳號申請與組織簽核階層。
--
-- RBAC 角色只描述「可以做什麼」；users.supervisor_id 描述「由誰核可」。兩者刻意
-- 分開，避免把 unit_supervisor 當成所有人的共同上層，或只靠 department 文字相同
-- 就讓同單位的每一位主管都能核可派車。

begin;

alter table public.users
  add column if not exists supervisor_id uuid references public.users(user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_supervisor_not_self'
  ) then
    alter table public.users
      add constraint users_supervisor_not_self
      check (supervisor_id is null or supervisor_id <> user_id);
  end if;
end $$;

create index if not exists idx_users_supervisor_active
  on public.users(supervisor_id, status);

-- 現有資料只在同一單位恰好有一位啟用中的單位主管時安全回填；有多位主管的單位
-- 保留空白，交由系統管理員逐一指定，避免猜錯簽核線。
with supervisor_candidates as (
  select member.user_id,
         (array_agg(supervisor.user_id order by supervisor.user_id))[1] as supervisor_id,
         count(*) as candidate_count
  from public.users member
  join public.users supervisor
    on supervisor.status = 'active'
   and coalesce(supervisor.rbac_role,
       case supervisor.role
         when 'admin' then 'sysadmin'
         when 'supervisor' then 'unit_supervisor'
         else supervisor.role
       end) = 'unit_supervisor'
   and supervisor.user_id <> member.user_id
   and (
     (member.dept_id is not null and supervisor.dept_id = member.dept_id)
     or (member.dept_id is null and nullif(btrim(member.department), '') is not null
         and btrim(supervisor.department) = btrim(member.department))
   )
  where member.supervisor_id is null
    and member.status = 'active'
    and coalesce(member.rbac_role,
        case member.role
          when 'admin' then 'sysadmin'
          when 'supervisor' then 'unit_supervisor'
          when 'maintenance' then 'technician'
          when 'inspector' then 'reporter'
          else member.role
        end, 'reporter') not in ('unit_supervisor', 'sysadmin')
  group by member.user_id
)
update public.users member
set supervisor_id = candidate.supervisor_id
from supervisor_candidates candidate
where member.user_id = candidate.user_id
  and candidate.candidate_count = 1;

create table if not exists public.account_applications (
  application_id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null,
  email text not null,
  phone text,
  dept_id uuid not null references public.departments(dept_id),
  reason text,
  status text not null default 'pending',
  source_ip text,
  user_agent text,
  decided_by uuid references public.users(user_id),
  decided_at timestamptz,
  decision_note text,
  approved_user_id uuid references public.users(user_id),
  approved_role text references public.roles(role_id),
  approved_supervisor_id uuid references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_applications_status_check
    check (status in ('pending', 'approved', 'rejected'))
);

alter table public.account_applications add column if not exists name text;
alter table public.account_applications add column if not exists username text;
alter table public.account_applications add column if not exists email text;
alter table public.account_applications add column if not exists phone text;
alter table public.account_applications add column if not exists dept_id uuid references public.departments(dept_id);
alter table public.account_applications add column if not exists reason text;
alter table public.account_applications add column if not exists status text default 'pending';
alter table public.account_applications add column if not exists source_ip text;
alter table public.account_applications add column if not exists user_agent text;
alter table public.account_applications add column if not exists decided_by uuid references public.users(user_id);
alter table public.account_applications add column if not exists decided_at timestamptz;
alter table public.account_applications add column if not exists decision_note text;
alter table public.account_applications add column if not exists approved_user_id uuid references public.users(user_id);
alter table public.account_applications add column if not exists approved_role text references public.roles(role_id);
alter table public.account_applications add column if not exists approved_supervisor_id uuid references public.users(user_id);
alter table public.account_applications add column if not exists created_at timestamptz default now();
alter table public.account_applications add column if not exists updated_at timestamptz default now();

create unique index if not exists uq_account_applications_pending_username
  on public.account_applications(lower(username)) where status = 'pending';
create unique index if not exists uq_account_applications_pending_email
  on public.account_applications(lower(email)) where status = 'pending';
create index if not exists idx_account_applications_status_created
  on public.account_applications(status, created_at desc);

alter table public.account_applications enable row level security;
alter table public.account_applications force row level security;
-- 公開申請與管理員查閱皆經 Edge Function；不對 anon/authenticated 直接開表。

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.account_applications;
    create trigger trg_prevent_removal
      before delete or truncate on public.account_applications
      for each statement execute function public.reject_physical_data_removal();
  end if;
end $$;

-- 主管可以讀到自己直屬人員的派車申請；尚未完成回填的舊帳號才暫時沿用「同單位
-- 唯一主管」的相容判斷。派車管理員仍只處理主管核可後的 approved 案件。
drop policy if exists vehicle_requests_scoped_read on public.vehicle_dispatch_requests;
create policy vehicle_requests_scoped_read on public.vehicle_dispatch_requests
for select to authenticated using (
  applicant_id = public.active_user_id()
  or driver_id = public.active_user_id()
  or public.is_admin()
  or exists (
    select 1 from public.vehicle_dispatch_managers manager
    where manager.user_id = public.active_user_id() and manager.active
  )
  or exists (
    select 1 from public.users applicant
    where applicant.user_id = vehicle_dispatch_requests.applicant_id
      and (
        applicant.supervisor_id = public.active_user_id()
        or (
          applicant.supervisor_id is null
          and public.active_rbac_role() = 'unit_supervisor'
          and (
            (applicant.dept_id is not null and applicant.dept_id = (
              select actor.dept_id from public.users actor
              where actor.user_id = public.active_user_id()
            ))
            or (applicant.dept_id is null and btrim(applicant.department) = btrim((
              select actor.department from public.users actor
              where actor.user_id = public.active_user_id()
            )))
          )
        )
      )
  )
);

create or replace function public.guard_vehicle_dispatch_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid;
  actor_role text;
  applicant_supervisor uuid;
  applicant_dept uuid;
  actor_dept uuid;
  applicant_department text;
  actor_department text;
begin
  if old.status = 'pending_approval' and new.status in ('approved', 'returned') then
    if auth.uid() is null then return new; end if;

    select u.user_id,
      coalesce(u.rbac_role, case u.role
        when 'admin' then 'sysadmin'
        when 'supervisor' then 'unit_supervisor'
        when 'maintenance' then 'technician'
        when 'inspector' then 'reporter'
        else u.role end, 'reporter'),
      u.dept_id, u.department
    into actor_id, actor_role, actor_dept, actor_department
    from public.users u
    where u.auth_id = auth.uid() and u.status = 'active'
    limit 1;

    select u.supervisor_id, u.dept_id, u.department
    into applicant_supervisor, applicant_dept, applicant_department
    from public.users u
    where u.user_id = old.applicant_id and u.status = 'active';

    if actor_id is null then
      raise exception using errcode = '42501', message = '找不到有效的核可人員帳號';
    end if;
    if actor_role not in ('unit_supervisor', 'sysadmin') then
      raise exception using errcode = '42501', message = '目前帳號沒有單位主管核可權限';
    end if;
    if actor_role <> 'sysadmin' and actor_id = old.applicant_id then
      raise exception using errcode = '42501', message = '申請人不得核准或退回自己的派車申請';
    end if;
    if actor_role <> 'sysadmin' and applicant_supervisor is not null
       and applicant_supervisor <> actor_id then
      raise exception using errcode = '42501', message = '僅限申請人的直屬課室主管核可';
    end if;
    if actor_role <> 'sysadmin' and applicant_supervisor is null
       and not (
         (applicant_dept is not null and applicant_dept = actor_dept)
         or (applicant_dept is null and nullif(btrim(applicant_department), '') is not null
             and btrim(applicant_department) = btrim(actor_department))
       ) then
      raise exception using errcode = '42501', message = '此帳號尚未設定直屬主管，請洽系統管理員';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_approval on public.vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_approval
  before update on public.vehicle_dispatch_requests
  for each row execute function public.guard_vehicle_dispatch_approval();

-- 20260816190000 的 security-definer RPC 在觸發主管 guard 之前，先用舊 RLS 等價
-- 條件擋掉所有主管。補上「僅 approve/return 可由直屬主管進入」；取消、派車、
-- 司機接單仍維持各自原有身分，不能因為是主管就一併取得。
create or replace function public.vehicle_request_action(
  p_request_id uuid,
  p_action text,
  p_note text default null,
  p_vehicle_id uuid default null,
  p_driver_id uuid default null
)
returns public.vehicle_dispatch_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_req public.vehicle_dispatch_requests;
  v_from text;
  v_to text;
  v_log_action text;
  v_log_note text;
  v_plate text;
  v_driver text;
  v_now timestamptz := now();
begin
  select u.user_id, coalesce(nullif(btrim(coalesce(u.name, '')), ''), u.username)
  into v_actor, v_actor_name
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor is null then
    raise exception using errcode = '42501', message = '找不到有效的派車系統人員帳號';
  end if;
  if not public.has_system_access('sys_vehicle') then
    raise exception using errcode = '42501', message = '目前角色沒有公務車派車系統權限';
  end if;

  select * into v_req
  from public.vehicle_dispatch_requests
  where request_id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '02000', message = '找不到這筆派車申請';
  end if;

  if not (
    v_req.applicant_id = v_actor
    or v_req.driver_id = v_actor
    or public.is_admin()
    or exists (
      select 1 from public.vehicle_dispatch_managers manager
      where manager.user_id = v_actor and manager.active
    )
    or (
      p_action in ('approve', 'return')
      and exists (
        select 1
        from public.users applicant
        join public.users actor on actor.user_id = v_actor and actor.status = 'active'
        where applicant.user_id = v_req.applicant_id
          and (
            applicant.supervisor_id = v_actor
            or (
              applicant.supervisor_id is null
              and coalesce(actor.rbac_role, case actor.role when 'supervisor' then 'unit_supervisor' else actor.role end) = 'unit_supervisor'
              and (
                (applicant.dept_id is not null and applicant.dept_id = actor.dept_id)
                or (applicant.dept_id is null and nullif(btrim(applicant.department), '') is not null
                    and btrim(applicant.department) = btrim(actor.department))
              )
            )
          )
      )
    )
  ) then
    raise exception using errcode = '42501', message = '沒有異動這筆派車申請的權限';
  end if;

  v_from := v_req.status;
  if p_action in ('approve', 'return') then
    if v_req.status <> 'pending_approval' then
      raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
    end if;
    if p_action = 'return' and coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception using errcode = '23514', message = '退回時請填寫原因';
    end if;
    v_to := case p_action when 'approve' then 'approved' else 'returned' end;
    update public.vehicle_dispatch_requests set
      status = v_to,
      supervisor_id = v_actor,
      supervisor_name = v_actor_name,
      supervisor_note = nullif(btrim(coalesce(p_note, '')), ''),
      approved_at = case when p_action = 'approve' then v_now else null end
    where request_id = p_request_id
    returning * into v_req;
    v_log_action := case p_action when 'approve' then '單位主管核可' else '單位主管退回' end;
    v_log_note := nullif(btrim(coalesce(p_note, '')), '');

  elsif p_action = 'dispatch' then
    if v_req.status <> 'approved' then
      raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
    end if;
    if p_vehicle_id is null or p_driver_id is null then
      raise exception using errcode = '23514', message = '請選擇公務車及司機';
    end if;
    select plate_no into v_plate from public.official_vehicles where vehicle_id = p_vehicle_id;
    if v_plate is null then raise exception using errcode = '02000', message = '找不到指定的公務車'; end if;
    select coalesce(nullif(btrim(coalesce(name, '')), ''), username) into v_driver
    from public.users where user_id = p_driver_id;
    if v_driver is null then raise exception using errcode = '02000', message = '找不到指定的司機'; end if;
    v_to := 'assigned';
    update public.vehicle_dispatch_requests set
      status = 'assigned', vehicle_manager_id = v_actor, vehicle_manager_name = v_actor_name,
      vehicle_id = p_vehicle_id, plate_no = v_plate, driver_id = p_driver_id,
      driver_name = v_driver, dispatch_note = nullif(btrim(coalesce(p_note, '')), ''),
      dispatched_at = v_now, driver_accepted_at = null, driver_accepted_by = null
    where request_id = p_request_id
    returning * into v_req;
    v_log_action := '派車管理員完成派車';
    v_log_note := format('%s｜司機 %s%s', v_plate, v_driver,
      case when nullif(btrim(coalesce(p_note, '')), '') is null then '' else '｜' || btrim(p_note) end);

  elsif p_action = 'accept' then
    if v_req.status <> 'assigned' then
      raise exception using errcode = '22023', message = '此派車單已被處理，請重新整理';
    end if;
    if v_req.driver_accepted_at is not null then
      raise exception using errcode = '22023', message = '此派車單已接單，請重新整理';
    end if;
    v_from := 'assigned'; v_to := 'assigned';
    update public.vehicle_dispatch_requests set driver_accepted_at = v_now, driver_accepted_by = v_actor
    where request_id = p_request_id returning * into v_req;
    v_log_action := '司機接單';
    v_log_note := format('%s｜%s → %s', coalesce(v_req.plate_no, '公務車'),
      coalesce(v_req.origin_location, ''), coalesce(v_req.destination_location, ''));

  elsif p_action = 'cancel' then
    if v_req.status in ('completed', 'cancelled') then
      raise exception using errcode = '22023', message = '已完成或已取消的派車單無法取消';
    end if;
    if coalesce(btrim(coalesce(p_note, '')), '') = '' then
      raise exception using errcode = '23514', message = '請填寫取消原因';
    end if;
    v_to := 'cancelled';
    update public.vehicle_dispatch_requests
    set status = 'cancelled', cancel_reason = btrim(p_note), cancelled_at = v_now
    where request_id = p_request_id returning * into v_req;
    v_log_action := '取消派車申請';
    v_log_note := btrim(p_note);
  else
    raise exception using errcode = '22023', message = '不支援的派車流程動作';
  end if;

  insert into public.vehicle_dispatch_logs
    (request_id, from_status, to_status, action, note, operator_id, operator_name)
  values (p_request_id, v_from, v_to, v_log_action, v_log_note, v_actor, v_actor_name);
  return v_req;
end;
$$;

revoke all on function public.vehicle_request_action(uuid, text, text, uuid, uuid) from public, anon;
grant execute on function public.vehicle_request_action(uuid, text, text, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
