-- ============================================================
-- 設備生命週期主檔 / 保養 / 履歷 / 文件 / 成本 / 中央監控介接
-- 臺北農產運銷股份有限公司 第一果菜市場
-- Version 1.0 | idempotent，可重複於 Supabase SQL Editor 執行
--
-- 設計原則：
--   1. equipment.equipment_id 是全系統唯一設備主鍵。
--   2. asset_code 是人員可辨識且不可重複的設備編號。
--   3. 巡檢、報修、派工、保養、文件、成本與監控點位只保存 equipment_id。
--   4. 中央監控原始高頻歷史值不寫入本系統；本系統保存點位定義、最新值與事件。
-- ============================================================

begin;

-- ── 1. 擴充既有設備主檔（對應「設備總表」34 欄）────────────
alter table equipment add column if not exists asset_code text;
alter table equipment add column if not exists floor text;
alter table equipment add column if not exists photo_url text;
alter table equipment add column if not exists department text;
alter table equipment add column if not exists manufactured_year int;
alter table equipment add column if not exists installed_on date;
alter table equipment add column if not exists accepted_on date;
alter table equipment add column if not exists voltage text;
alter table equipment add column if not exists power_kw numeric(12,3);
alter table equipment add column if not exists original_manufacturer text;
alter table equipment add column if not exists original_contact text;
alter table equipment add column if not exists original_phone text;
alter table equipment add column if not exists distributor text;
alter table equipment add column if not exists distributor_contact text;
alter table equipment add column if not exists distributor_phone text;
alter table equipment add column if not exists warranty_from date;
alter table equipment add column if not exists has_maintenance_contract boolean default false;
alter table equipment add column if not exists maintenance_vendor text;
alter table equipment add column if not exists maintenance_cycle text;
alter table equipment add column if not exists last_maintenance_on date;
alter table equipment add column if not exists next_maintenance_on date;
alter table equipment add column if not exists responsible_user_id uuid references users(user_id);
alter table equipment add column if not exists responsible_name text;
alter table equipment add column if not exists emergency_phone text;
alter table equipment add column if not exists operation_manual_url text;
alter table equipment add column if not exists maintenance_manual_url text;
alter table equipment add column if not exists circuit_diagram_url text;
alter table equipment add column if not exists plc_program_url text;
alter table equipment add column if not exists remarks text;
alter table equipment add column if not exists criticality text default 'medium';
alter table equipment add column if not exists central_monitoring_enabled boolean default false;
alter table equipment add column if not exists external_master_key text;
alter table equipment add column if not exists updated_at timestamptz default now();
alter table equipment add column if not exists updated_by uuid references users(user_id);

-- work_order_schema.sql 已建立的欄位仍在此補齊，確保本檔可獨立重跑。
alter table equipment add column if not exists category text;
alter table equipment add column if not exists brand text;
alter table equipment add column if not exists model text;
alter table equipment add column if not exists serial_no text;
alter table equipment add column if not exists warranty_until date;
alter table equipment add column if not exists service_life_y int;
alter table equipment add column if not exists manual_url text;
alter table equipment add column if not exists location_id uuid references locations(location_id);

update equipment
set asset_code = coalesce(nullif(asset_code,''), nullif(qr_code,''), 'EQ-' || left(equipment_id::text,8))
where asset_code is null or asset_code='';

alter table equipment alter column asset_code set not null;
create unique index if not exists uq_equipment_asset_code on equipment(asset_code);
create index if not exists idx_equipment_floor on equipment(floor);
create index if not exists idx_equipment_category on equipment(category);
create index if not exists idx_equipment_next_maintenance on equipment(next_maintenance_on);
create index if not exists idx_equipment_external_master on equipment(external_master_key);

-- ── 2. 預防保養計畫（對應「保養排程」）───────────────────
create table if not exists equipment_maintenance_plans (
  plan_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  item_name text not null,
  maintenance_type text not null default 'preventive'
    check (maintenance_type in ('preventive','predictive','statutory','condition_based','other')),
  cycle_text text,
  interval_value numeric(12,2),
  interval_unit text check (interval_unit is null or interval_unit in ('day','week','month','year','hour','count')),
  responsible_user_id uuid references users(user_id),
  responsible_name text,
  contract_id uuid,
  checklist_template jsonb not null default '[]'::jsonb,
  trigger_point_code text,
  last_performed_on date,
  next_due_on date,
  last_completed_on date,
  last_result text,
  status text not null default 'active' check (status in ('active','paused','inactive')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id)
);
create unique index if not exists uq_eq_maintenance_plan_item
  on equipment_maintenance_plans(equipment_id,item_name);
