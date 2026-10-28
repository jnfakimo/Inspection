import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const extract = (sql, pattern, label) => {
  const match = sql.match(pattern);
  assert.ok(match, `找不到 ${label}`);
  return match[0];
};

// 既有線上 guard 原樣載入，確認直接派車沒有繞過它們。
const assignmentGuard = extract(read('20260804163000_vehicle_dispatch_drivers.sql'),
  /create or replace function guard_vehicle_dispatch_assignment_and_driver\(\)[\s\S]*?\n\$\$;/, '派車管理員與司機 guard');
const timeGuard = extract(read('20260805162000_vehicle_handover_time_guards.sql'),
  /create or replace function guard_vehicle_dispatch_time_window\(\)[\s\S]*?\n\$\$;/, '預計時段 guard');
const migration = read('20261028090000_vehicle_direct_dispatch.sql');

const ids = {
  manager: '00000000-0000-0000-0000-000000000001',
  applicant: '00000000-0000-0000-0000-000000000002',
  driver: '00000000-0000-0000-0000-000000000003',
  stranger: '00000000-0000-0000-0000-000000000004',
  sysadmin: '00000000-0000-0000-0000-000000000005',
  authManager: '10000000-0000-0000-0000-000000000001',
  authApplicant: '10000000-0000-0000-0000-000000000002',
  authSysadmin: '10000000-0000-0000-0000-000000000005',
  carA: '20000000-0000-0000-0000-000000000001',
  carB: '20000000-0000-0000-0000-000000000002',
  carOff: '20000000-0000-0000-0000-000000000003',
  normal: '30000000-0000-0000-0000-000000000001',
};

const fixture = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
create table users(
  user_id uuid primary key,auth_id uuid,status text,role text,rbac_role text,name text,username text
);
create table official_vehicles(vehicle_id uuid primary key,plate_no text,status text);
create table vehicle_dispatch_managers(user_id uuid primary key references users(user_id),active boolean);
create table vehicle_dispatch_drivers(user_id uuid primary key references users(user_id),active boolean);
create table vehicle_dispatch_requests(
  request_id uuid primary key default gen_random_uuid(),
  request_no text not null default 'CAR-' || substr(gen_random_uuid()::text,1,8),
  applicant_id uuid not null references users(user_id),
  applicant_name text not null,applicant_department text,applicant_phone text,
  trip_date date not null,planned_departure_time time not null,planned_return_time time not null,
  origin_location text not null,destination_location text not null,trip_purpose text not null,passenger_count integer not null,
  status text not null,
  supervisor_id uuid,approved_at timestamptz,department_manager_id uuid,department_manager_approved_at timestamptz,
  vehicle_manager_id uuid,vehicle_manager_name text,vehicle_id uuid references official_vehicles(vehicle_id),plate_no text,
  driver_id uuid references users(user_id),driver_name text,dispatch_note text,dispatched_at timestamptz,
  driver_accepted_at timestamptz,driver_accepted_by uuid,
  actual_departure_at timestamptz,actual_return_at timestamptz,
  constraint vehicle_dispatch_no_time_overlap exclude using gist (
    vehicle_id with =,
    tsrange(trip_date + planned_departure_time,trip_date + planned_return_time,'[)') with &&
  ) where (status in ('pending_approval','pending_manager_approval','approved','assigned','completed'))
);
create table vehicle_dispatch_logs(
  log_id bigint generated always as identity primary key,request_id uuid,from_status text,to_status text,
  action text,note text,operator_id uuid,operator_name text,created_at timestamptz default now()
);
create function has_system_access(text) returns boolean language sql stable as $$select true$$;
`;

// 與線上一致：approved -> assigned 的核准守門由兩層核准 migration 掛上，這裡只掛 trigger，函式由本次 migration 提供。
const triggers = `
create trigger trg_guard_vehicle_dispatch_assignment_and_driver before update on vehicle_dispatch_requests
  for each row execute function guard_vehicle_dispatch_assignment_and_driver();
create trigger trg_guard_vehicle_dispatch_time_window
  before insert or update of trip_date,planned_departure_time,planned_return_time,status,actual_departure_at,actual_return_at
  on vehicle_dispatch_requests for each row execute function guard_vehicle_dispatch_time_window();
create trigger trg_guard_vehicle_two_level_dispatch before update of status on vehicle_dispatch_requests
  for each row execute function guard_vehicle_two_level_dispatch();
