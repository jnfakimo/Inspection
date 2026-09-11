begin;

-- 商業版三層授權：角色範本 → 個人大系統例外 → 個人子系統例外。
-- mode=inherit 沿用上一層；allow/deny 為個人明確例外，deny 優先收斂權限。
create table if not exists public.user_system_access (
  user_id uuid not null references public.users(user_id),
  system_key text not null,
  mode text not null default 'inherit',
  granted_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,system_key)
);
alter table public.user_system_access
  add column if not exists user_id uuid references public.users(user_id),
  add column if not exists system_key text,
  add column if not exists mode text not null default 'inherit',
  add column if not exists granted_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.user_module_access (
  user_id uuid not null references public.users(user_id),
  system_key text not null,
  module_key text not null,
  mode text not null default 'inherit',
  granted_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,system_key,module_key)
);
alter table public.user_module_access
  add column if not exists user_id uuid references public.users(user_id),
  add column if not exists system_key text,
  add column if not exists module_key text,
  add column if not exists mode text not null default 'inherit',
  add column if not exists granted_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists(select 1 from pg_constraint where conname='user_system_access_key_check' and conrelid='public.user_system_access'::regclass) then
    alter table public.user_system_access add constraint user_system_access_key_check check(system_key in (
      'admin','workorder','guardpatrol','handover','equipment','structuremap','vehicle',
      'meetingroom','officialdocs','marketanalytics','dashboard','marketboard','vehicletracking'
    ));
  end if;
  if not exists(select 1 from pg_constraint where conname='user_system_access_mode_check' and conrelid='public.user_system_access'::regclass) then
    alter table public.user_system_access add constraint user_system_access_mode_check check(mode in ('inherit','allow','deny'));
  end if;
  if not exists(select 1 from pg_constraint where conname='user_module_access_mode_check' and conrelid='public.user_module_access'::regclass) then
    alter table public.user_module_access add constraint user_module_access_mode_check check(mode in ('inherit','allow','deny'));
  end if;
end $$;

create index if not exists idx_user_system_access_effective on public.user_system_access(user_id,system_key,mode);
create index if not exists idx_user_module_access_effective on public.user_module_access(user_id,system_key,module_key,mode);

alter table public.user_system_access enable row level security;
alter table public.user_system_access force row level security;
alter table public.user_module_access enable row level security;
alter table public.user_module_access force row level security;
revoke all on public.user_system_access,public.user_module_access from anon;
revoke insert,update,delete on public.user_system_access,public.user_module_access from authenticated;
grant select on public.user_system_access,public.user_module_access to authenticated;

drop policy if exists user_system_access_admin_read on public.user_system_access;
create policy user_system_access_admin_read on public.user_system_access for select to authenticated
  using(public.active_rbac_role()='sysadmin');
drop policy if exists user_module_access_admin_read on public.user_module_access;
create policy user_module_access_admin_read on public.user_module_access for select to authenticated
  using(public.active_rbac_role()='sysadmin');

create or replace function public.has_system_access(p_permission text)
returns boolean language sql security definer stable set search_path=''
as $$
  select case when p_permission='sys_admin' then public.active_rbac_role()='sysadmin'
    else public.active_rbac_role()='sysadmin' or coalesce((
      select case usa.mode
        when 'allow' then true
        when 'deny' then false
        else coalesce((select rp.allowed from public.role_permissions rp
          where rp.role_id=public.active_rbac_role() and rp.perm=p_permission),false)
      end
      from public.user_system_access usa
      where usa.user_id=public.active_user_id()
        and usa.system_key=regexp_replace(p_permission,'^sys_','')
      limit 1
    ),coalesce((select rp.allowed from public.role_permissions rp
      where rp.role_id=public.active_rbac_role() and rp.perm=p_permission),false)) end
$$;
revoke all on function public.has_system_access(text) from public,anon;
grant execute on function public.has_system_access(text) to authenticated;

create or replace function public.has_module_access(p_system_key text,p_module_key text)
returns boolean language sql security definer stable set search_path=''
as $$
  select public.active_rbac_role()='sysadmin' or (
    public.has_system_access('sys_'||p_system_key) and coalesce((
      select case uma.mode when 'allow' then true when 'deny' then false else true end
      from public.user_module_access uma
      where uma.user_id=public.active_user_id()
        and uma.system_key=p_system_key and uma.module_key=p_module_key
      limit 1
    ),true)
  )
$$;
revoke all on function public.has_module_access(text,text) from public,anon;
grant execute on function public.has_module_access(text,text) to authenticated;

-- 舊版交接簿採明確白名單；移轉時把未勾選項目寫成 deny，確保權限不會因新制放大。
insert into public.user_module_access(user_id,system_key,module_key,mode,granted_by)
select u.user_id,'handover',m.module_key,
  case when exists(select 1 from public.user_handover_module_access old
    where old.user_id=u.user_id and old.module_key=m.module_key and old.allowed) then 'allow' else 'deny' end,
  coalesce((select old.granted_by from public.user_handover_module_access old
    where old.user_id=u.user_id and old.module_key=m.module_key limit 1),u.user_id)
from public.users u
cross join (values ('records'),('mechanical'),('business'),('guard'),('guard-approve'),('open-items'),('equipment'),('mechanical-schedule')) m(module_key)
where u.status='active'
  and coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else u.role end)<>'sysadmin'
  and exists(select 1 from public.role_permissions rp
    where rp.role_id=coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' when 'maintenance' then 'technician' when 'inspector' then 'reporter' else u.role end)
      and rp.perm='sys_handover' and rp.allowed)
on conflict(user_id,system_key,module_key) do nothing;

create or replace function public.has_handover_module_access(p_module_key text)
returns boolean language sql stable security definer set search_path=''
as $$ select public.has_module_access('handover',p_module_key) $$;
revoke all on function public.has_handover_module_access(text) from public,anon;
grant execute on function public.has_handover_module_access(text) to authenticated;

comment on table public.user_system_access is '個人大系統權限例外；inherit 沿用角色範本，allow/deny 為明確例外';
comment on table public.user_module_access is '個人子系統權限例外；系統拒絕時子系統一律無效';

commit;