create index if not exists idx_eq_maintenance_plan_due
  on equipment_maintenance_plans(next_due_on,status);

-- ── 3. 設備履歷（保養、維修與既有派工單可相互追溯）──────
create table if not exists equipment_maintenance_records (
  record_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  plan_id uuid references equipment_maintenance_plans(plan_id),
  source_order_id uuid references maintenance_orders(order_id),
  record_type text not null default 'maintenance'
    check (record_type in ('maintenance','repair','inspection_followup','overhaul','replacement','other')),
  performed_on date not null default current_date,
  fault_description text,
  fault_cause text,
  action_taken text,
  replacement_parts text,
  downtime_hours numeric(12,2),
  technician text,
  result text,
  maintenance_cost numeric(14,2) not null default 0,
  parts_cost numeric(14,2) not null default 0,
  downtime_loss numeric(14,2) not null default 0,
  next_due_on date,
  import_key text,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references users(user_id)
);
alter table equipment_maintenance_records add column if not exists import_key text;
create unique index if not exists uq_eq_maintenance_record_import
  on equipment_maintenance_records(import_key);
create index if not exists idx_eq_maintenance_record_equipment_date
  on equipment_maintenance_records(equipment_id,performed_on desc);

-- ── 4. 保養合約（對應「保養合約」）──────────────────────
create table if not exists equipment_contracts (
  contract_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  vendor text not null,
  contact_name text,
  contact_phone text,
  contract_no text,
  starts_on date,
  ends_on date,
  service_scope text,
  sla_hours numeric(10,2),
  contract_amount numeric(14,2),
  status text not null default 'active' check (status in ('draft','active','expired','terminated','inactive')),
  import_key text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id)
);
alter table equipment_contracts add column if not exists import_key text;
create index if not exists idx_eq_contract_equipment_end
  on equipment_contracts(equipment_id,ends_on);
create unique index if not exists uq_eq_contract_import on equipment_contracts(import_key);

alter table equipment_maintenance_plans
  drop constraint if exists equipment_maintenance_plans_contract_id_fkey;
alter table equipment_maintenance_plans
  add constraint equipment_maintenance_plans_contract_id_fkey
  foreign key (contract_id) references equipment_contracts(contract_id)
  not valid;
alter table equipment_maintenance_plans
  validate constraint equipment_maintenance_plans_contract_id_fkey;

-- ── 5. 設備文件（對應「文件管理」，只存 Storage/受控文件 URL）
create table if not exists equipment_documents (
  document_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  document_type text not null
    check (document_type in ('operation_manual','maintenance_manual','parts_manual','circuit_diagram','plc_program','parameter_backup','photo','certificate','contract','other')),
  title text not null,
  file_url text not null,
  version text,
  checksum text,
  effective_on date,
  expires_on date,
  is_current boolean not null default true,
  import_key text,
  note text,
  created_at timestamptz not null default now(),
  uploaded_by uuid references users(user_id)
);
alter table equipment_documents add column if not exists import_key text;
create unique index if not exists uq_eq_document_current
  on equipment_documents(equipment_id,document_type,title)
  where is_current=true;
create index if not exists idx_eq_document_equipment
  on equipment_documents(equipment_id,document_type);
create unique index if not exists uq_eq_document_import on equipment_documents(import_key);

