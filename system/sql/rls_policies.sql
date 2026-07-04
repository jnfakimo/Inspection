-- ==========================================
-- RLS (Row Level Security) 策略
-- ==========================================

-- 1. USERS 表
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select" ON users;
CREATE POLICY "users_select" ON users
  FOR SELECT USING (
    auth.uid() = auth_id
    OR (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin')
  );

DROP POLICY IF EXISTS "users_modify" ON users;
CREATE POLICY "users_modify" ON users
  FOR INSERT, UPDATE, DELETE USING (
    (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin')
  );

-- 2. EQUIPMENT 表
ALTER TABLE IF EXISTS equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_select" ON equipment;
CREATE POLICY "equipment_select" ON equipment
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "equipment_modify" ON equipment;
CREATE POLICY "equipment_modify" ON equipment
  FOR INSERT, UPDATE, DELETE USING (
    (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin')
  );

-- 3. INSPECTION_RECORDS 表
ALTER TABLE IF EXISTS inspection_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inspection_select" ON inspection_records;
CREATE POLICY "inspection_select" ON inspection_records
  FOR SELECT USING (
    created_by = auth.uid()
    OR (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin')
  );

DROP POLICY IF EXISTS "inspection_insert" ON inspection_records;
CREATE POLICY "inspection_insert" ON inspection_records
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "inspection_update" ON inspection_records;
CREATE POLICY "inspection_update" ON inspection_records
  FOR UPDATE USING (
    created_by = auth.uid()
    OR (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin')
  );

-- 4. REPAIR_REQUESTS 表
ALTER TABLE IF EXISTS repair_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "repair_select" ON repair_requests;
CREATE POLICY "repair_select" ON repair_requests
  FOR SELECT USING (
    created_by = auth.uid()
    OR (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin', 'dispatcher')
  );

DROP POLICY IF EXISTS "repair_insert" ON repair_requests;
CREATE POLICY "repair_insert" ON repair_requests
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "repair_update" ON repair_requests;
CREATE POLICY "repair_update" ON repair_requests
  FOR UPDATE USING (
    (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin', 'dispatcher')
  );

-- 5. MAINTENANCE_ORDERS 表
ALTER TABLE IF EXISTS maintenance_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maintenance_select" ON maintenance_orders;
CREATE POLICY "maintenance_select" ON maintenance_orders
  FOR SELECT USING (
    assignee_id = auth.uid()
    OR (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin', 'dispatcher')
  );

DROP POLICY IF EXISTS "maintenance_modify" ON maintenance_orders;
CREATE POLICY "maintenance_modify" ON maintenance_orders
  FOR INSERT, UPDATE, DELETE USING (
    (SELECT rbac_role FROM users WHERE auth_id = auth.uid()) IN ('sysadmin', 'admin', 'dispatcher')
  );
