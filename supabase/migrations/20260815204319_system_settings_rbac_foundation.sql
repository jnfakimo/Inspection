-- Ensure the V1/V2 administration foundation exists without deleting or
-- replacing any business data. Safe to re-run.

begin;

alter table public.users
  add column if not exists username text;

alter table public.users
  add column if not exists permissions jsonb;

alter table public.users
  alter column permissions set default '{}'::jsonb;

update public.users
set permissions = '{}'::jsonb
where permissions is null;

alter table public.users
  alter column permissions set not null;

create table if not exists public.system_settings (
  key text primary key,
  value text,
  updated_at timestamptz default now()
);

alter table public.system_settings
  add column if not exists value text;

alter table public.system_settings
  add column if not exists updated_at timestamptz;

alter table public.system_settings
  alter column updated_at set default now();

update public.system_settings
set updated_at = now()
where updated_at is null;

insert into public.system_settings (key, value) values
  ('org_name', '臺北農產運銷股份有限公司'),
  ('site_name', '第一果菜市場'),
  ('shifts', '[{"id":"morning","label":"早班","start":"06:00","end":"14:00"},{"id":"afternoon","label":"中班","start":"14:00","end":"22:00"},{"id":"night","label":"夜班","start":"22:00","end":"06:00"}]')
on conflict (key) do update
set value = excluded.value,
    updated_at = coalesce(public.system_settings.updated_at, now())
where public.system_settings.value is null;

alter table public.system_settings enable row level security;
alter table public.system_settings force row level security;

drop policy if exists settings_active_read on public.system_settings;
drop policy if exists settings_admin_insert on public.system_settings;
drop policy if exists settings_admin_update on public.system_settings;

create policy settings_active_read
on public.system_settings for select to authenticated
using (public.active_user_id() is not null and key <> 'line_channel_token');

create policy settings_admin_insert
on public.system_settings for insert to authenticated
with check (public.is_admin());

create policy settings_admin_update
on public.system_settings for update to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into public.role_permissions (role_id, perm, allowed)
select role_id, 'sys_admin', role_id = 'sysadmin'
from public.roles
on conflict (role_id, perm) do update
set allowed = excluded.allowed;

update public.users
set permissions = permissions - 'sys_admin'
where coalesce(rbac_role, '') <> 'sysadmin'
  and permissions ? 'sys_admin';

commit;
