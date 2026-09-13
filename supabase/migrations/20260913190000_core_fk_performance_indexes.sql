-- 核心外鍵效能索引優化
-- 針對高頻查詢、JOIN 與外鍵關聯篩選欄位建立索引，避免全表掃描並提升報表與統計效能

-- 設備成本與報修/工單關聯
create index if not exists idx_cost_records_equipment_id on cost_records(equipment_id);
create index if not exists idx_cost_records_order_id on cost_records(order_id);

-- 設備與場域位置關聯
create index if not exists idx_equipment_location_id on equipment(location_id);

-- 組織部門樹狀階層
create index if not exists idx_departments_parent_id on departments(parent_id);

-- 報修案件關聯
create index if not exists idx_repair_requests_equipment_id on repair_requests(equipment_id);
create index if not exists idx_repair_requests_location_id on repair_requests(location_id);

-- 維修派工與報修/設備關聯
create index if not exists idx_maintenance_orders_request_id on maintenance_orders(request_id);
create index if not exists idx_maintenance_orders_equipment_id on maintenance_orders(equipment_id);
