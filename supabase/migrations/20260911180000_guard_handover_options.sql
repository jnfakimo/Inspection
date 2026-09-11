begin;

-- 駐衛警交接簿下拉選單清單（2026-09-11）：異常事件類別、物品狀態、物品名稱、事件地點、通報對象。
-- * 填寫交接時一律可自行輸入清單以外的文字；這張表只管「清單本身」。
-- * 維護權限：主管簽核權限（handover/guard-approve 須明確允許）與系統管理員，寫入只走 app-api。
-- * 改名或刪除只影響之後的選擇：交接紀錄存的是當時的文字，不回頭改歷史資料。刪除採停用（軟刪除），
--   停用後不可復用同一筆，要恢復請重新新增（稽核紀錄才看得出先刪後加）。

create table if not exists public.guard_handover_options (
  option_id uuid primary key default gen_random_uuid(),
  list_key text not null,
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.users(user_id),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists(select 1 from pg_constraint where conname='guard_option_list_check' and conrelid='public.guard_handover_options'::regclass) then
    alter table public.guard_handover_options add constraint guard_option_list_check
      check(list_key in ('incident_category','item_condition','item_name','location','reported_to'));
  end if;
  if not exists(select 1 from pg_constraint where conname='guard_option_label_check' and conrelid='public.guard_handover_options'::regclass) then
    alter table public.guard_handover_options add constraint guard_option_label_check
      check(char_length(label) between 1 and 40 and label=btrim(label));
  end if;
end $$;
create unique index if not exists idx_guard_handover_options_active_label on public.guard_handover_options(list_key,lower(label)) where is_active;
create index if not exists idx_guard_handover_options_list on public.guard_handover_options(list_key,sort_order) where is_active;

-- 預設清單只在該清單完全沒有資料時補上，重跑 migration 不會把使用者刪掉的選項加回來。
insert into public.guard_handover_options(list_key,label,sort_order)
select v.list_key,v.label,v.sort_order from (values
  ('incident_category','門禁管制',10),('incident_category','可疑人車',20),('incident_category','竊盜',30),('incident_category','火警／煙霧',40),
  ('incident_category','設備故障',50),('incident_category','漏水／停電',60),('incident_category','交通事故',70),('incident_category','民眾糾紛',80),
  ('incident_category','急救傷病',90),('incident_category','其他',100),
  ('item_condition','正常',10),('item_condition','短少',20),('item_condition','損壞',30),('item_condition','遺失',40),
  ('item_name','無線電對講機',10),('item_name','手電筒',20),('item_name','警棍',30),('item_name','鑰匙（串）',40),('item_name','門禁磁卡',50),
  ('reported_to','指揮台',10),('reported_to','總務課',20),('reported_to','機電課',30),('reported_to','業管組',40),('reported_to','110',50),('reported_to','119',60)
) as v(list_key,label,sort_order)
where not exists(select 1 from public.guard_handover_options o where o.list_key=v.list_key);

create or replace function public.protect_guard_handover_option()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    if new.option_id is distinct from old.option_id or new.list_key is distinct from old.list_key
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception using errcode='23514',message='guard handover option identity fields are immutable';
    end if;
    if not old.is_active and new.is_active then
      raise exception using errcode='23514',message='deactivated guard handover option cannot be reactivated; add it again';
    end if;
  else
    new.is_active:=true; new.created_at:=now();
  end if;
  new.updated_at:=now();
  return new;
end
$$;
revoke all on function public.protect_guard_handover_option() from public,anon,authenticated;
drop trigger if exists trg_protect_guard_handover_option on public.guard_handover_options;
create trigger trg_protect_guard_handover_option before insert or update on public.guard_handover_options
  for each row execute function public.protect_guard_handover_option();

drop trigger if exists trg_prevent_removal on public.guard_handover_options;
create trigger trg_prevent_removal before delete or truncate on public.guard_handover_options
  for each statement execute function public.reject_physical_data_removal();

alter table public.guard_handover_options enable row level security;
alter table public.guard_handover_options force row level security;
revoke all on public.guard_handover_options from anon,authenticated;
grant select on public.guard_handover_options to authenticated;
grant select,insert,update on public.guard_handover_options to service_role;
drop policy if exists guard_handover_options_read on public.guard_handover_options;
create policy guard_handover_options_read on public.guard_handover_options for select to authenticated
  using(public.has_handover_module_access('guard') or public.has_handover_module_access('guard-approve'));

comment on table public.guard_handover_options is '駐衛警交接簿下拉選單清單；填寫時可自行輸入清單外文字，清單由主管與系統管理員經 app-api 維護';

notify pgrst, 'reload schema';

commit;
