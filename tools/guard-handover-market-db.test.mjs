import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);
const db = new PGlite();
const actor1 = '00000000-0000-0000-0000-000000000001';
const actor2 = '00000000-0000-0000-0000-000000000002';
const receiver1 = '00000000-0000-0000-0000-000000000003';
const root1 = '10000000-0000-0000-0000-000000000001';
const root2 = '10000000-0000-0000-0000-000000000002';
const dept1 = '10000000-0000-0000-0000-000000000003';
const dept2 = '10000000-0000-0000-0000-000000000004';
const readMigration = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const query = (sql, args = []) => db.query(sql, args);
const log = (market, date = '2026-09-15') => query(`insert into guard_handover_logs(market_code,duty_date,shift_name,shift_start,shift_end,patrol_start,patrol_end,
  actual_user_ids,duty_summary,created_by,updated_by) values($1,$2,'早班','03:00','11:00','04:00','05:00',array[$3]::uuid[],'勤務正常',$3,$3) returning log_id`, [market,date,market === 'market_1' ? actor1 : actor2]);
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table departments(dept_id uuid primary key,name text,status text,code text,parent_id uuid);
    create table users(user_id uuid primary key,name text,status text,username text,email text,department text,dept_id uuid,supervisor_id uuid,rbac_role text default 'reporter',role text default 'inspector');
    create table user_handover_module_access(user_id uuid,module_key text);
    create table user_system_access(user_id uuid,system_key text,mode text);
    create table role_permissions(role_id text,perm text,allowed boolean);
    create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table role_module_access(role_id text,system_key text,module_key text,mode text);
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function active_rbac_role() returns text language sql stable as $$select 'reporter'::text$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select true$$;
    create function reject_physical_data_removal() returns trigger language plpgsql as $$begin raise exception 'no delete'; end$$;
    create function handover_staff_market(p_user uuid,p_team text) returns text language sql stable as $$
      select case when p_user='${actor1}'::uuid then 'market_1' when p_user='${receiver1}'::uuid then 'market_1' when p_user='${actor2}'::uuid then 'market_2' end$$;
    create function handover_staff_markets(p_user uuid,p_team text) returns jsonb language sql stable as $$
      select case when p_user='${actor1}'::uuid then '["market_1"]'::jsonb else '["market_2"]'::jsonb end$$;
    create table patrol_shift_template(template_id uuid primary key default gen_random_uuid(),name text,start_time time,end_time time,sort_order int,status text,assigned_user_ids uuid[],market_code text not null default 'market_1');
    insert into patrol_shift_template(name,start_time,end_time,sort_order,status,assigned_user_ids) values('早班','03:00','11:00',1,'active',array['${actor1}'::uuid]);
    insert into departments values('${root1}','一市','active','MKT1',null),('${root2}','二市','active','MKT2',null),
      ('${dept1}','一市駐警','active','MKT1-GUARD','${root1}'),('${dept2}','二市駐警','active','MKT2-GUARD','${root2}');
    insert into role_permissions values('reporter','sys_handover',true);
    insert into users(user_id,name,status,username,email,department,dept_id) values
      ('${actor1}','一市警員','active','guard1','guard1@example.test','一市駐警','${dept1}'),
      ('${actor2}','二市警員','active','guard2','guard2@example.test','二市駐警','${dept2}'),
      ('${receiver1}','一市接班','active','guard3','guard3@example.test','一市駐警','${dept1}');
  `);
  for (const name of ['20260911150000_guard_handover.sql','20260911160000_guard_handover_insert_lock.sql',
    '20260911170000_guard_handover_attachments.sql','20260911180000_guard_handover_options.sql',
    '20260916110000_guard_handover_designated_receiver.sql']) await db.exec(readMigration(name));
  await db.exec(`alter table guard_handover_logs add column market_code text not null default 'market_1';
    alter table guard_handover_daily_approvals add column market_code text not null default 'market_1';
    alter table guard_handover_attachments add column market_code text not null default 'market_1';`);
  const migration = readMigration('20261001160000_guard_handover_market.sql');
  await db.exec(migration);
  await db.exec(migration);
  const templates = (await query(`select market_code,assigned_user_ids from patrol_shift_template order by market_code`)).rows;
  assert.equal(templates.length, 2);
  assert.deepEqual(templates[1].assigned_user_ids, [], '二市只複製班別，不複製一市排定人員');
  assert.equal((await query(`select guard_market_receiver_allowed($1,'market_2') allowed`, [actor1])).rows[0].allowed, false);
  assert.equal((await query(`select guard_market_receiver_allowed($1,'market_2') allowed`, [actor2])).rows[0].allowed, true);
  await query(`select set_config('test.actor',$1,false)`, [actor1]);
  assert.equal((await query(`select guard_market_allowed('market_1') allowed`)).rows[0].allowed, true);
  assert.equal((await query(`select guard_market_allowed('market_2') allowed`)).rows[0].allowed, false);
  const first = (await log('market_1')).rows[0];
  const second = (await log('market_2')).rows[0];
  await db.exec('set role authenticated');
  assert.deepEqual((await query(`select market_code from guard_handover_logs`)).rows.map(row => row.market_code), ['market_1'], '一市帳號不可直接讀取二市交接紀錄');
  await db.exec('reset role');
  await assert.rejects(query(`update guard_handover_logs set status='submitted',handover_by=$1,receiver_id=$2,updated_by=$1 where log_id=$3`, [actor1,actor2,first.log_id]), /handover market/);
  await query(`update guard_handover_logs set status='submitted',handover_by=$1,receiver_id=$2,updated_by=$1 where log_id=$3`, [actor1,receiver1,first.log_id]);
  await query(`update guard_handover_logs set status='received',takeover_by=$1,updated_by=$1 where log_id=$2`, [receiver1,first.log_id]);
  await query(`insert into guard_handover_daily_approvals(market_code,duty_date,approver_id) values('market_1','2026-09-15',$1)`, [actor1]);
  await assert.rejects(log('market_1', '2026-09-15'), /approved|locked|duplicate/);
  await query(`update guard_handover_logs set duty_summary='二市可改' where log_id=$1`, [second.log_id]);
  await assert.rejects(query(`insert into guard_handover_attachments(market_code,duty_date,shift_name,incident_id,file_name,file_size,storage_path,uploaded_by)
    values('market_1','2026-09-15','早班',gen_random_uuid(),'a.txt',1,'a', $1)`, [actor1]), /approved|locked/);
  await query(`insert into guard_handover_attachments(market_code,duty_date,shift_name,incident_id,file_name,file_size,storage_path,uploaded_by)
    values('market_2','2026-09-15','早班',gen_random_uuid(),'b.txt',1,'b', $1)`, [actor2]);
  console.log('駐警隊市場隔離 DB 通過：兩市同日班別、獨立簽核與附件鎖定、接班人市場權限、二市空白範本、冪等移轉。');
} finally { await db.close(); }
