-- 系統管理者可執行單位主管核可（含自己的申請）；一般主管仍禁止自核且限同單位。
begin;

create or replace function public.guard_vehicle_dispatch_approval()
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
    if auth.uid() is null then return new; end if;
    select u.user_id,
      case coalesce(u.rbac_role,u.role,'reporter')
        when 'admin' then 'sysadmin'
        when 'supervisor' then 'unit_supervisor'
        when 'maintenance' then 'technician'
        when 'inspector' then 'reporter'
        else coalesce(u.rbac_role,u.role,'reporter')
      end,
      u.department
    into actor_id,actor_role,actor_department
    from public.users u
    where u.auth_id=auth.uid() and u.status='active'
    limit 1;

    if actor_id is null then
      raise exception using errcode='42501',message='找不到有效的核可人員帳號';
    end if;
    if actor_role not in ('unit_supervisor','mgmt_supervisor','sysadmin') then
      raise exception using errcode='42501',message='目前帳號沒有單位主管核可權限';
    end if;
    if actor_role<>'sysadmin' and actor_id=old.applicant_id then
      raise exception using errcode='42501',message='申請人不得核准或退回自己的派車申請';
    end if;
    if actor_role<>'sysadmin' and trim(coalesce(actor_department,''))<>trim(coalesce(old.applicant_department,'')) then
      raise exception using errcode='42501',message='僅限申請人所屬單位主管核可';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_dispatch_approval on public.vehicle_dispatch_requests;
create trigger trg_guard_vehicle_dispatch_approval
  before update on public.vehicle_dispatch_requests
  for each row execute function public.guard_vehicle_dispatch_approval();

commit;
