-- 主管核可權限：登入者須為同單位主管／管理主管／系統管理員，且不得核准自己的申請。
begin;

create or replace function guard_vehicle_dispatch_approval()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  actor_id uuid;
  actor_role text;
  actor_department text;
begin
  if old.status='pending_approval' and new.status in ('approved','returned') then
    -- SQL Editor、migration 或 service role 不帶 auth.uid，由受信任後端自行管理。
    if auth.uid() is null then
      return new;
    end if;

    select u.user_id,
      coalesce(u.rbac_role,case u.role
        when 'admin' then 'sysadmin'
        when 'supervisor' then 'unit_supervisor'
        when 'maintenance' then 'technician'
        else 'reporter' end),
      u.department
    into actor_id,actor_role,actor_department
    from users u
    where u.auth_id=auth.uid() and u.status='active'
    limit 1;

    if actor_id is null then
      raise exception using errcode='42501',message='找不到有效的核可人員帳號';
    end if;
    if actor_id=old.applicant_id then
      raise exception using errcode='42501',message='申請人不得核准或退回自己的派車申請';
    end if;
    if actor_role not in ('unit_supervisor','mgmt_supervisor','sysadmin') then
      raise exception using errcode='42501',message='目前帳號沒有單位主管核可權限';
    end if;
    if actor_role<>'sysadmin' and trim(coalesce(actor_department,''))<>trim(coalesce(old.applicant_department,'')) then
      raise exception using errcode='42501',message='僅限申請人所屬單位主管核可';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_approval on vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_approval
  before update on vehicle_dispatch_requests
  for each row execute function guard_vehicle_dispatch_approval();

commit;
