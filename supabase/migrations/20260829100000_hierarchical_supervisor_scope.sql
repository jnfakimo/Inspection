-- 帳號主管階層：一般人員可由同課／組／隊主管，或所屬上層部／室主管負責。
-- 主管角色本身可掛在第一階或第二階單位；這裡只限制主管必須位於人員的
-- 同一單位或其祖先單位，避免跨部／室指定主管。

begin;

create or replace function public.guard_user_supervisor_hierarchy()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_role text := coalesce(new.rbac_role, case new.role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter'
    else new.role end, 'reporter');
  v_supervisor record;
begin
  if v_role in ('unit_supervisor','sysadmin') and new.supervisor_id is not null then
    raise exception '主管及系統管理員不可設定直屬主管' using errcode='23514';
  end if;
  if new.status='active' and v_role not in ('unit_supervisor','sysadmin') and new.supervisor_id is null then
    raise exception '啟用中的一般人員必須指定直屬主管' using errcode='23514';
  end if;
  if new.supervisor_id is not null then
    select user_id,dept_id,rbac_role,role,status,department into v_supervisor
    from public.users where user_id=new.supervisor_id;
    if v_supervisor.user_id is null or v_supervisor.status<>'active' then
      raise exception '直屬主管必須是啟用中的帳號' using errcode='23514';
    end if;
    if coalesce(v_supervisor.rbac_role, case v_supervisor.role
      when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
      else v_supervisor.role end) not in ('unit_supervisor','sysadmin') then
      raise exception '直屬主管必須具備單位主管或系統管理員角色' using errcode='23514';
    end if;
    if coalesce(v_supervisor.rbac_role, case v_supervisor.role
      when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
      else v_supervisor.role end) <> 'sysadmin'
       and new.dept_id is not null and v_supervisor.dept_id is not null
       and not exists (
         with recursive unit_chain(dept_id, parent_id, path) as (
           select d.dept_id, d.parent_id, array[d.dept_id]
           from public.departments d
           where d.dept_id = new.dept_id
           union all
           select parent.dept_id, parent.parent_id, child.path || parent.dept_id
           from public.departments parent
           join unit_chain child on child.parent_id = parent.dept_id
           where not parent.dept_id = any(child.path)
         )
         select 1 from unit_chain where dept_id = v_supervisor.dept_id
       ) then
      raise exception '直屬主管必須位於人員所屬單位或其上層部／室' using errcode='23514';
    end if;
    if coalesce(v_supervisor.rbac_role, case v_supervisor.role
      when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
      else v_supervisor.role end) <> 'sysadmin'
       and new.dept_id is null and nullif(btrim(new.department), '') is not null
       and nullif(btrim(v_supervisor.department), '') is not null
       and btrim(new.department) is distinct from btrim(v_supervisor.department) then
      raise exception '直屬主管必須與人員屬於同一單位' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
