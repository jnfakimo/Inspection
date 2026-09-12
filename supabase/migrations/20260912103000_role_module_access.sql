begin;

-- 四層授權：角色×大系統 → 角色×子系統（本檔新增）→ 個人×大系統 → 個人×子系統。
-- mode=inherit 沿用上一層；allow/deny 為明確設定，個人設定優先於角色範本。
create table if not exists public.role_module_access (
  role_id text not null references public.roles(role_id),
  system_key text not null,
  module_key text not null,
  mode text not null default 'inherit',
  updated_by uuid references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(role_id,system_key,module_key)
);
alter table public.role_module_access
  add column if not exists role_id text references public.roles(role_id),
  add column if not exists system_key text,
  add column if not exists module_key text,
  add column if not exists mode text not null default 'inherit',
  add column if not exists updated_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  if not exists(select 1 from pg_constraint where conname='role_module_access_key_check' and conrelid='public.role_module_access'::regclass) then
    alter table public.role_module_access add constraint role_module_access_key_check check(system_key in (
      'admin','workorder','guardpatrol','handover','equipment','structuremap','vehicle',
      'meetingroom','officialdocs','marketanalytics','dashboard','marketboard','vehicletracking'
    ));
  end if;
  if not exists(select 1 from pg_constraint where conname='role_module_access_mode_check' and conrelid='public.role_module_access'::regclass) then
    alter table public.role_module_access add constraint role_module_access_mode_check check(mode in ('inherit','allow','deny'));
  end if;
end $$;

create index if not exists idx_role_module_access_effective on public.role_module_access(role_id,system_key,module_key,mode);

alter table public.role_module_access enable row level security;
alter table public.role_module_access force row level security;
revoke all on public.role_module_access from anon;
revoke insert,update,delete on public.role_module_access from authenticated;
grant select on public.role_module_access to authenticated;
grant select,insert,update on public.role_module_access to service_role;

drop policy if exists role_module_access_admin_read on public.role_module_access;
create policy role_module_access_admin_read on public.role_module_access for select to authenticated
  using(public.active_rbac_role()='sysadmin');

-- 停用的角色範本列只改 mode，不刪除；保留稽核可追溯性。
create or replace function public.protect_role_module_access()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception '角色子系統範本不可刪除，請改為 inherit 或 deny';
  end if;
  if tg_op='UPDATE' then
    if new.role_id<>old.role_id or new.system_key<>old.system_key or new.module_key<>old.module_key then
      raise exception '角色子系統範本的角色與子系統不可變更';
    end if;
    new.created_at:=old.created_at;
    new.updated_at:=now();
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_role_module_access on public.role_module_access;
create trigger trg_protect_role_module_access before update or delete on public.role_module_access
  for each row execute function public.protect_role_module_access();

-- 主管簽核屬於特權子系統：導入角色層時一律先寫成 deny，避免「沿用大系統」讓權限放大。
-- 要開放時由系統管理員在後台把該角色改成 allow；個人層的既有 allow 仍然優先生效。
insert into public.role_module_access(role_id,system_key,module_key,mode)
select r.role_id,'handover','guard-approve','deny' from public.roles r where r.role_id<>'sysadmin'
on conflict(role_id,system_key,module_key) do nothing;

-- 有效子系統權限：個人設定優先，其次角色範本，兩者都沒設才沿用大系統。
create or replace function public.has_module_access(p_system_key text,p_module_key text)
returns boolean language sql security definer stable set search_path=''
as $$
  select public.active_rbac_role()='sysadmin' or (
    public.has_system_access('sys_'||p_system_key) and coalesce(
      (select case uma.mode when 'allow' then true when 'deny' then false else null end
        from public.user_module_access uma
        where uma.user_id=public.active_user_id()
          and uma.system_key=p_system_key and uma.module_key=p_module_key
        limit 1),
      (select case rma.mode when 'allow' then true when 'deny' then false else null end
        from public.role_module_access rma
        where rma.role_id=public.active_rbac_role()
          and rma.system_key=p_system_key and rma.module_key=p_module_key
        limit 1),
      true)
  )
$$;
revoke all on function public.has_module_access(text,text) from public,anon;
grant execute on function public.has_module_access(text,text) to authenticated;

comment on table public.role_module_access is '角色子系統範本；inherit 沿用大系統，allow/deny 為角色預設值，個人例外優先';

commit;