-- ── 6. 年度成本彙總（匯入用；明細成本仍以 cost_records 為準）─
create table if not exists equipment_annual_costs (
  annual_cost_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  fiscal_year int not null check (fiscal_year between 2000 and 2200),
  repair_cost numeric(14,2) not null default 0,
  maintenance_cost numeric(14,2) not null default 0,
  parts_cost numeric(14,2) not null default 0,
  downtime_loss numeric(14,2) not null default 0,
  source text not null default 'import' check (source in ('import','manual','calculated')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  constraint uq_eq_annual_cost unique(equipment_id,fiscal_year,source)
);
create index if not exists idx_eq_annual_cost_year on equipment_annual_costs(fiscal_year);

-- ── 7. 外部系統設備對照（中央監控/BMS/SCADA/IoT/API）───────
create table if not exists equipment_external_links (
  link_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  external_system text not null,
  external_equipment_key text not null,
  protocol text not null default 'rest'
    check (protocol in ('rest','mqtt','opcua','bacnet','modbus_tcp','modbus_rtu','snmp','database','file','other')),
  sync_mode text not null default 'event'
    check (sync_mode in ('event','poll','manual','bidirectional')),
  source_of_truth text not null default 'equipment_system'
    check (source_of_truth in ('equipment_system','external_system','shared')),
  endpoint_alias text,
  config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_sync_status text,
  last_error text,
  status text not null default 'active' check (status in ('active','paused','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(user_id),
  updated_by uuid references users(user_id),
  constraint uq_external_equipment_key unique(external_system,external_equipment_key)
);
create index if not exists idx_external_links_equipment on equipment_external_links(equipment_id);

-- ── 8. 中央監控點位目錄與最新狀態 ─────────────────────────
create table if not exists equipment_monitor_points (
  point_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  link_id uuid references equipment_external_links(link_id),
  point_code text not null,
  point_name text not null,
  point_address text,
  data_type text not null default 'number'
    check (data_type in ('boolean','integer','number','string','enum','json')),
  unit text,
  access_mode text not null default 'read' check (access_mode in ('read','write','read_write')),
  sampling_seconds int,
  normal_min numeric,
  normal_max numeric,
  alarm_low numeric,
  alarm_high numeric,
  enum_map jsonb not null default '{}'::jsonb,
  last_value jsonb,
  last_quality text,
  last_seen_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_equipment_point_code unique(equipment_id,point_code)
);
create index if not exists idx_monitor_points_link on equipment_monitor_points(link_id);
create index if not exists idx_monitor_points_seen on equipment_monitor_points(last_seen_at desc);

-- 告警/狀態事件：保存可稽核事件，不保存秒級或毫秒級原始歷史值。
create table if not exists equipment_monitor_events (
  event_id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(equipment_id),
  point_id uuid references equipment_monitor_points(point_id),
  external_system text,
  external_event_key text,
  event_code text,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  event_state text not null default 'open' check (event_state in ('open','acknowledged','resolved','suppressed')),
  title text not null,
  message text,
  value jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(user_id),
  resolved_at timestamptz,
  repair_request_id uuid references repair_requests(request_id),
  raw_payload jsonb,
  constraint uq_monitor_event_external unique(external_system,external_event_key)
);
create index if not exists idx_monitor_events_equipment_time
  on equipment_monitor_events(equipment_id,occurred_at desc);
create index if not exists idx_monitor_events_open
  on equipment_monitor_events(event_state,severity,occurred_at desc);

-- ── 9. 統一更新時間 ───────────────────────────────────────
create or replace function set_equipment_lifecycle_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_equipment_updated_at on equipment;
create trigger trg_equipment_updated_at before update on equipment
  for each row execute function set_equipment_lifecycle_updated_at();
drop trigger if exists trg_eq_maintenance_plan_updated_at on equipment_maintenance_plans;
create trigger trg_eq_maintenance_plan_updated_at before update on equipment_maintenance_plans
  for each row execute function set_equipment_lifecycle_updated_at();
drop trigger if exists trg_eq_contract_updated_at on equipment_contracts;
create trigger trg_eq_contract_updated_at before update on equipment_contracts
  for each row execute function set_equipment_lifecycle_updated_at();
drop trigger if exists trg_eq_annual_cost_updated_at on equipment_annual_costs;
create trigger trg_eq_annual_cost_updated_at before update on equipment_annual_costs
  for each row execute function set_equipment_lifecycle_updated_at();
drop trigger if exists trg_eq_external_link_updated_at on equipment_external_links;
create trigger trg_eq_external_link_updated_at before update on equipment_external_links
  for each row execute function set_equipment_lifecycle_updated_at();
drop trigger if exists trg_eq_monitor_point_updated_at on equipment_monitor_points;
create trigger trg_eq_monitor_point_updated_at before update on equipment_monitor_points
  for each row execute function set_equipment_lifecycle_updated_at();

-- ── 10. RLS：沿用目前開發政策；正式介接時改為專屬 service role ──
alter table equipment_maintenance_plans enable row level security;
alter table equipment_maintenance_records enable row level security;
alter table equipment_contracts enable row level security;
alter table equipment_documents enable row level security;
alter table equipment_annual_costs enable row level security;
alter table equipment_external_links enable row level security;
alter table equipment_monitor_points enable row level security;
alter table equipment_monitor_events enable row level security;

drop policy if exists "allow_all_for_now" on equipment_maintenance_plans;
drop policy if exists "allow_all_for_now" on equipment_maintenance_records;
drop policy if exists "allow_all_for_now" on equipment_contracts;
drop policy if exists "allow_all_for_now" on equipment_documents;
drop policy if exists "allow_all_for_now" on equipment_annual_costs;
drop policy if exists "allow_all_for_now" on equipment_external_links;
drop policy if exists "allow_all_for_now" on equipment_monitor_points;
drop policy if exists "allow_all_for_now" on equipment_monitor_events;
drop policy if exists "authenticated_only" on equipment_maintenance_plans;
drop policy if exists "authenticated_only" on equipment_maintenance_records;
drop policy if exists "authenticated_only" on equipment_contracts;
drop policy if exists "authenticated_only" on equipment_documents;
drop policy if exists "authenticated_only" on equipment_annual_costs;
drop policy if exists "authenticated_only" on equipment_external_links;
drop policy if exists "authenticated_only" on equipment_monitor_points;
drop policy if exists "authenticated_only" on equipment_monitor_events;
create policy "authenticated_only" on equipment_maintenance_plans for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_maintenance_records for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_contracts for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_documents for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_annual_costs for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_external_links for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_monitor_points for all to authenticated using (true) with check (true);
create policy "authenticated_only" on equipment_monitor_events for all to authenticated using (true) with check (true);

-- ── 11. 查詢檢視：設備生命週期、年度成本、監控介接清冊 ─────
create or replace view equipment_lifecycle_overview as
select
  e.equipment_id,e.asset_code,e.name,e.category,e.floor,e.location,e.department,
  e.brand,e.model,e.status,e.criticality,e.warranty_until,e.next_maintenance_on,
  count(distinct p.plan_id) filter (where p.status='active') as active_plan_count,
  count(distinct p.plan_id) filter (where p.status='active' and p.next_due_on < current_date) as overdue_plan_count,
  count(distinct c.contract_id) filter (where c.status='active') as active_contract_count,
  count(distinct l.link_id) filter (where l.status='active') as active_external_link_count,
  max(mp.last_seen_at) as last_monitor_seen_at
from equipment e
left join equipment_maintenance_plans p on p.equipment_id=e.equipment_id
left join equipment_contracts c on c.equipment_id=e.equipment_id
left join equipment_external_links l on l.equipment_id=e.equipment_id
left join equipment_monitor_points mp on mp.equipment_id=e.equipment_id
group by e.equipment_id;

create or replace view equipment_annual_cost_summary as
select e.equipment_id,e.asset_code,e.name,a.fiscal_year,
       sum(a.repair_cost) repair_cost,
       sum(a.maintenance_cost) maintenance_cost,
       sum(a.parts_cost) parts_cost,
       sum(a.downtime_loss) downtime_loss,
       sum(a.repair_cost+a.maintenance_cost+a.parts_cost+a.downtime_loss) total_cost
from equipment_annual_costs a
join equipment e on e.equipment_id=a.equipment_id
group by e.equipment_id,e.asset_code,e.name,a.fiscal_year;

create or replace view equipment_central_monitoring_registry as
select e.equipment_id,e.asset_code,e.name,e.floor,e.location,
       l.link_id,l.external_system,l.external_equipment_key,l.protocol,l.sync_mode,
       l.source_of_truth,l.last_sync_at,l.last_sync_status,l.status as link_status,
       count(p.point_id) as point_count,max(p.last_seen_at) as last_seen_at
from equipment e
join equipment_external_links l on l.equipment_id=e.equipment_id
left join equipment_monitor_points p on p.link_id=l.link_id and p.status='active'
group by e.equipment_id,l.link_id;

-- 若已套用永久資料保護，將新生命週期表一併納入禁止 DELETE/TRUNCATE。
do $$
declare t text;
begin
  if to_regprocedure('reject_physical_data_removal()') is not null then
    foreach t in array array[
      'equipment_maintenance_plans','equipment_maintenance_records','equipment_contracts',
      'equipment_documents','equipment_annual_costs','equipment_external_links',
      'equipment_monitor_points','equipment_monitor_events'
    ] loop
      execute format('drop trigger if exists trg_prevent_removal on public.%I',t);
      execute format('create trigger trg_prevent_removal before delete or truncate on public.%I for each statement execute function reject_physical_data_removal()',t);
    end loop;
  end if;
end $$;

commit;
