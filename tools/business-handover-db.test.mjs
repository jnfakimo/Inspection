import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const actorA = '00000000-0000-0000-0000-000000000001', actorB = '00000000-0000-0000-0000-000000000002', actorC = '00000000-0000-0000-0000-000000000003';
const migration = readFileSync(new URL('../supabase/migrations/20260915120000_business_handover_reconciliation.sql', import.meta.url), 'utf8');
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);
const day = async date => (await query(`select business_handover_day($1) as data`, [date])).rows[0].data;
const revision = async (date, shift) => (await day(date)).find(s => s.shift_code === shift).revision;
const act = async (op, date, shift, entry = null, receiver = null, rev = null) =>
  (await query(`select business_handover_action($1,$2,$3,$4,$5,$6) as data`, [op,date,shift,entry,receiver,rev])).rows[0].data;
const add = async (date, shift, description) => (await query(`insert into business_handover_entries(handover_date,shift_code,description) values($1,$2,$3) returning entry_id`, [date,shift,description])).rows[0].entry_id;
try {
  await db.exec(`create role anon; create role authenticated;
    create table users(user_id uuid primary key,name text,status text,username text,email text,rbac_role text default 'reporter',role text default 'inspector',department text);
    create table user_system_access(user_id uuid,system_key text,mode text);
    create table role_permissions(role_id text,perm text,allowed boolean);
    create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table role_module_access(role_id text,system_key text,module_key text,mode text);
    insert into role_permissions values('reporter','sys_handover',true);
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'true')<>'false'$$;
    create table business_handover_entries(entry_id uuid primary key default gen_random_uuid(),handover_date date,shift_code text,description text,
      category text default '其他',is_deleted boolean default false,expected_attendance int default 2,absent_attendance int default 0,created_at timestamptz default now());
  `);
  await db.exec(migration);
  await db.exec(migration); // 重複套用保留資料且不失敗。
  await query(`insert into users(user_id,name,status,username,email) values ($1,'早班人員','active','early','a@example.test'),($2,'中班人員','active','middle','b@example.test'),($3,'已離職人員-測試','active','deidentified-test','deidentified-test')`,[actorA,actorB,actorC]);
  await actor(actorA);
  await query(`select set_config('test.allowed','false',false)`);
  await assert.rejects(day('2020-01-01'), /未開放/);
  await query(`select set_config('test.allowed','true',false)`);
  const one = await add('2020-01-01','01-09','第一件未完成');
  const two = await add('2020-01-01','01-09','第二件未完成');
  await add('2020-01-01','01-09','【崗位勤務點檢紀錄】{}');
  assert.equal((await day('2020-01-02'))[0].items.length,2,'未簽名的舊事項也要持續續帶，點檢 JSON 不續帶');
  assert.equal((await day('2020-01-02'))[0].items[0].carried,true);
  let rev = await revision('2020-01-01','01-09');
  assert.equal((await query('select business_handover_receivers() as data')).rows[0].data.length,1);
  await query(`insert into user_module_access values($1,'handover','business','deny')`,[actorB]);
  await assert.rejects(act('submit','2020-01-01','01-09',null,actorB,rev),/交接權限/);
  await query(`update user_module_access set mode='allow' where user_id=$1`,[actorB]);
  await assert.rejects(act('submit','2020-01-01','01-09',null,actorA,rev),/同一人/);
  await assert.rejects(act('submit','2020-01-01','01-09',null,actorC,rev),/在職/);
  await query(`update business_handover_entries set description='內容已修改' where entry_id=$1`,[one]);
  await assert.rejects(act('submit','2020-01-01','01-09',null,actorB,rev),/剛被修改/);
  rev=await revision('2020-01-01','01-09');
  const sent=await act('submit','2020-01-01','01-09',null,actorB,rev);
  assert.equal(sent.items.length,2); assert.equal(sent.next_shift,'09-17'); assert.ok(sent.handed_at);
  await assert.rejects(query(`update business_handover_entries set description='偷偷修改' where entry_id=$1`,[one]),/已鎖定/);
  await assert.rejects(add('2020-01-01','01-09','簽後新增'),/已鎖定/);
  await assert.rejects(act('receive','2020-01-01','09-17',null,null,rev),/本人/);
  await assert.rejects(act('submit','2020-01-01','09-17',null,actorB,await revision('2020-01-01','09-17')),/先由指定/);
  await actor(actorB);
  const received=await act('receive','2020-01-01','09-17',null,null,rev);
  assert.equal(received.received_by,actorB); assert.ok(received.received_at);
  const again=await act('receive','2020-01-01','09-17',null,null,rev);
  assert.equal(again.received_at,received.received_at,'重送不改簽認時間');
  await assert.rejects(act('submit','2020-01-02','01-09',null,actorA,await revision('2020-01-02','01-09')),/不能跳過/);
  await act('submit','2020-01-01','09-17',null,actorA,await revision('2020-01-01','09-17'));
  await actor(actorA);
  let incoming=(await day('2020-01-01'))[2].incoming;
  await act('receive','2020-01-01','17-01',null,null,incoming.revision);
  const evening=await act('submit','2020-01-01','17-01',null,actorB,await revision('2020-01-01','17-01'));
  assert.equal(evening.next_date,'2020-01-02'); assert.equal(evening.next_shift,'01-09');
  await actor(actorB);
  await act('receive','2020-01-02','01-09',null,null,evening.revision);

  // 完成以實際台灣當班入帳；不可任意回填歷史。未完成可跨越任意天數。
  const now=(await query(`select (now() at time zone 'Asia/Taipei')::date::text as d,extract(hour from now() at time zone 'Asia/Taipei')::int as h`)).rows[0];
  const shift=now.h<1||now.h>=17?'17-01':now.h<9?'01-09':'09-17';
  const date=now.h<1?(await query(`select ($1::date-1)::text as d`,[now.d])).rows[0].d:now.d;
  await assert.rejects(act('complete','2020-01-02','01-09',one),/目前當班/);
  await assert.rejects(act('complete',date,shift,one),/上一班尚未交班/);
  // 模擬系統已持續使用到今天，建立目前班別上一班的合法內容快照。
  const prevDate=shift==='01-09'?(await query(`select ($1::date-1)::text as d`,[date])).rows[0].d:date;
  const prevShift=shift==='01-09'?'17-01':shift==='09-17'?'01-09':'09-17';
  await query(`insert into business_handover_transfers(handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
    values($1,$2,$3,$4,business_shift_items($1,$2),md5(business_shift_items($1,$2)::text),$5,'早班人員',$6,'中班人員')`,[prevDate,prevShift,date,shift,actorA,actorB]);
  await assert.rejects(act('complete',date,shift,one),/先確認接班/);
  const currentIncoming=(await day(date)).find(s=>s.shift_code===shift).incoming;
  await act('receive',date,shift,null,null,currentIncoming.revision);
  const completed=await act('complete',date,shift,one);
  assert.equal(completed.completed_by,actorB); assert.ok(completed.completed_at);
  const future=(await query(`select ($1::date+1)::text as d`,[date])).rows[0].d;
  assert.equal((await day(future))[0].items.some(e=>e.entry_id===one),false,'完成後停止续帶');
  assert.equal((await day(future))[0].items.some(e=>e.entry_id===two),true,'另一件未完成仍持續續帶');
  assert.equal((await day(date)).find(s=>s.shift_code===shift).items.find(e=>e.entry_id===one).is_completed,true);
  assert.deepEqual((await day('2020-01-01'))[0].outgoing.items,sent.items,'日後完成不能改寫歷史交班快照');
  await assert.rejects(act('submit',future,'01-09',null,actorA,await revision(future,'01-09')),/尚未開始/);
  await db.exec('set role authenticated');
  await assert.rejects(query(`update business_handover_transfers set received_by=$1`,[actorA]),/permission denied/);
  await assert.rejects(query(`insert into business_handover_completions(entry_id,completed_date,completed_shift,completed_by,completed_name) values($1,$2,'01-09',$3,'偽造')`,[two,date,actorA]),/permission denied/);
  await db.exec('reset role');
  console.log('業管組交接 DB 通過：跨班／跨日續帶、完成停止、雙方身分與時間、接班前置、跳班禁止、過期版本、簽後鎖定、歷史快照、RLS 防偽與冪等。');
} finally { await db.close(); }
