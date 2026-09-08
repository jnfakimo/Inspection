import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.PGLITE_MODULE_URL || '@electric-sql/pglite');

const schema = readFileSync(new URL('../system/sql/vehicle_tracking.sql', import.meta.url), 'utf8');
assert.match(schema, /s\.session_id=vehicle_location_points\.session_id/,
  '定位點寫入權限必須明確比對外層勤務編號');
assert.match(schema, /s\.session_id=vehicle_tracking_events\.session_id/,
  '藍牙事件寫入權限必須明確比對外層勤務編號');
const db = new PGlite();

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
    create table public.users(user_id uuid primary key, name text);
    create table public.official_vehicles(vehicle_id uuid primary key, plate_no text, vehicle_name text, status text);
    create table public.vehicle_dispatch_requests(request_id uuid primary key);
    create table public.roles(role_id text primary key);
    create table public.role_permissions(role_id text references public.roles(role_id),perm text,allowed boolean,primary key(role_id,perm));
    create function public.has_system_access(text) returns boolean language sql stable as $$ select true $$;
    create function public.has_app_permission(text) returns boolean language sql stable as $$ select true $$;
    create function public.is_admin() returns boolean language sql stable as $$ select true $$;
    create function public.active_user_id() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create function public.reject_physical_data_removal() returns trigger language plpgsql as $$ begin raise exception '禁止刪除'; end $$;
    insert into public.roles values('reporter');
    insert into public.users values('00000000-0000-0000-0000-000000000001','測試駕駛');
    insert into public.official_vehicles values('00000000-0000-0000-0000-000000000010','TEST-01','測試車','active');
  `);
  await db.exec(schema);

  await db.exec(`
    insert into public.vehicle_tracking_devices(device_id,vehicle_id,display_name,device_fingerprint,verification_status)
    values('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','測試標籤','test-tag','verified');
    select bind_vehicle_tracking_ble_device(
      '00000000-0000-0000-0000-000000000020','android','ble-platform-test','測試廣播名稱','0000180f-0000-1000-8000-00805f9b34fb'
    );
    insert into public.vehicle_tracking_sessions(session_id,vehicle_id,device_id,driver_id,platform)
    values('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','simulator');
    insert into public.vehicle_geofences(geofence_id,name,center_latitude,center_longitude,radius_m,created_by)
    values('00000000-0000-0000-0000-000000000040','測試圍籬',25,121,100,'00000000-0000-0000-0000-000000000001');
    insert into public.vehicle_location_points(client_event_id,session_id,vehicle_id,device_id,recorded_by,recorded_at,latitude,longitude,speed_kmh,source)
    values
      ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','2026-09-08T10:00:00+08:00',24.998,121,20,'simulator'),
      ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','2026-09-08T10:10:00+08:00',25,121,20,'simulator');
  `);

  const binding = (await db.query(`select platform_identifiers->>'android' as identifier,advertised_name,service_uuid from vehicle_tracking_devices`)).rows[0];
  assert.deepEqual(binding, {
    identifier: 'ble-platform-test',
    advertised_name: '測試廣播名稱',
    service_uuid: '0000180f-0000-1000-8000-00805f9b34fb',
  });

  const summary = (await db.query(`select point_count,distance_km::float8 as distance_km,moving_minutes,data_gap_count from vehicle_location_daily_summaries`)).rows[0];
  assert.equal(summary.point_count, 2);
  assert.ok(summary.distance_km > 0.2 && summary.distance_km < 0.25);
  assert.equal(summary.moving_minutes, 10);
  assert.equal(summary.data_gap_count, 1);

  await db.exec(`
    insert into public.vehicle_location_points(client_event_id,session_id,vehicle_id,device_id,recorded_by,recorded_at,latitude,longitude,speed_kmh,source)
    values('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','2026-09-09T00:01:00+08:00',25.1,121,20,'simulator');
  `);
  const nextDay = (await db.query(`select point_count,distance_km::float8 as distance_km,moving_minutes,data_gap_count from vehicle_location_daily_summaries where summary_date='2026-09-09'`)).rows[0];
  assert.deepEqual(nextDay, { point_count: 1, distance_km: 0, moving_minutes: 0, data_gap_count: 0 });

  const events = (await db.query(`select event_type,title from vehicle_tracking_events order by occurred_at`)).rows;
  assert.deepEqual(events, [
    { event_type: 'geofence_enter', title: '車輛進入電子圍籬' },
    { event_type: 'geofence_exit', title: '車輛離開電子圍籬' },
  ]);
  const device = (await db.query(`select last_latitude,last_longitude,last_speed_kmh from vehicle_tracking_devices`)).rows[0];
  assert.equal(device.last_latitude, 25.1);
  assert.equal(device.last_longitude, 121);
  assert.equal(device.last_speed_kmh, 20);

  const stale = (await db.query(`select detect_stale_vehicle_tracking('2026-09-09T01:00:00+08:00') as count`)).rows[0];
  assert.equal(stale.count, 1);
  assert.equal((await db.query(`select count(*)::int as count from vehicle_tracking_events where event_type='location_stale'`)).rows[0].count, 1);

  await assert.rejects(
    db.exec(`insert into vehicle_location_points(client_event_id,session_id,vehicle_id,device_id,recorded_by,recorded_at,latitude,longitude,source)
      values('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001',now(),25,121,'simulator')`),
    /unique|duplicate/i,
  );
  console.log('公務車定位資料庫檢查通過：建表、定位更新、臺北時區跨日摘要、圍籬事件、逾時告警與離線補傳去重。');
} finally {
  await db.close();
}
