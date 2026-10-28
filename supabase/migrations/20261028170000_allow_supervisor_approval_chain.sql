-- 讓多階簽核使用既有主管關係；保留角色、單位、在職與一般人員必填限制。
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
  v_supervisor_role text;
begin
  if v_role='sysadmin' and new.supervisor_id is not null then
    raise exception '系統管理員不可設定直屬主管' using errcode='23514';
  end if;
  if new.status='active' and v_role not in ('unit_supervisor','sysadmin') and new.supervisor_id is null then
    raise exception '啟用中的一般人員必須指定直屬課室主管' using errcode='23514';
  end if;
  if new.supervisor_id is not null then
    -- 以交易鎖序列化關係異動，避免兩筆同時更新互指造成循環。
    perform pg_advisory_xact_lock(20261028,1700);
    if new.supervisor_id=new.user_id or exists (
      with recursive ancestors(user_id,supervisor_id) as (
        select u.user_id,u.supervisor_id from public.users u where u.user_id=new.supervisor_id
        union
        select u.user_id,u.supervisor_id from public.users u join ancestors a on u.user_id=a.supervisor_id
      ) select 1 from ancestors where user_id=new.user_id
    ) then
      raise exception '直屬主管不可為本人或下屬，主管關係不可形成循環' using errcode='23514';
    end if;
    select user_id,dept_id,rbac_role,role,status,department into v_supervisor
    from public.users where user_id=new.supervisor_id;
    if v_supervisor.user_id is null or v_supervisor.status<>'active' then
      raise exception '直屬主管必須是啟用中的帳號' using errcode='23514';
    end if;
    v_supervisor_role := coalesce(v_supervisor.rbac_role, case v_supervisor.role
      when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
      else v_supervisor.role end);
    if v_supervisor_role not in ('unit_supervisor','sysadmin') then
      raise exception '直屬主管必須具備課室主管或系統管理員角色' using errcode='23514';
    end if;
    -- 同單位或其上層部／室即可（與前端選單、admin-api 的判斷一致）。
    if v_supervisor_role <> 'sysadmin'
       and not public.supervisor_unit_allows(new.dept_id, v_supervisor.dept_id) then
      raise exception '直屬主管必須與人員屬於同一單位或其上層部／室' using errcode='23514';
    end if;
    -- 沒有 dept_id 的舊資料退回比對單位名稱文字。
    if v_supervisor_role <> 'sysadmin'
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
