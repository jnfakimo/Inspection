import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const fixture = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
create table users(
  user_id uuid primary key,auth_id uuid,status text,role text,rbac_role text,name text,username text,
  dept_id uuid,department text,supervisor_id uuid references users(user_id)
);
create table vehicle_dispatch_managers(user_id uuid references users(user_id),active boolean);
create table vehicle_dispatch_requests(
  request_id uuid primary key,applicant_id uuid references users(user_id),status text,
  vehicle_id uuid,driver_id uuid references users(user_id),trip_date date,planned_departure_time time,planned_return_time time,
  supervisor_id uuid references users(user_id),supervisor_name text,supervisor_note text,approved_at timestamptz
);
create table vehicle_dispatch_logs(
  log_id bigint generated always as identity primary key,request_id uuid,from_status text,to_status text,
  action text,note text,operator_id uuid,operator_name text,created_at timestamptz default now()
);
create function active_user_id() returns uuid language sql stable as $$select (select user_id from users where auth_id=auth.uid())$$;
create function is_admin() returns boolean language sql stable as $$select false$$;
create function has_system_access(text) returns boolean language sql stable as $$select true$$;
create function supervisor_unit_allows(uuid,uuid) returns boolean language sql stable security definer as $$select $1=$2$$;
create function vehicle_request_action(uuid,text,text,uuid,uuid)
returns vehicle_dispatch_requests language plpgsql security definer as $$
declare r vehicle_dispatch_requests;
begin
  if $2='dispatch' then update vehicle_dispatch_requests set status='assigned' where request_id=$1 returning * into r;
  else select * into r from vehicle_dispatch_requests where request_id=$1; end if;
  return r;
end$$;
`;

const raw = readFileSync(new URL('../supabase/migrations/20260913193000_vehicle_two_level_approval.sql', import.meta.url), 'utf8');
// PGlite 未內建 btree_gist；排除約束語句在既有線上 migration 已驗證，此處只拿掉該一段。
const migration = raw.replace(
  /alter table public\.vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_no_time_overlap;[\s\S]*?\) where \(status in \('pending_approval','pending_manager_approval','approved','assigned','completed'\)\);/,
  '',
);

const ids = {
  applicant: '00000000-0000-0000-0000-000000000001',
  supervisor: '00000000-0000-0000-0000-000000000002',
  manager: '00000000-0000-0000-0000-000000000003',
  authSupervisor: '10000000-0000-0000-0000-000000000002',
  authManager: '10000000-0000-0000-0000-000000000003',
  dept: '20000000-0000-0000-0000-000000000001',
  request: '30000000-0000-0000-0000-000000000001',
  bypass: '30000000-0000-0000-0000-000000000002',
};

const db = new PGlite();
try {
  await db.exec(fixture);
  await db.exec(migration);
  await db.query(`insert into users(user_id,auth_id,status,role,rbac_role,name,username,dept_id,department,supervisor_id) values
    ($1,null,'active','reporter','reporter','申請人','applicant',$6,'總務課',$2),
    ($2,$3,'active','supervisor','unit_supervisor','課長','supervisor',$6,'總務課',null),
    ($4,$5,'active','supervisor','mgmt_supervisor','部門經理','manager',$6,'總務課',null)`,
    [ids.applicant,ids.supervisor,ids.authSupervisor,ids.manager,ids.authManager,ids.dept]);
  await db.query(`insert into vehicle_dispatch_requests(request_id,applicant_id,status,trip_date,planned_departure_time,planned_return_time)
    values($1,$2,'pending_approval','2026-09-20','09:00','10:00')`,[ids.request,ids.applicant]);

  await db.query(`select set_config('test.auth',$1,false)`,[ids.authSupervisor]);
  let result = await db.query(`select status,supervisor_name,approved_at from vehicle_request_action($1,'approve','課長同意',null,null)`,[ids.request]);
  assert.equal(result.rows[0].status,'pending_manager_approval');
  assert.equal(result.rows[0].supervisor_name,'課長');
  assert.ok(result.rows[0].approved_at);

  await db.query(`select set_config('test.auth',$1,false)`,[ids.authManager]);
  result = await db.query(`select status,department_manager_name,department_manager_approved_at from vehicle_request_action($1,'approve','經理同意',null,null)`,[ids.request]);
  assert.equal(result.rows[0].status,'approved');
  assert.equal(result.rows[0].department_manager_name,'部門經理');
  assert.ok(result.rows[0].department_manager_approved_at);
  assert.equal((await db.query('select count(*)::int as n from vehicle_dispatch_logs where request_id=$1',[ids.request])).rows[0].n,2);

  await db.query(`insert into vehicle_dispatch_requests(request_id,applicant_id,status,trip_date,planned_departure_time,planned_return_time)
    values($1,$2,'approved','2026-09-21','09:00','10:00')`,[ids.bypass,ids.applicant]);
  await assert.rejects(db.query(`update vehicle_dispatch_requests set status='assigned' where request_id=$1`,[ids.bypass]),/尚未完成核准/);
  console.log('公務車兩層核准資料庫測試通過：課長、部門經理、稽核歷程與派車防繞過。');
} finally {
  await db.close();
}
