import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// CI resolves the package from node_modules. HANDOVER_TEST_PGLITE_PATH lets a local
// machine with cloud-placeholder node_modules use a separate verified npm install.
const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href
  : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);
const migration = readFileSync(new URL('../supabase/migrations/20260916120000_handover_market_keys.sql', import.meta.url), 'utf8');
const db = new PGlite();
const userOne = '00000000-0000-0000-0000-000000000001';
const userTwo = '00000000-0000-0000-0000-000000000002';
const rootOne = '10000000-0000-0000-0000-000000000001';
const rootTwo = '10000000-0000-0000-0000-000000000002';
const teamOne = '10000000-0000-0000-0000-000000000003';
const teamTwo = '10000000-0000-0000-0000-000000000004';

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.departments(dept_id uuid primary key,parent_id uuid,code text,name text,status text);
    create table public.users(user_id uuid primary key,dept_id uuid,status text,username text,email text,name text,supervisor_id uuid);
    create table public.mechanical_staff_market_scopes(user_id uuid,market_code text,is_active boolean);
    create table public.business_handover_entries(entry_id uuid primary key default gen_random_uuid(),handover_date date,shift_code text);
    create table public.business_handover_approvals(approval_id uuid primary key default gen_random_uuid(),handover_date date,stage text);
    create table public.business_handover_transfers(transfer_id uuid primary key default gen_random_uuid(),handover_date date,shift_code text,next_date date,next_shift text);
    create table public.guard_handover_logs(log_id uuid primary key default gen_random_uuid(),duty_date date,shift_name text);
    create table public.guard_handover_daily_approvals(approval_id uuid primary key default gen_random_uuid(),duty_date date);
    create table public.guard_handover_attachments(attachment_id uuid primary key default gen_random_uuid(),duty_date date,shift_name text,incident_id uuid,is_deleted boolean default false);
    create table public.mechanical_handover_entries(entry_id uuid primary key default gen_random_uuid(),work_date date,shift_code text);
    create table public.mechanical_handover_signatures(signature_id uuid primary key default gen_random_uuid(),work_date date,shift_code text);
    create table public.mechanical_handover_daily_approvals(approval_id uuid primary key default gen_random_uuid(),work_date date);
    create table public.mechanical_handover_transfers(transfer_id uuid primary key default gen_random_uuid(),handover_date date,shift_code text,next_date date,next_shift text);
    create table public.patrol_shift_template(template_id uuid primary key default gen_random_uuid(),status text,sort_order int);
    create table public.patrol_shifts(shift_id uuid primary key default gen_random_uuid(),shift_date date,name text);
    create table public.patrol_shift_day_status(duty_date date primary key);
    create table public.plan_markers(marker_id uuid primary key default gen_random_uuid(),kind text,status text,floor_id text);
    create table public.checkin_logs(checkin_id uuid primary key default gen_random_uuid(),checkin_at timestamptz);
    insert into public.business_handover_entries(handover_date,shift_code) values('2026-09-16','01-09');
    insert into public.mechanical_handover_entries(work_date,shift_code) values('2026-09-16','01-09');
  `);
  await db.exec(migration);
  await db.exec(migration);
  const business = await db.query('select market_code from public.business_handover_entries');
  const mechanical = await db.query('select market_code from public.mechanical_handover_entries');
  assert.equal(business.rows[0].market_code, 'market_1');
  assert.equal(mechanical.rows[0].market_code, 'market_2');
  await db.query(`insert into public.departments values
    ($1,null,'MKT1','第一市場','active'),($2,null,'MKT2','第二市場','active'),
    ($3,$1,'MKT1-ADMIN','業管組','active'),($4,$2,'MKT2-GUARD','駐衛隊','active')`,
    [rootOne, rootTwo, teamOne, teamTwo]);
  await db.query(`insert into public.users(user_id,dept_id,status) values($1,$2,'active'),($3,$4,'active')`, [userOne, teamOne, userTwo, teamTwo]);
  const one = await db.query(`select public.handover_staff_market($1,'business') as market`, [userOne]);
  const two = await db.query(`select public.handover_staff_market($1,'guard') as market`, [userTwo]);
  const wrong = await db.query(`select public.handover_staff_market($1,'business') as market`, [userTwo]);
  assert.equal(one.rows[0].market, 'market_1');
  assert.equal(two.rows[0].market, 'market_2');
  assert.equal(wrong.rows[0].market, null);
  await db.query(`update public.users set supervisor_id=$1 where user_id=$2`, [userOne, userTwo]);
  const supervised = await db.query(`select public.handover_staff_markets($1,'guard') as markets`, [userOne]);
  assert.deepEqual(supervised.rows[0].markets, ['market_2']);
  await db.query(`update public.users set username='deidentified-old' where user_id=$1`, [userOne]);
  const retired = await db.query(`select public.handover_staff_market($1,'business') as market`, [userOne]);
  assert.equal(retired.rows[0].market, null);
  await assert.rejects(db.query(`insert into public.business_handover_entries(handover_date,shift_code,market_code)
    values('2026-09-16','09-17','market_3')`), /check constraint/);
  console.log('市場基礎移轉：舊紀錄歸屬、重跑冪等、組織勾稽與無效市場拒絕均通過。');
} finally {
  await db.close();
}
