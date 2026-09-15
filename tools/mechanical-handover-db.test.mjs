import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const early = '00000000-0000-0000-0000-000000000001';
const middle = '00000000-0000-0000-0000-000000000002';
const departed = '00000000-0000-0000-0000-000000000003';
const dept = '10000000-0000-0000-0000-000000000001';
const migration = readFileSync(new URL('../supabase/migrations/20260915160000_mechanical_handover_reconciliation.sql', import.meta.url), 'utf8');
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);
const day = async date => (await query(`select mechanical_handover_day($1) as data`, [date])).rows[0].data;
const report = async (date, shift) => (await day(date)).find(row => row.shift_code === shift);
const act = async (operation, date, shift, receiver = null, revision = null) =>
  (await query(`select mechanical_handover_action($1,$2,$3,$4,$5) as data`, [operation, date, shift, receiver, revision])).rows[0].data;

try {
  await db.exec(`create role anon; create role authenticated;
    create table departments(dept_id uuid primary key,name text,level int,status text);
    create table users(user_id uuid primary key,name text,status text,username text,email text,department text,dept_id uuid,rbac_role text default 'reporter',role text default 'inspector');
    create table mechanical_staff_market_scopes(user_id uuid,market_code text,is_active boolean);
    create table user_system_access(user_id uuid,system_key text,mode text);
    create table role_permissions(role_id text,perm text,allowed boolean);
    create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table role_module_access(role_id text,system_key text,module_key text,mode text);
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'true')<>'false'$$;
    create table mechanical_handover_entries(
      entry_id uuid primary key default gen_random_uuid(), work_date date not null, shift_code text not null,
      category text, work_item text, details text, technician_ids uuid[] default '{}', result text not null,
      notes text, sort_order int default 0, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
      carry_source_id uuid references mechanical_handover_entries(entry_id), is_deleted boolean default false
    );
    create table mechanical_handover_daily_approvals(work_date date,approver_id uuid,approved_at timestamptz default now(),note text);
    insert into departments values('${dept}','機電課',2,'active');
    insert into role_permissions values('reporter','sys_handover',true);
  `);
  await db.exec(migration);
  await db.exec(migration);
  await query(`insert into users(user_id,name,status,username,email,department,dept_id) values
    ($1,'早班人員','active','early','early@example.test','機電課',$4),
    ($2,'中班人員','active','middle','middle@example.test','機電課',$4),
    ($3,'已離職人員-測試','active','deidentified-test','deidentified-test','機電課',$4)`, [early, middle, departed, dept]);
  await query(`insert into mechanical_staff_market_scopes values($1,'market_2',true),($2,'market_2',true),($3,'market_2',true)`, [early, middle, departed]);
  await actor(early);
  const source = (await query(`insert into mechanical_handover_entries(work_date,shift_code,category,work_item,details,result,created_by)
    values('2020-01-01','01-09','冷凍冷藏設備','B1F 冷藏主機巡檢','冷凍冷藏設備 B1F 冷藏主機巡檢','待料',$1) returning entry_id`, [early])).rows[0].entry_id;
  assert.equal((await report('2020-01-01','09-17')).items[0].entry_id, source, '未完成工作須自動帶入下一班');
  assert.equal((await report('2020-01-02','01-09')).items[0].carried, true, '沒有續辦前須跨日持續帶入');
  assert.equal((await query(`select mechanical_handover_receivers() as data`)).rows[0].data.length, 1, '離職去識別化人員不可成為接班人');
  const earlyReport = await report('2020-01-01','01-09');
  await assert.rejects(act('submit','2020-01-01','01-09',early,'x'), /同一人|修改/);
  await assert.rejects(act('submit','2020-01-01','01-09',departed,earlyReport.revision), /在職機電課/);
  const sent = await act('submit','2020-01-01','01-09',middle,earlyReport.revision);
  assert.ok(sent.handed_at); assert.equal(sent.receiver_id, middle);
  await assert.rejects(query(`insert into mechanical_handover_daily_approvals(work_date,approver_id) values('2020-01-01',$1)`, [early]), /三個班別/);
  await assert.rejects(query(`update mechanical_handover_entries set details='竄改' where entry_id=$1`, [source]), /已鎖定/);
  await assert.rejects(query(`insert into mechanical_handover_entries(work_date,shift_code,result) values('2020-01-01','01-09','正常')`), /已交班/);
  await assert.rejects(act('receive','2020-01-01','09-17',null,sent.revision), /本人/);
  await actor(middle);
  const received = await act('receive','2020-01-01','09-17',null,sent.revision);
  assert.ok(received.received_at); assert.equal(received.received_by, middle);
  const child = (await query(`insert into mechanical_handover_entries(work_date,shift_code,category,work_item,details,result,created_by,carry_source_id)
    values('2020-01-01','09-17','冷凍冷藏設備','B1F 冷藏主機巡檢','已完成巡檢','已完成',$1,$2) returning entry_id`, [middle, source])).rows[0].entry_id;
  const middleReport = await report('2020-01-01','09-17');
  assert.equal(middleReport.items.length, 1); assert.equal(middleReport.items[0].entry_id, child); assert.equal(middleReport.items[0].is_completed, true);
  const middleSent = await act('submit','2020-01-01','09-17',early,middleReport.revision);
  assert.equal((await report('2020-01-01','17-01')).items.length, 0, '續辦標示完成後下一班停止帶入');
  assert.equal((await report('2020-01-01','01-09')).outgoing.items[0].details, '冷凍冷藏設備 B1F 冷藏主機巡檢', '後續完成不得改寫歷史交班快照');
  await actor(early);
  await act('receive','2020-01-01','17-01',null,middleSent.revision);
  const eveningReport = await report('2020-01-01','17-01');
  const eveningSent = await act('submit','2020-01-01','17-01',middle,eveningReport.revision);
  await actor(middle);
  await act('receive','2020-01-02','01-09',null,eveningSent.revision);
  await query(`insert into mechanical_handover_daily_approvals(work_date,approver_id) values('2020-01-01',$1)`, [middle]);
  await db.exec('set role authenticated');
  await assert.rejects(query(`update mechanical_handover_transfers set received_by=$1`, [early]), /permission denied/);
  await db.exec('reset role');
  console.log('機電交接 DB 通過：自動跨班／跨日續帶、完成停止、雙方本人簽認與時間、接班前置、簽後鎖定、歷史快照、接班資格與 RLS 防偽。');
} finally {
  await db.close();
}
