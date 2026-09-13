-- 公務車申請改為兩層核准：申請人送出 -> 課長 -> 部門經理 -> 派車。
-- 所有核准、退回與派車動作仍透過單一 security definer RPC，並寫入流程歷程。

alter table public.vehicle_dispatch_requests
  add column if not exists department_manager_id uuid references public.users(user_id),
  add column if not exists department_manager_name text,
  add column if not exists department_manager_note text,
  add column if not exists department_manager_approved_at timestamptz;

alter table public.vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_status_check;
alter table public.vehicle_dispatch_requests add constraint vehicle_dispatch_status_check
  check (status in ('draft','pending_approval','pending_manager_approval','returned','approved','assigned','completed','cancelled'));

alter table public.vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_no_time_overlap;
alter table public.vehicle_dispatch_requests add constraint vehicle_dispatch_no_time_overlap
  exclude using gist (
    vehicle_id with =,
    tsrange(trip_date + planned_departure_time, trip_date + planned_return_time, '[)') with &&
  ) where (status in ('pending_approval','pending_manager_approval','approved','assigned','completed'));

-- RLS 需讓課長看到直屬申請，也讓部門經理看到管轄單位的申請。
create or replace function public.can_review_vehicle_request(p_applicant_id uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_actor public.users;
  v_applicant public.users;
  v_role text;
begin
  select * into v_actor from public.users where auth_id=auth.uid() and status='active' limit 1;
  select * into v_applicant from public.users where user_id=p_applicant_id and status='active' limit 1;
  if v_actor.user_id is null or v_applicant.user_id is null then return false; end if;
  v_role := coalesce(v_actor.rbac_role,case v_actor.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else v_actor.role end);
  if v_role='sysadmin' then return true; end if;
  if v_role='unit_supervisor' then return v_applicant.supervisor_id=v_actor.user_id; end if;
  if v_role='mgmt_supervisor' then
    if v_applicant.dept_id is not null and v_actor.dept_id is not null then
      return coalesce(public.supervisor_unit_allows(v_applicant.dept_id,v_actor.dept_id),false);
    end if;
    return nullif(btrim(v_applicant.department),'') is not null
      and btrim(v_applicant.department)=btrim(v_actor.department);
  end if;
  return false;
end;
$$;

revoke all on function public.can_review_vehicle_request(uuid) from public,anon;
grant execute on function public.can_review_vehicle_request(uuid) to authenticated;

drop policy if exists vehicle_requests_scoped_read on public.vehicle_dispatch_requests;
create policy vehicle_requests_scoped_read on public.vehicle_dispatch_requests
for select to authenticated using (
  applicant_id=public.active_user_id()
  or driver_id=public.active_user_id()
  or public.is_admin()
  or exists(select 1 from public.vehicle_dispatch_managers manager where manager.user_id=public.active_user_id() and manager.active)
  or public.can_review_vehicle_request(applicant_id)
);

create or replace function public.guard_vehicle_dispatch_approval()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid;
  v_actor_role text;
  v_actor_dept uuid;
  v_actor_department text;
  v_applicant_supervisor uuid;
  v_applicant_dept uuid;
  v_applicant_department text;
begin
  if new.status is not distinct from old.status then return new; end if;

  select u.user_id,
    coalesce(u.rbac_role, case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end),
    u.dept_id,u.department
  into v_actor,v_actor_role,v_actor_dept,v_actor_department
  from public.users u
  where u.auth_id=auth.uid() and u.status='active'
  limit 1;

  if auth.uid() is null then return new; end if;
  if v_actor is null then
    raise exception using errcode='42501',message='找不到有效的核准人員帳號';
  end if;

  select applicant.supervisor_id,applicant.dept_id,applicant.department
  into v_applicant_supervisor,v_applicant_dept,v_applicant_department
  from public.users applicant where applicant.user_id=old.applicant_id;

  if old.status='pending_approval' and new.status in ('pending_manager_approval','returned') then
    if v_actor_role<>'sysadmin' and (v_actor_role<>'unit_supervisor' or v_applicant_supervisor is distinct from v_actor) then
      raise exception using errcode='42501',message='僅限申請人所屬課長核准或退回';
    end if;
    if v_actor_role<>'sysadmin' and v_actor=old.applicant_id then
      raise exception using errcode='42501',message='申請人不得核准或退回自己的派車申請';
    end if;
  elsif old.status='pending_manager_approval' and new.status in ('approved','returned') then
    if v_actor_role<>'sysadmin' and (
      v_actor_role<>'mgmt_supervisor'
      or not coalesce(case
        when v_applicant_dept is not null and v_actor_dept is not null
          then coalesce(public.supervisor_unit_allows(v_applicant_dept,v_actor_dept),false)
        else nullif(btrim(v_applicant_department),'') is not null
          and btrim(v_applicant_department)=btrim(v_actor_department)
      end,false)
    ) then
      raise exception using errcode='42501',message='僅限申請人所屬部門經理核准或退回';
    end if;
    if v_actor_role<>'sysadmin' and v_actor in (old.applicant_id,old.supervisor_id) then
      raise exception using errcode='42501',message='申請人、課長與部門經理必須由不同人員執行';
    end if;
  elsif new.status='approved' and old.status<>'approved' then
    raise exception using errcode='42501',message='未完成課長與部門經理核准，不得進入派車';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_approval on public.vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_approval
  before update of status on public.vehicle_dispatch_requests
  for each row execute function public.guard_vehicle_dispatch_approval();

-- 保留既有派車、接單、取消等已驗證流程；包裝核准動作成兩個階段。
do $$
begin
  if to_regprocedure('public.vehicle_request_action_legacy_two_level(uuid,text,text,uuid,uuid)') is null then
    alter function public.vehicle_request_action(uuid,text,text,uuid,uuid)
      rename to vehicle_request_action_legacy_two_level;
  end if;
end;
$$;

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
set search_path=public,pg_temp
as $$
declare
  v_actor uuid;
  v_actor_name text;
  v_actor_role text;
  v_actor_dept uuid;
  v_actor_department text;
  v_req public.vehicle_dispatch_requests;
  v_from text;
  v_applicant_supervisor uuid;
  v_applicant_dept uuid;
  v_applicant_department text;
  v_to text;
  v_log_action text;
  v_note text := nullif(btrim(coalesce(p_note,'')),'');
  v_now timestamptz := now();
begin
  if p_action not in ('approve','return') then
    return public.vehicle_request_action_legacy_two_level(p_request_id,p_action,p_note,p_vehicle_id,p_driver_id);
  end if;

  select u.user_id,coalesce(nullif(btrim(coalesce(u.name,'')),''),u.username),
    coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end),
    u.dept_id,u.department
  into v_actor,v_actor_name,v_actor_role,v_actor_dept,v_actor_department
  from public.users u
  where u.auth_id=auth.uid() and u.status='active'
  limit 1;

  if v_actor is null then raise exception using errcode='42501',message='找不到有效的核准人員帳號'; end if;
  if not public.has_system_access('sys_vehicle') then
    raise exception using errcode='42501',message='目前角色沒有公務車派車系統權限';
  end if;
  if p_action='return' and v_note is null then
    raise exception using errcode='23514',message='退回時請填寫原因';
  end if;

  select * into v_req from public.vehicle_dispatch_requests
  where request_id=p_request_id for update;
  if not found then raise exception using errcode='02000',message='找不到這筆派車申請'; end if;
  v_from := v_req.status;

  select applicant.supervisor_id,applicant.dept_id,applicant.department
  into v_applicant_supervisor,v_applicant_dept,v_applicant_department
  from public.users applicant where applicant.user_id=v_req.applicant_id;

  if v_req.status='pending_approval' then
    if v_actor_role<>'sysadmin' and (v_actor_role<>'unit_supervisor' or v_applicant_supervisor is distinct from v_actor) then
      raise exception using errcode='42501',message='僅限申請人所屬課長核准或退回';
    end if;
    if v_actor_role<>'sysadmin' and v_actor=v_req.applicant_id then
      raise exception using errcode='42501',message='申請人不得核准或退回自己的派車申請';
    end if;
    v_to := case when p_action='approve' then 'pending_manager_approval' else 'returned' end;
    update public.vehicle_dispatch_requests set
      status=v_to,supervisor_id=v_actor,supervisor_name=v_actor_name,supervisor_note=v_note,
      approved_at=case when p_action='approve' then v_now else null end
    where request_id=p_request_id returning * into v_req;
    v_log_action := case when p_action='approve' then '課長核准' else '課長退回' end;

  elsif v_req.status='pending_manager_approval' then
    if v_actor_role<>'sysadmin' and (
      v_actor_role<>'mgmt_supervisor'
      or not coalesce(case
        when v_applicant_dept is not null and v_actor_dept is not null
          then coalesce(public.supervisor_unit_allows(v_applicant_dept,v_actor_dept),false)
        else nullif(btrim(v_applicant_department),'') is not null
          and btrim(v_applicant_department)=btrim(v_actor_department)
      end,false)
    ) then
      raise exception using errcode='42501',message='僅限申請人所屬部門經理核准或退回';
    end if;
    if v_actor_role<>'sysadmin' and v_actor in (v_req.applicant_id,v_req.supervisor_id) then
      raise exception using errcode='42501',message='申請人、課長與部門經理必須由不同人員執行';
    end if;
    v_to := case when p_action='approve' then 'approved' else 'returned' end;
    update public.vehicle_dispatch_requests set
      status=v_to,department_manager_id=v_actor,department_manager_name=v_actor_name,
      department_manager_note=v_note,
      department_manager_approved_at=case when p_action='approve' then v_now else null end
    where request_id=p_request_id returning * into v_req;
    v_log_action := case when p_action='approve' then '部門經理核准' else '部門經理退回' end;
  else
    raise exception using errcode='22023',message='案件狀態已變更，請重新整理';
  end if;

  insert into public.vehicle_dispatch_logs
    (request_id,from_status,to_status,action,note,operator_id,operator_name)
  values (p_request_id,v_from,v_to,v_log_action,v_note,v_actor,v_actor_name);
  return v_req;
