-- 人員職務輪調：單位、課室與角色可在同一筆操作中調整，必要時同步改派原直屬人員。
-- 不刪除任何帳號或歷程；所有更新在同一交易內完成，任一步失敗即全部回滾。

begin;

create or replace function public.admin_rotate_user_assignment(
  p_user_id uuid,
  p_name text,
  p_username text,
  p_phone text,
  p_dept_id uuid,
  p_department text,
  p_role text,
  p_rbac_role text,
  p_supervisor_id uuid,
  p_replacement_supervisor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_target public.users%rowtype;
  v_replacement public.users%rowtype;
  v_new_role text := coalesce(nullif(btrim(p_rbac_role), ''), case p_role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter'
    else p_role end, 'reporter');
  v_replacement_role text;
  v_affected_count integer := 0;
  v_affected_names text := '';
begin
  select * into v_target from public.users where user_id=p_user_id for update;
  if v_target.user_id is null then
    raise exception '找不到指定使用者' using errcode='P0002';
  end if;

  select count(*), string_agg(u.name, '、' order by u.name)
    into v_affected_count, v_affected_names
  from public.users u
  where u.supervisor_id=p_user_id
    and u.status='active'
    and (
      v_new_role not in ('unit_supervisor','sysadmin')
      or (v_new_role<>'sysadmin' and not public.supervisor_unit_allows(u.dept_id,p_dept_id))
    );

  if coalesce(v_affected_count,0)>0 then
    if p_replacement_supervisor_id is null then
      raise exception using errcode='23514',
        message=format('此人原有 %s 位直屬人員（%s），請先選擇接任主管',
          v_affected_count,left(coalesce(v_affected_names,''),200));
    end if;
    if p_replacement_supervisor_id=p_user_id then
      raise exception '接任主管不可設定為原主管本人' using errcode='23514';
    end if;

    select * into v_replacement from public.users
    where user_id=p_replacement_supervisor_id for share;
    v_replacement_role := coalesce(v_replacement.rbac_role,case v_replacement.role
      when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
      when 'maintenance' then 'technician' when 'inspector' then 'reporter'
      else v_replacement.role end,'reporter');
    if v_replacement.user_id is null or v_replacement.status<>'active'
       or v_replacement_role not in ('unit_supervisor','sysadmin') then
      raise exception '接任主管必須是另一位啟用中的單位主管或系統管理員' using errcode='23514';
    end if;
    if v_replacement_role<>'sysadmin' and exists (
      select 1 from public.users u
      where u.supervisor_id=p_user_id and u.status='active'
        and (
          v_new_role not in ('unit_supervisor','sysadmin')
          or (v_new_role<>'sysadmin' and not public.supervisor_unit_allows(u.dept_id,p_dept_id))
        )
        and not public.supervisor_unit_allows(u.dept_id,v_replacement.dept_id)
    ) then
      raise exception '接任主管無法管理全部原直屬人員，請改選共同上層主管或系統管理員' using errcode='23514';
    end if;

    update public.users u set supervisor_id=p_replacement_supervisor_id
    where u.supervisor_id=p_user_id and u.status='active'
      and (
        v_new_role not in ('unit_supervisor','sysadmin')
        or (v_new_role<>'sysadmin' and not public.supervisor_unit_allows(u.dept_id,p_dept_id))
      );
  end if;

  update public.users set
    name=p_name,
    username=p_username,
    phone=nullif(btrim(p_phone),''),
    dept_id=p_dept_id,
    department=nullif(btrim(p_department),''),
    role=p_role,
    rbac_role=p_rbac_role,
    supervisor_id=p_supervisor_id
  where user_id=p_user_id;

  return jsonb_build_object(
    'user_id',p_user_id,
    'reassigned_count',coalesce(v_affected_count,0),
    'reassigned_names',coalesce(v_affected_names,'')
  );
end;
$$;

revoke all on function public.admin_rotate_user_assignment(uuid,text,text,text,uuid,text,text,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.admin_rotate_user_assignment(uuid,text,text,text,uuid,text,text,text,uuid,uuid)
  to service_role;

-- 清理既有主管帳號殘留的舊 supervisor_id；此欄位只對一般人員有效。
update public.users set supervisor_id=null
where supervisor_id is not null
  and coalesce(rbac_role,case role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter'
    else role end,'reporter') in ('unit_supervisor','sysadmin');

commit;
