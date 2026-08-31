-- 人員管理：直屬主管規則三層對齊，並補上「主管被拔掉」的防線。
--
-- 問題一：規則不一致
--   前端 supervisorMatchesDepartment 與 admin-api validateSupervisor 都允許
--   「本單位或其上層部／室」（validateSupervisor 的訊息就寫「或其上層部／室」），
--   但資料庫的 guard_user_supervisor_hierarchy 要求「單位完全相同」。
--   結果：畫面把上層部室的主管列為可選、Edge Function 也放行，最後資料庫才退，
--   使用者看到的是「直屬主管必須與人員屬於同一單位」——選單明明給了卻存不進去。
--   以應用層的規則為準（同單位或其上層，另含秘書室→副總經理室），資料庫改成一致。
--   這不是放寬到沒有防線：跨部室、非主管、停用帳號一律仍然擋。
--
-- 問題二：兩個分支丟同一句話
--   dept_id 比對與 department 文字比對失敗時訊息完全相同，無從分辨是哪一種。
--   dept_id 那條改成明確講「或其上層部／室」。
--
-- 問題三：主管可以被降級／停用／換單位，底下的人卻沒人管
--   舊規則只在「異動下屬」時檢查，異動主管本人時完全不檢查。於是主管一旦被改成
--   非主管角色或停用，其下屬就掛著一個不合法的直屬主管，直到有人去編輯那位下屬
--   才會爆出看不懂的錯誤。新增 trg_guard_supervisor_still_needed，在異動主管本人時
--   就擋下來，並指名還有哪些人需要先改派。

begin;

-- 走訪部門樹，取得某個單位的最上層部／室。
create or replace function public.department_root_row(p_dept uuid)
returns public.departments
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_current uuid := p_dept;
  v_seen uuid[] := '{}';
  v_row public.departments;
begin
  while v_current is not null and not (v_current = any(v_seen)) loop
    v_seen := v_seen || v_current;
    select * into v_row from public.departments where dept_id = v_current and status = 'active';
    if v_row.dept_id is null then exit; end if;
    exit when v_row.parent_id is null;
    v_current := v_row.parent_id;
  end loop;
  return v_row;
end;
$$;

-- 主管的單位是否能管理該人員：本單位或其任一上層部／室；
-- 另外沿用應用層的特例——秘書室人員可直接呈報副總經理室。
-- 任一邊沒有單位時回傳 true，交由呼叫端的其他規則判斷（與 admin-api 一致）。
create or replace function public.supervisor_unit_allows(p_member_dept uuid, p_supervisor_dept uuid)
returns boolean
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_current uuid := p_member_dept;
  v_seen uuid[] := '{}';
  v_parent uuid;
  v_member_root public.departments;
  v_supervisor_root public.departments;
begin
  if p_member_dept is null or p_supervisor_dept is null then return true; end if;
  while v_current is not null and not (v_current = any(v_seen)) loop
    if v_current = p_supervisor_dept then return true; end if;
    v_seen := v_seen || v_current;
    select parent_id into v_parent from public.departments where dept_id = v_current and status = 'active';
    v_current := v_parent;
  end loop;
  v_member_root := public.department_root_row(p_member_dept);
  v_supervisor_root := public.department_root_row(p_supervisor_dept);
  return (upper(coalesce(v_member_root.code, '')) = 'SECRE'
          or replace(coalesce(v_member_root.name, ''), ' ', '') = '秘書室')
     and (upper(coalesce(v_supervisor_root.code, '')) = 'VGM'
          or replace(coalesce(v_supervisor_root.name, ''), ' ', '') in ('副總經理', '副總經理室'));
end;
$$;

-- 帳號階層的資料庫最後防線（規則改為與應用層一致）。
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
  if v_role in ('unit_supervisor','sysadmin') and new.supervisor_id is not null then
    raise exception '主管及系統管理員不可設定直屬主管' using errcode='23514';
  end if;
  if new.status='active' and v_role not in ('unit_supervisor','sysadmin') and new.supervisor_id is null then
    raise exception '啟用中的一般人員必須指定直屬課室主管' using errcode='23514';
  end if;
  if new.supervisor_id is not null then
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

-- 主管本人被降級、停用或換單位時，先確認底下沒有還掛著的啟用人員。
create or replace function public.guard_supervisor_still_needed()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_effective_role text;
  v_old_role text;
  v_new_role text;
  v_count integer;
  v_names text;
begin
  v_old_role := coalesce(old.rbac_role, case old.role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter'
    else old.role end, 'reporter');
  if v_old_role not in ('unit_supervisor','sysadmin') then return new; end if;

  v_new_role := coalesce(new.rbac_role, case new.role
    when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor'
    when 'maintenance' then 'technician' when 'inspector' then 'reporter'
    else new.role end, 'reporter');

  -- 還是主管、還是啟用中、單位也沒變：沒有任何下屬會受影響。
  if v_new_role in ('unit_supervisor','sysadmin')
     and new.status = 'active'
     and new.dept_id is not distinct from old.dept_id then
    return new;
  end if;

  select count(*), string_agg(u.name, '、' order by u.name)
    into v_count, v_names
  from public.users u
  where u.supervisor_id = old.user_id
    and u.status = 'active'
    and (
      v_new_role not in ('unit_supervisor','sysadmin')
      or new.status <> 'active'
      or (v_new_role <> 'sysadmin' and not public.supervisor_unit_allows(u.dept_id, new.dept_id))
    );

  if coalesce(v_count, 0) > 0 then
    raise exception using errcode='23514',
      message = format('這位主管底下還有 %s 位啟用中的人員（%s），請先把他們改指派給其他主管，再調整這個帳號',
                       v_count, left(coalesce(v_names, ''), 200));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_supervisor_still_needed on public.users;
create trigger trg_guard_supervisor_still_needed
before update of role,rbac_role,dept_id,status on public.users
for each row execute function public.guard_supervisor_still_needed();

revoke all on function public.department_root_row(uuid) from public,anon,authenticated;
revoke all on function public.supervisor_unit_allows(uuid,uuid) from public,anon,authenticated;
revoke all on function public.guard_supervisor_still_needed() from public,anon,authenticated;
revoke all on function public.guard_user_supervisor_hierarchy() from public,anon,authenticated;

commit;