end;
$$;

revoke all on function public.vehicle_request_action_legacy_two_level(uuid,text,text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.vehicle_request_action(uuid,text,text,uuid,uuid) from public,anon;
grant execute on function public.vehicle_request_action(uuid,text,text,uuid,uuid) to authenticated;

-- 即使有人繞過畫面直接更新，兩層核准欄位未齊全也不能派車。
create or replace function public.guard_vehicle_two_level_dispatch()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status='pending_manager_approval' and old.status<>'pending_approval' then
    raise exception using errcode='42501',message='必須先由課長核准，才能送交部門經理';
  end if;
  if new.status='assigned' and old.status<>'assigned' then
    if old.status<>'approved' or old.supervisor_id is null or old.approved_at is null
      or old.department_manager_id is null or old.department_manager_approved_at is null then
      raise exception using errcode='42501',message='課長與部門經理尚未完成核准，不得派車';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_two_level_dispatch on public.vehicle_dispatch_requests;
create trigger trg_guard_vehicle_two_level_dispatch
  before update of status on public.vehicle_dispatch_requests
  for each row execute function public.guard_vehicle_two_level_dispatch();

revoke all on function public.guard_vehicle_dispatch_approval() from public,anon,authenticated;
revoke all on function public.guard_vehicle_two_level_dispatch() from public,anon,authenticated;
