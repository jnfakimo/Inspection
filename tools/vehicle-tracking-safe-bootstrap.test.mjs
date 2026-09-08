import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const fixture = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.role() returns text language sql stable as $$select current_user::text$$;
create table users(user_id uuid primary key, status text default 'active',role text default 'admin',rbac_role text default 'sysadmin');
create table official_vehicles(vehicle_id uuid primary key);
create table vehicle_dispatch_requests(request_id uuid primary key);
create table vehicle_dispatch_managers(user_id uuid references users, active boolean);
create table roles(role_id text primary key);
create table role_permissions(role_id text,perm text,allowed boolean,primary key(role_id,perm));
create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
create function has_system_access(text) returns boolean language sql stable as $$select current_setting('test.access',true)='yes'$$;
create function is_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='yes'$$;
create function has_app_permission(text) returns boolean language sql stable as $$select false$$;
create function reject_physical_data_removal() returns trigger language plpgsql as $$begin raise exception '禁止刪除'; end$$;
insert into users(user_id) values('00000000-0000-0000-0000-000000000001');
select set_config('test.user','00000000-0000-0000-0000-000000000001',false);
select set_config('test.access','yes',false),set_config('test.admin','yes',false);
`;
export const safeSchema = readFileSync(new URL('../supabase/migrations/20260908212000_vehicle_tracking_safe_bootstrap.sql',import.meta.url),'utf8');
const sql = safeSchema.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\r\n]*/g,'');
assert.doesNotMatch(sql,/\bdrop\s+table\b|\bdelete\s+from\b|\btruncate\s+(?!on\b)/i);
assert.doesNotMatch(sql,/purge_expired|insert into role_permissions/i);
const db=new PGlite();
try {
  await db.exec(fixture);
  await db.exec(safeSchema); await db.exec(safeSchema);
  const tables=['vehicle_tracking_devices','vehicle_tracking_sessions','vehicle_location_points','vehicle_location_daily_summaries','vehicle_geofences','vehicle_tracking_events'];
  for(const table of tables){
    assert.equal((await db.query('select relrowsecurity from pg_class where relname=$1',[table])).rows[0].relrowsecurity,true);
    await assert.rejects(db.exec(`delete from ${table}`),/禁止刪除/);
    await assert.rejects(db.exec(`truncate ${table} cascade`),/禁止刪除/);
  }
  assert.equal((await db.query('select count(*)::int as n from role_permissions')).rows[0].n,0);
  await db.exec(`set role anon`);
  await assert.rejects(db.exec('select * from vehicle_tracking_devices'),/permission denied/);
  await db.exec(`reset role; set role authenticated; select set_config('test.access','no',false)`);
  assert.equal((await db.query('select count(*)::int as n from vehicle_tracking_devices')).rows[0].n,0);
  assert.equal((await db.query('select can_manage_vehicle_tracking() as allowed')).rows[0].allowed,false);
  await db.exec(`select set_config('test.access','yes',false),set_config('test.admin','no',false)`);
  assert.equal((await db.query('select can_manage_vehicle_tracking() as allowed')).rows[0].allowed,false);
  await db.exec(`reset role; insert into vehicle_dispatch_managers values('00000000-0000-0000-0000-000000000001',true); set role authenticated`);
  assert.equal((await db.query('select can_manage_vehicle_tracking() as allowed')).rows[0].allowed,true);
  console.log('安全建表檢查通過：冪等、六表永久保護、匿名拒絕、系統存取與車隊管理權限。');
} finally {await db.close();}
