-- ============================================================
-- 永久資料保護遷移
-- 目的：正式資料只可新增、修改或停用，不可實體刪除或清空。
-- 本檔只增加保護與歷程，不會重建資料表、不會改寫既有人員。
-- ============================================================

begin;

-- 人員異動快照：保留每次新增與修改後的完整資料。
create table if not exists users_history (
  history_id bigserial primary key,
  user_id uuid not null,
  operation text not null check (operation in ('baseline','insert','update')),
  snapshot jsonb not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create index if not exists idx_users_history_user_time
  on users_history(user_id, changed_at desc);

alter table users_history enable row level security;
drop policy if exists "users_history_select" on users_history;
create policy "users_history_select" on users_history for select using (is_admin());

create or replace function save_users_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into users_history(user_id,operation,snapshot,changed_by)
  values (new.user_id,lower(tg_op),to_jsonb(new),auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_users_history on users;
create trigger trg_users_history
  after insert or update on users
  for each row execute function save_users_history();

-- 為目前既有人員建立一次基準快照；重跑時不重複建立。
insert into users_history(user_id,operation,snapshot,changed_by)
select u.user_id,'baseline',to_jsonb(u),auth.uid()
from users u
where not exists (
  select 1 from users_history h
  where h.user_id=u.user_id and h.operation='baseline'
);

-- 資料庫層禁止 DELETE/TRUNCATE。需移除資料時一律改 status='inactive'。
create or replace function reject_physical_data_removal()
returns trigger
language plpgsql
as $$
begin
  raise exception '永久資料保護：資料表 % 禁止 DELETE/TRUNCATE，請改用狀態停用。', tg_table_name
    using errcode = '55000';
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users','equipment','departments','locations','floor_spaces','plan_markers','materials',
    'inspection_cycles','inspection_records','repair_requests','maintenance_orders',
    'cost_records','audit_logs','handover_records','handover_cases',
    'handover_case_logs','handover_case_attachments','checkin_logs',
    'patrol_shift_template','patrol_shifts',
    'dashboard_layouts','dashboard_layout_versions','dashboard_layout_items',
    'weather_api_cache',
    'equipment_maintenance_plans','equipment_maintenance_records','equipment_contracts',
    'equipment_documents','equipment_annual_costs','equipment_external_links',
    'equipment_monitor_points','equipment_monitor_events',
    'official_vehicles','vehicle_dispatch_managers','vehicle_dispatch_requests','vehicle_dispatch_logs','vehicle_dispatch_attachments'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists trg_prevent_removal on public.%I', table_name);
      execute format(
        'create trigger trg_prevent_removal before delete or truncate on public.%I '
        'for each statement execute function reject_physical_data_removal()',
        table_name
      );
    end if;
  end loop;
end $$;

-- 即使舊 RLS 曾允許管理者刪除人員，也在此明確移除。
drop policy if exists "users_admin_delete" on users;

commit;