`;

const db = new PGlite({ extensions: { btree_gist } });
const as = auth => db.query(`select set_config('test.auth',$1,false)`, [auth ?? '']);
const count = async () => (await db.query('select count(*)::int as n from vehicle_dispatch_requests')).rows[0].n;
const logCount = async id => (await db.query('select count(*)::int as n from vehicle_dispatch_logs where request_id=$1', [id])).rows[0].n;

const direct = (overrides = {}) => {
  const a = {
    requester: '總經理', department: '總經理室', date: '2030-01-15', from: '10:00', to: '12:00',
    origin: '本場', destination: '農業部', purpose: '臨時公務', passengers: 2,
    reason: '長官臨時急需出席會議', vehicle: ids.carA, driver: ids.driver, phone: '1234', note: '請提前待命',
    ...overrides,
  };
  return db.query(
    `select * from vehicle_direct_dispatch($1,$2,$3::date,$4::time,$5::time,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,$13,$14)`,
    [a.requester, a.department, a.date, a.from, a.to, a.origin, a.destination, a.purpose, a.passengers,
      a.reason, a.vehicle, a.driver, a.phone, a.note],
  );
};

try {
  await db.exec('create extension btree_gist');
  await db.exec(fixture);
  await db.exec(assignmentGuard);
  await db.exec(timeGuard);
  await db.exec(migration);
  await db.exec(triggers);
  await db.query(`insert into users(user_id,auth_id,status,role,rbac_role,name,username) values
    ($1,$6,'active','dispatcher','dispatcher','車管','manager'),
    ($2,$7,'active','reporter','reporter','申請人','applicant'),
    ($3,null,'active','reporter','reporter','司機','driver'),
    ($4,null,'inactive','reporter','reporter','停用司機','gone'),
    ($5,$8,'active','admin','sysadmin','管理員','root')`,
    [ids.manager, ids.applicant, ids.driver, ids.stranger, ids.sysadmin, ids.authManager, ids.authApplicant, ids.authSysadmin]);
  await db.query(`insert into vehicle_dispatch_managers values($1,true)`, [ids.manager]);
  await db.query(`insert into vehicle_dispatch_drivers values($1,true),($2,true)`, [ids.driver, ids.stranger]);
  await db.query(`insert into official_vehicles values($1,'AAA-0001','active'),($2,'BBB-0002','active'),($3,'CCC-0003','maintenance')`,
    [ids.carA, ids.carB, ids.carOff]);

  // 1. 派車管理員可直接建單並派車：免課長與部門經理核准，但留下完整事由與歷程。
  await as(ids.authManager);
  const ok = (await direct()).rows[0];
  assert.equal(ok.status, 'assigned');
  assert.equal(ok.dispatch_source, 'direct');
  assert.equal(ok.applicant_name, '總經理', '用車人應顯示長官而非建單的管理員');
  assert.equal(ok.direct_dispatch_by_name, '車管');
  assert.equal(ok.direct_dispatch_reason, '長官臨時急需出席會議');
  assert.equal(ok.plate_no, 'AAA-0001');
  assert.equal(ok.driver_name, '司機');
  assert.equal(ok.supervisor_id, null);
  assert.equal(ok.department_manager_id, null);
  assert.equal(ok.driver_accepted_at, null, '司機仍須自行接單');
  const logs = (await db.query('select from_status,to_status,action,note from vehicle_dispatch_logs where request_id=$1 order by log_id', [ok.request_id])).rows;
  assert.deepEqual(logs.map(l => l.to_status), ['approved', 'assigned']);
  assert.match(logs[0].action, /臨時直接建單/);
  assert.match(logs[0].note, /總經理.*長官臨時急需出席會議/);

  // 2. 司機仍可接單；其他人不行（既有 guard 照常運作）。
  await db.query(`select set_config('test.auth',$1,false)`, ['10000000-0000-0000-0000-000000000003']);
  await db.query(`update users set auth_id='10000000-0000-0000-0000-000000000003' where user_id=$1`, [ids.driver]);
  await db.query(`update vehicle_dispatch_requests set driver_accepted_at=now() where request_id=$1`, [ok.request_id])
    .then(() => assert.fail('非用車當日不應能接單'), error => assert.match(String(error.message), /司機只能在用車當日接單/));

  // 3. 同車同時段不可重複派：訊息清楚、整筆回滾不留半成品。
  await as(ids.authManager);
  const before = await count();
  await assert.rejects(direct({ from: '11:00', to: '13:00' }), /公務車 AAA-0001 在這個時段已被其他派車單使用/);
  assert.equal(await count(), before, '失敗時不得留下待派車的半成品');
  assert.equal((await direct({ vehicle: ids.carB, from: '11:00', to: '13:00' })).rows[0].plate_no, 'BBB-0002');

  // 4. 必填與資格檢查。
  await assert.rejects(direct({ reason: '   ', date: '2030-02-01' }), /請填寫臨時急用事由/);
  await assert.rejects(direct({ requester: '', date: '2030-02-01' }), /請填寫用車人/);
  await assert.rejects(direct({ from: '12:00', to: '11:00', date: '2030-02-01' }), /回程晚於出發/);
  await assert.rejects(direct({ passengers: 0, date: '2030-02-01' }), /搭乘人數/);
  await assert.rejects(direct({ vehicle: ids.carOff, date: '2030-02-01' }), /目前不可派用/);
  await assert.rejects(direct({ driver: ids.applicant, date: '2030-02-01' }), /尚未被指派為公務車司機/);
  await assert.rejects(direct({ driver: ids.stranger, date: '2030-02-01' }), /尚未被指派為公務車司機/, '停用人員不能當司機');
  await assert.rejects(direct({ date: '2020-01-01' }), /預計出發時間已經過去/, '時間不得是過去，既有 guard 不放寬');

  // 5. 一般申請人不能用這個入口，也不能直接 insert 一張 direct 單。
  await as(ids.authApplicant);
  await assert.rejects(direct({ date: '2030-02-01' }), /只有派車管理員可以直接派車/);
  await assert.rejects(db.query(
    `insert into vehicle_dispatch_requests(applicant_id,applicant_name,trip_date,planned_departure_time,planned_return_time,
       origin_location,destination_location,trip_purpose,passenger_count,status,dispatch_source,direct_dispatch_reason,direct_dispatch_by)
     values($1,'x','2030-03-01','09:00','10:00','a','b','c',1,'approved','direct','自填事由',$1)`, [ids.applicant]),
    /只有派車管理員可以建立臨時直接派車單/);

  // 6. 系統管理員可直接派車。
  await as(ids.authSysadmin);
  assert.equal((await direct({ date: '2030-02-02' })).rows[0].direct_dispatch_by_name, '管理員');

  // 7. 一般單仍須兩層核准：沒走完核准的待派車單不能被派車；直接派車不會替一般單開後門。
  await as(ids.authManager);
  await db.query(`insert into vehicle_dispatch_requests(request_id,applicant_id,applicant_name,trip_date,planned_departure_time,planned_return_time,
    origin_location,destination_location,trip_purpose,passenger_count,status) values($1,$2,'申請人','2030-04-01','09:00','10:00','a','b','c',1,'approved')`,
    [ids.normal, ids.applicant]);
  await assert.rejects(db.query(`update vehicle_dispatch_requests set status='assigned',vehicle_id=$2,driver_id=$3 where request_id=$1`,
    [ids.normal, ids.carA, ids.driver]), /尚未完成核准/);

  // 8. 來源與事由建單後不可改：不能把一般單改成 direct 來借道，也不能把 direct 洗成一般單。
  await assert.rejects(db.query(`update vehicle_dispatch_requests set dispatch_source='direct',direct_dispatch_reason='補寫',direct_dispatch_by=$2 where request_id=$1`,
    [ids.normal, ids.manager]), /建立後不得修改/);
  await assert.rejects(db.query(`update vehicle_dispatch_requests set direct_dispatch_reason='改寫事由' where request_id=$1`, [ok.request_id]), /建立後不得修改/);
  await assert.rejects(db.query(`update vehicle_dispatch_requests set dispatch_source='normal',direct_dispatch_reason=null,direct_dispatch_by=null,direct_dispatch_by_name=null where request_id=$1`, [ok.request_id]), /建立後不得修改/);

  // 9. 資料庫層仍要求 direct 單必須有事由與建單人（即使繞過 RPC 且為受信任端）。
  await as(null);
  await assert.rejects(db.query(
    `insert into vehicle_dispatch_requests(applicant_id,applicant_name,trip_date,planned_departure_time,planned_return_time,
       origin_location,destination_location,trip_purpose,passenger_count,status,dispatch_source)
     values($1,'x','2030-05-01','09:00','10:00','a','b','c',1,'approved','direct')`, [ids.manager]),
    /vehicle_dispatch_source_check/);

  assert.equal(await logCount(ok.request_id), 2);
  console.log('公務車臨時直接派車資料庫測試通過：免核准直派、事由必填、仍受管理員／司機／時段 guard 約束、一般單不得借道。');
} finally {
  await db.close();
}
