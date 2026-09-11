begin;

-- 機電工作選項改為可維護主檔；刪除一律採停用，歷史交接文字不回寫也不消失。
create table if not exists public.mechanical_work_categories (
  category_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(user_id),
  updated_at timestamptz not null default now()
);
alter table public.mechanical_work_categories
  add column if not exists category_id uuid default gen_random_uuid(),
  add column if not exists name text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(user_id),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.mechanical_work_items (
  item_id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.mechanical_work_categories(category_id),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(user_id),
  updated_at timestamptz not null default now(),
  unique(category_id,name)
);
alter table public.mechanical_work_items
  add column if not exists item_id uuid default gen_random_uuid(),
  add column if not exists category_id uuid references public.mechanical_work_categories(category_id),
  add column if not exists name text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(user_id),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_mechanical_work_category_name on public.mechanical_work_categories(lower(btrim(name)));
create unique index if not exists uq_mechanical_work_item_category_name on public.mechanical_work_items(category_id,lower(btrim(name)));
create index if not exists idx_mechanical_work_categories_active on public.mechanical_work_categories(is_active,sort_order,name);
create index if not exists idx_mechanical_work_items_active on public.mechanical_work_items(category_id,is_active,sort_order,name);

insert into public.mechanical_work_categories(name,sort_order)
values
  ('冷凍冷藏設備',10),('供配電設備',20),('給排水設備',30),('電梯設備',40),
  ('消防設備',50),('環境與例行工作',60),('修繕與臨時工作',70),('其他',80)
on conflict(name) do nothing;

with seed(category_name,item_name,sort_order) as (values
  ('冷凍冷藏設備','B1F 冷藏主機巡檢、運轉壓力溫度紀錄',10),
  ('冷凍冷藏設備','4F 冷藏庫主機巡檢壓力紀錄',20),
  ('冷凍冷藏設備','4F 西側冷藏庫、東側冷凍庫巡查及溫度紀錄',30),
  ('冷凍冷藏設備','冷凍空調設備異常處理',40),
  ('供配電設備','B2F 東西側配電室巡查',10),
  ('供配電設備','B3F 東西側發電機及消防室巡查',20),
  ('供配電設備','2F 東西側發電機室巡查',30),
  ('供配電設備','發電機啟動測試',40),
  ('供配電設備','配電盤及電氣設備檢查',50),
  ('給排水設備','污廢水井、抽水泵及逆止閥檢查',10),
  ('給排水設備','排水管路及積水巡查',20),
  ('給排水設備','飲水及排水設備疏通',30),
  ('電梯設備','電梯運轉巡查',10),('電梯設備','電梯故障緊急處理',20),
  ('消防設備','消防設備巡查',10),('消防設備','消防警報及泵浦測試',20),
  ('環境與例行工作','工具清點',10),('環境與例行工作','機電辦公室清潔',20),('環境與例行工作','設備機房清潔',30),
  ('修繕與臨時工作','門窗及五金修繕',10),('修繕與臨時工作','照明設備修繕',20),('修繕與臨時工作','現場臨時交辦事項',30),
  ('其他','其他維修養護工作',10)
)
insert into public.mechanical_work_items(category_id,name,sort_order)
select c.category_id,s.item_name,s.sort_order
from seed s join public.mechanical_work_categories c on c.name=s.category_name
on conflict(category_id,name) do nothing;

create or replace function public.guard_mechanical_work_option()
returns trigger language plpgsql security definer set search_path=''
as $$
declare actor uuid:=public.active_user_id();
begin
  if actor is null then raise exception using errcode='42501',message='active mechanical option actor is required'; end if;
  if tg_op='DELETE' then raise exception using errcode='42501',message='mechanical options use soft delete'; end if;
  if tg_op='INSERT' then
    new.created_by:=actor; new.created_at:=now();
  end if;
  new.updated_by:=actor; new.updated_at:=now();
  new.name:=btrim(new.name);
  if new.name='' then raise exception using errcode='23514',message='mechanical option name is required'; end if;
  return new;
end
$$;
revoke all on function public.guard_mechanical_work_option() from public,anon,authenticated;
drop trigger if exists trg_guard_mechanical_work_category on public.mechanical_work_categories;
create trigger trg_guard_mechanical_work_category before insert or update or delete on public.mechanical_work_categories
for each row execute function public.guard_mechanical_work_option();
drop trigger if exists trg_guard_mechanical_work_item on public.mechanical_work_items;
create trigger trg_guard_mechanical_work_item before insert or update or delete on public.mechanical_work_items
for each row execute function public.guard_mechanical_work_option();

alter table public.mechanical_work_categories enable row level security;
alter table public.mechanical_work_categories force row level security;
alter table public.mechanical_work_items enable row level security;
alter table public.mechanical_work_items force row level security;
revoke all on public.mechanical_work_categories,public.mechanical_work_items from anon;
revoke delete on public.mechanical_work_categories,public.mechanical_work_items from authenticated;
grant select,insert,update on public.mechanical_work_categories,public.mechanical_work_items to authenticated;
create or replace function public.can_manage_mechanical_work_options()
returns boolean language sql stable security definer set search_path=''
as $$
  select public.active_rbac_role()='sysadmin' or exists(
    select 1 from public.users u join public.departments d on d.dept_id=u.dept_id
    where u.user_id=public.active_user_id() and u.status='active' and d.status='active'
      and d.level=2 and d.name='機電課' and public.active_rbac_role()='unit_supervisor'
  )
$$;
revoke all on function public.can_manage_mechanical_work_options() from public,anon;
grant execute on function public.can_manage_mechanical_work_options() to authenticated;
drop policy if exists mechanical_work_categories_read on public.mechanical_work_categories;
create policy mechanical_work_categories_read on public.mechanical_work_categories for select to authenticated
using(public.has_handover_module_access('mechanical'));
drop policy if exists mechanical_work_categories_insert on public.mechanical_work_categories;
create policy mechanical_work_categories_insert on public.mechanical_work_categories for insert to authenticated
with check(public.has_handover_module_access('mechanical') and public.can_manage_mechanical_work_options() and created_by=public.active_user_id());
drop policy if exists mechanical_work_categories_update on public.mechanical_work_categories;
create policy mechanical_work_categories_update on public.mechanical_work_categories for update to authenticated
using(public.has_handover_module_access('mechanical') and public.can_manage_mechanical_work_options())
with check(public.has_handover_module_access('mechanical') and public.can_manage_mechanical_work_options() and updated_by=public.active_user_id());
drop policy if exists mechanical_work_items_read on public.mechanical_work_items;
create policy mechanical_work_items_read on public.mechanical_work_items for select to authenticated
using(public.has_handover_module_access('mechanical'));
drop policy if exists mechanical_work_items_insert on public.mechanical_work_items;
create policy mechanical_work_items_insert on public.mechanical_work_items for insert to authenticated
with check(public.has_handover_module_access('mechanical') and public.can_manage_mechanical_work_options() and created_by=public.active_user_id());
drop policy if exists mechanical_work_items_update on public.mechanical_work_items;
create policy mechanical_work_items_update on public.mechanical_work_items for update to authenticated
using(public.has_handover_module_access('mechanical') and public.can_manage_mechanical_work_options())
with check(public.has_handover_module_access('mechanical') and public.can_manage_mechanical_work_options() and updated_by=public.active_user_id());

comment on table public.mechanical_work_categories is '機電交接工作分類主檔；is_active=false 表示畫面刪除但保留稽核';
comment on table public.mechanical_work_items is '機電交接常用工作項目主檔；is_active=false 表示畫面刪除但保留稽核';

commit;
