begin;

-- 駐警隊交接簿改為與業管組一致的雙方勾稽：
-- 交班人送出時必須指定接班人，且只有該接班人本人登入才能確認。

alter table public.guard_handover_logs add column if not exists receiver_id uuid references public.users(user_id);

-- 舊版已接班紀錄保留原樣（鎖定的簽認紀錄不回寫）；尚待接班者
-- 不猜測指定人，由原交班人撤回後重新指定。

create or replace function public.guard_receiver_allowed(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select (r.role_id='sysadmin' or (
    coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_system_access where user_id=u.user_id and system_key='handover'),
      (select allowed from public.role_permissions where role_id=r.role_id and perm='sys_handover'),false)
    and coalesce((select case mode when 'allow' then true when 'deny' then false end from public.user_module_access where user_id=u.user_id and system_key='handover' and module_key='guard'),
      (select case mode when 'allow' then true when 'deny' then false end from public.role_module_access where role_id=r.role_id and system_key='handover' and module_key='guard'),true)
    ))
    from public.users u
    left join public.departments d on d.dept_id=u.dept_id
    cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else u.role end) as role_id) r
    where u.user_id=p_user and u.status='active'
      and (r.role_id='sysadmin' or coalesce(d.name,'')~'(駐警|駐衛)' or coalesce(u.department,'')~'(駐警|駐衛)')
      and lower(trim(coalesce(u.username,''))) not like 'deidentified-%'
      and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
      and trim(coalesce(u.name,'')) not like '已離職人員-%'),false)
$$;

create or replace function public.guard_handover_receivers()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.active_user_id() is null or not coalesce(public.has_handover_module_access('guard'),false) then
    raise exception using errcode='42501',message='目前帳號未開放駐警隊電子交接簿';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.name,'department',u.department,'status',u.status) order by u.name),'[]'::jsonb)
    from public.users u where public.guard_receiver_allowed(u.user_id) and u.user_id<>public.active_user_id());
end $$;

create or replace function public.protect_guard_handover_log()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  content_keys text[] := array['status','handover_by','handover_at','receiver_id','takeover_by','takeover_at','patrol_snapshot','updated_by','updated_at'];
begin
  if tg_op='INSERT' then
    if exists(select 1 from public.guard_handover_daily_approvals a where a.duty_date=new.duty_date) then
      raise exception using errcode='23514',message='guard handover day has been approved and is locked';
    end if;
    if new.status<>'draft' then raise exception using errcode='23514',message='guard handover must start as draft'; end if;
    new.handover_by:=null; new.handover_at:=null; new.receiver_id:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
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
  if old.status='received' then raise exception using errcode='23514',message='received guard handover is immutable'; end if;
  if old.status='submitted' and (to_jsonb(new)-content_keys) is distinct from (to_jsonb(old)-content_keys) then
    raise exception using errcode='23514',message='submitted guard handover content is locked';
  end if;

  if old.status='draft' and new.status='draft' then
    new.handover_by:=null; new.handover_at:=null; new.receiver_id:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='draft' and new.status='submitted' then
    if new.handover_by is distinct from new.updated_by then raise exception using errcode='23514',message='handover signer must be the acting user'; end if;
    if new.receiver_id is null or new.receiver_id=new.handover_by then raise exception using errcode='23514',message='a different designated receiver is required'; end if;
    new.handover_at:=now(); new.takeover_by:=null; new.takeover_at:=null;
  elsif old.status='submitted' and new.status='draft' then
    if new.updated_by is distinct from old.handover_by then raise exception using errcode='23514',message='only the handover signer can withdraw'; end if;
    new.handover_by:=null; new.handover_at:=null; new.receiver_id:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='submitted' and new.status='received' then
    if old.receiver_id is null or new.takeover_by is distinct from old.receiver_id or new.takeover_by is distinct from new.updated_by then
      raise exception using errcode='23514',message='only the designated receiver can sign for takeover';
    end if;
    new.handover_by:=old.handover_by; new.handover_at:=old.handover_at; new.receiver_id:=old.receiver_id; new.patrol_snapshot:=old.patrol_snapshot; new.takeover_at:=now();
  else
    raise exception using errcode='23514',message='invalid guard handover status transition';
  end if;
  new.updated_at:=now();
  return new;
end
$$;

alter table public.guard_handover_logs drop constraint if exists guard_handover_receiver_check;
alter table public.guard_handover_logs add constraint guard_handover_receiver_check check(
  (status='draft' and receiver_id is null)
  or (status='submitted' and receiver_id is not null and receiver_id<>handover_by and takeover_by is null)
  or (status='received' and receiver_id is not null and takeover_by=receiver_id)
) not valid;

revoke all on function public.guard_receiver_allowed(uuid),public.guard_handover_receivers() from public,anon,authenticated;
grant execute on function public.guard_receiver_allowed(uuid) to service_role;
grant execute on function public.guard_handover_receivers() to authenticated,service_role;

comment on column public.guard_handover_logs.receiver_id is '交班人送出時指定的接班人；只能由該帳號本人確認接班';
notify pgrst, 'reload schema';

commit;
