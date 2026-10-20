import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 水果組電子交接簿資料庫規則：事項、交班／接班、三階批核、市場與權限邊界。
// 以 PGlite 載入真實 migration，只用最小假資料與假函式替代既有的使用者／權限基礎。
const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);
const migration = readFileSync(new URL('../supabase/migrations/20261021090000_produce_handover_fruit.sql', import.meta.url), 'utf8');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const U = { a: id(1), b: id(2), leader: id(3), deputy: id(4), director: id(5), sysadmin: id(6), outsider: id(7), m2: id(8), c: id(9) };
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);
const rpc = async (who, sql, args = []) => { await actor(who); return (await query(sql, args)).rows[0]; };
const fails = async (who, sql, args, pattern) => {
  await actor(who);
  await assert.rejects(() => query(sql, args), error => pattern.test(String(error.message)), `${sql} 應被擋下：${pattern}`);
};

const DAY = '2026-10-01';
const save = (who, shift, text, entry = null, del = false) =>
  rpc(who, `select public.produce_entry_save('fruit','market_1',$1::date,$2,$3::uuid,$4,$5) r`, [DAY, shift, entry, text, del]);
const action = (who, op, shift, extra = {}) =>
  rpc(who, `select public.produce_action('fruit','market_1',$1,$2::date,$3,$4::uuid,$5::uuid,$6) r`,
    [op, extra.date || DAY, shift, extra.entry || null, extra.receiver || null, extra.revision || null]);
const day = async who => (await rpc(who, `select public.produce_day('fruit','market_1',$1::date) r`, [DAY])).r;
const approve = (who, stage, date = DAY, note = null) =>
  rpc(who, `select public.produce_approval_save('fruit','market_1',$1::date,$2,$3) r`, [date, stage, note]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table roles(role_id text primary key);
    create table users(user_id uuid primary key,name text,status text,username text,email text,department text,dept_id uuid,
      rbac_role text,role text,supervisor_id uuid);
    create table departments(dept_id uuid primary key,parent_id uuid,code text,status text);
    create table user_system_access(user_id uuid,system_key text,mode text);
    create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table role_permissions(role_id text,perm text,allowed boolean);
    create table role_module_access(role_id text,system_key text,module_key text,mode text,unique(role_id,system_key,module_key));
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function active_rbac_role() returns text language sql stable as $$select coalesce((select rbac_role from public.users where user_id=public.active_user_id()),'reporter')$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select true$$;
    -- 業管組同市場的副主任與主任判斷：測試以固定人員代替組織鏈。
    create function business_market_approval_allowed(uuid,text,text) returns boolean language sql stable as
      $$select case $3 when 'deputy_director' then $1='${U.deputy}'::uuid when 'director' then $1='${U.director}'::uuid else false end$$;
    insert into roles values('sysadmin'),('unit_supervisor'),('reporter');
    insert into role_permissions values('unit_supervisor','sys_handover',true),('reporter','sys_handover',true);
    insert into departments values
      ('${id(90)}',null,'MKT1','active'),('${id(91)}',null,'MKT2','active'),
      ('${id(92)}','${id(90)}','MKT1-FRUIT','active'),('${id(93)}','${id(91)}','MKT2-FRUIT','active'),
      ('${id(94)}','${id(90)}','MKT1-ADMIN','active'),('${id(95)}','${id(90)}','MKT1-GUARD','active');
    insert into users(user_id,name,status,username,email,dept_id,rbac_role,role) values
      ('${U.a}','水果甲','active','a','a@example.test','${id(92)}','reporter','inspector'),
      ('${U.b}','水果乙','active','b','b@example.test','${id(92)}','reporter','inspector'),
      ('${U.c}','水果丙停用','inactive','c','c@example.test','${id(92)}','reporter','inspector'),
      ('${U.leader}','水果組長','active','leader','l@example.test','${id(92)}','unit_supervisor','supervisor'),
      ('${U.deputy}','副主任','active','deputy','d@example.test','${id(94)}','unit_supervisor','supervisor'),
      ('${U.director}','主任','active','director','dir@example.test','${id(94)}','unit_supervisor','supervisor'),
      ('${U.sysadmin}','管理員','active','sysadmin','s@example.test','${id(94)}','sysadmin','admin'),
      ('${U.outsider}','駐警','active','guard','g@example.test','${id(95)}','reporter','inspector'),
      ('${U.m2}','二市水果','active','m2','m2@example.test','${id(93)}','reporter','inspector');
  `);
  await db.exec(migration);
  await db.exec(migration); // 可重複套用

  // 預設拒絕：子系統須明確允許。
  assert.equal((await query(`select count(*)::int n from role_module_access where module_key='fruit' and mode='deny'`)).rows[0].n, 2, '非管理員角色預設拒絕水果組');
  assert.equal((await query(`select public.produce_user_allowed($1,'fruit') ok`, [U.a])).rows[0].ok, false, '預設拒絕時一般人員沒有權限');
  await query(`insert into role_module_access values('reporter','handover','fruit','allow'),('unit_supervisor','handover','fruit','allow')
    on conflict(role_id,system_key,module_key) do update set mode='allow'`);
  assert.equal((await query(`select public.produce_user_allowed($1,'fruit') ok`, [U.a])).rows[0].ok, true, '角色允許後可使用');
  await query(`insert into user_module_access values($1,'handover','fruit','deny')`, [U.b]);
  assert.equal((await query(`select public.produce_user_allowed($1,'fruit') ok`, [U.b])).rows[0].ok, false, '個人拒絕優先於角色');
  await query(`delete from user_module_access where user_id=$1`, [U.b]);
  assert.equal((await query(`select public.produce_user_allowed($1,'fruit') ok`, [U.c])).rows[0].ok, false, '停用人員無權限');

  // 市場與組別邊界。
  assert.equal((await query(`select public.produce_staff_market($1,'fruit') m`, [U.a])).rows[0].m, 'market_1');
  assert.equal((await query(`select public.produce_staff_market($1,'fruit') m`, [U.m2])).rows[0].m, 'market_2');
  assert.equal((await query(`select public.produce_staff_market($1,'fruit') m`, [U.outsider])).rows[0].m, null, '駐警隊不屬水果組');
  assert.equal((await query(`select public.produce_staff_market($1,'fruit') m`, [U.deputy])).rows[0].m, null, '副主任在業管組，不屬水果組');
  await fails(U.outsider, `select public.produce_day('fruit','market_1',$1::date)`, [DAY], /未開放/);
  await fails(U.m2, `select public.produce_day('fruit','market_1',$1::date)`, [DAY], /未開放/);
  await fails(U.m2, `select public.produce_day('fruit','market_2',$1::date)`, [DAY], /未開放/);
  await fails(U.sysadmin, `select public.produce_day('vegetable','market_1',$1::date)`, [DAY], /未開放/);
  // 副主任、主任不在水果組，仍可檢視一市場水果組（為了批核）。
  assert.equal((await day(U.deputy)).can.deputy_director, true);
  assert.equal((await day(U.director)).can.director, true);

  // 本班事項：新增、修改、刪除標記；驗證長度與未開始班別。
  const first = (await save(U.a, '01-09', '一、存貨交接')).r;
  assert.equal(first.created_name, '水果甲');
  const second = (await save(U.a, '01-09', '二、公物順移')).r;
  await fails(U.a, `select public.produce_entry_save('fruit','market_1',$1::date,'01-09',null,'   ',false)`, [DAY], /請填寫交接事項/);
  await fails(U.a, `select public.produce_entry_save('fruit','market_1',$1::date,'01-09',null,$2,false)`, [DAY, 'x'.repeat(2001)], /請填寫交接事項/);
  await fails(U.a, `select public.produce_entry_save('fruit','market_1','2099-01-01'::date,'01-09',null,'未來',false)`, [], /尚未開始/);
  await fails(U.outsider, `select public.produce_entry_save('fruit','market_1',$1::date,'01-09',null,'外人',false)`, [DAY], /未開放/);
  const edited = (await save(U.b, '01-09', '一、存貨交接（更正）', first.entry_id)).r;
  assert.equal(edited.description, '一、存貨交接（更正）');
  assert.equal(edited.updated_by, U.b);
  const removed = (await save(U.b, '01-09', null, second.entry_id, true)).r;
  assert.equal(removed.is_deleted, true);
  assert.equal((await query(`select count(*)::int n from produce_handover_entries where entry_id=$1`, [second.entry_id])).rows[0].n, 1, '刪除只標記，不實體刪除');
  // 與業管組相同：本班內仍帶回已刪除的事項供畫面標示，但交班快照與續帶到下一班時不含已刪除事項。
  const shiftOne = (await day(U.a)).shifts[0].items;
  assert.equal(shiftOne.filter(item => !item.is_deleted).length, 1);
  assert.equal(shiftOne.filter(item => item.is_deleted).length, 1);

  // 交班：不得自己接班、接班人須為同市場水果組成員、修訂碼須相符。
  const rev1 = (await day(U.a)).shifts[0].revision;
  await fails(U.a, `select public.produce_action('fruit','market_1','submit',$1::date,'01-09',null,$2,$3)`, [DAY, U.a, rev1], /不可為同一人/);
  await fails(U.a, `select public.produce_action('fruit','market_1','submit',$1::date,'01-09',null,$2,$3)`, [DAY, U.outsider, rev1], /指定接班人必須/);
  await fails(U.a, `select public.produce_action('fruit','market_1','submit',$1::date,'01-09',null,$2,$3)`, [DAY, U.c, rev1], /指定接班人必須/);
  await fails(U.a, `select public.produce_action('fruit','market_1','submit',$1::date,'01-09',null,$2,'${'0'.repeat(32)}')`, [DAY, U.b], /剛被修改/);
  const submitted = (await action(U.a, 'submit', '01-09', { receiver: U.b, revision: rev1 })).r;
  assert.equal(submitted.next_shift, '09-17');
  assert.equal(submitted.handed_name, '水果甲');
  await fails(U.a, `select public.produce_action('fruit','market_1','submit',$1::date,'01-09',null,$2,$3)`, [DAY, U.b, rev1], /已交班/);
  // 交班後事項鎖定。
  await fails(U.a, `select public.produce_entry_save('fruit','market_1',$1::date,'01-09',$2::uuid,'竄改',false)`, [DAY, first.entry_id], /找不到本班可修改|已鎖定|已交班/);
  await fails(U.a, `select public.produce_entry_save('fruit','market_1',$1::date,'01-09',null,'補寫',false)`, [DAY], /已鎖定|已交班/);
  // 接班：只有指定接班人本人，修訂碼要相符。
  await fails(U.a, `select public.produce_action('fruit','market_1','receive',$1::date,'09-17',null,null,$2)`, [DAY, rev1], /僅指定接班人/);
  await fails(U.b, `select public.produce_action('fruit','market_1','receive',$1::date,'09-17',null,null,$2)`, [DAY, 'f'.repeat(32)], /已變更/);
  const received = (await action(U.b, 'receive', '09-17', { revision: rev1 })).r;
  assert.ok(received.received_at);
  assert.equal((await action(U.b, 'receive', '09-17', { revision: rev1 })).r.received_at, received.received_at, '重複接班確認為冪等');
  // 不能跳班交班；上一班沒人接班前不能再交班。
  await fails(U.b, `select public.produce_action('fruit','market_1','submit',$1::date,'17-01',null,$2,$3)`, [DAY, U.a, 'a'.repeat(32)], /上一班尚未交班/);
  const rev2 = (await day(U.b)).shifts[1].revision;
  await fails(U.a, `select public.produce_action('fruit','market_1','submit',$1::date,'09-17',null,$2,$3)`, [DAY, U.b, rev2], /已確認接班/);
  const second_submit = (await action(U.b, 'submit', '09-17', { receiver: U.a, revision: rev2 })).r;
  assert.equal(second_submit.next_shift, '17-01');
  // 續帶：09-17 班看得到 01-09 班的事項。
  assert.equal((await day(U.b)).shifts[1].items.length, 1);
  assert.equal((await day(U.b)).shifts[1].items[0].carried, true);

  // 完成事項只能在目前台灣當班登記（過去班別不可回填）。
  await fails(U.a, `select public.produce_action('fruit','market_1','complete',$1::date,'17-01',$2::uuid,null,null)`, [DAY, first.entry_id], /目前當班/);

  // 批核：三階依序，組長由水果組主管、副主任／主任由業管組同一批人、sysadmin 可批任一階。
  await fails(U.a, `select public.produce_approval_save('fruit','market_1',$1::date,'group_leader',null)`, [DAY], /不能批核/);
  await fails(U.deputy, `select public.produce_approval_save('fruit','market_1',$1::date,'group_leader',null)`, [DAY], /不能批核/);
  await fails(U.leader, `select public.produce_approval_save('fruit','market_1',$1::date,'deputy_director',null)`, [DAY], /不能批核/);
  await fails(U.deputy, `select public.produce_approval_save('fruit','market_1',$1::date,'deputy_director',null)`, [DAY], /請先由組\(副\)長批核/);
  await fails(U.director, `select public.produce_approval_save('fruit','market_1',$1::date,'director',null)`, [DAY], /請先由市場副主任批核/);
  await fails(U.leader, `select public.produce_approval_save('fruit','market_1','2099-01-01'::date,'group_leader',null)`, [], /尚未到/);
  await fails(U.leader, `select public.produce_approval_save('fruit','market_1',$1::date,'group_leader',$2)`, [DAY, 'x'.repeat(501)], /至多 500/);
  await fails(U.leader, `select public.produce_approval_save('fruit','market_1',$1::date,'bogus',null)`, [DAY], /批核階段無效/);
  const leaderApproval = (await approve(U.leader, 'group_leader', DAY, '點檢無誤')).r;
  assert.equal(leaderApproval.stage_label, '組(副)長');
  assert.equal(leaderApproval.approver_name, '水果組長');
  assert.equal((await approve(U.leader, 'group_leader', DAY, '補充說明')).r.note, '補充說明', '原批核人可更新說明');
  await fails(U.sysadmin, `select public.produce_approval_save('fruit','market_1',$1::date,'group_leader',null)`, [DAY], /已由水果組長批核/);
  await fails(U.director, `select public.produce_approval_save('fruit','market_1',$1::date,'director',null)`, [DAY], /請先由市場副主任批核/);
  assert.equal((await approve(U.deputy, 'deputy_director')).r.stage_label, '一市場副主任');
  assert.equal((await approve(U.director, 'director')).r.stage_label, '一市場主任');
  assert.equal((await day(U.a)).approvals.length, 3);
  assert.deepEqual((await day(U.a)).approvals.map(a => a.stage), ['group_leader', 'deputy_director', 'director']);
  assert.equal((await day(U.a)).can.group_leader, false);
  assert.equal((await day(U.leader)).can.group_leader, true);
  assert.equal((await day(U.sysadmin)).can.director, true);
  // sysadmin 也要遵守關卡：新的一天直接批主任會被擋。
  await fails(U.sysadmin, `select public.produce_approval_save('fruit','market_1','2026-10-02'::date,'director',null)`, [], /請先由市場副主任批核/);
  assert.equal((await approve(U.sysadmin, 'group_leader', '2026-10-02')).r.stage_label, '組(副)長');

  // 批核紀錄不可刪除、批核人與時間不可改。
  await actor(U.sysadmin);
  await assert.rejects(() => query(`delete from produce_handover_approvals`), /不可刪除/);
  await assert.rejects(() => query(`update produce_handover_approvals set approver_id=$1`, [U.a]), /不可變更/);

  // 二市場尚未啟用：即使是系統管理員也不能寫入。
  await fails(U.sysadmin, `select public.produce_approval_save('fruit','market_2',$1::date,'group_leader',null)`, [DAY], /未開放/);
  assert.equal((await query(`select public.produce_group_enabled('fruit','market_2') ok`)).rows[0].ok, false);
  assert.equal((await query(`select public.produce_group_enabled('vegetable','market_1') ok`)).rows[0].ok, false);

  // 接班人名單只含同市場水果組在職且有權限者。
  const receivers = (await rpc(U.a, `select public.produce_receivers('fruit','market_1') r`)).r;
  assert.deepEqual(receivers.map(row => row.name).sort(), ['水果乙', '水果組長'].sort());

  // 授權：前端只能呼叫對外 RPC 與 produce_market_allowed，內部判斷函式不開放。
  const grants = (await query(`select p.proname,
    (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=(select oid from pg_roles where rolname='authenticated') and a.privilege_type='EXECUTE') as granted
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'produce\\_%'`)).rows;
  const granted = new Set(grants.filter(row => Number(row.granted) > 0).map(row => row.proname));
  for (const name of ['produce_market_allowed', 'produce_day', 'produce_action', 'produce_entry_save', 'produce_approval_save', 'produce_receivers']) assert.ok(granted.has(name), `${name} 應授權給 authenticated`);
  for (const name of ['produce_approval_allowed', 'produce_user_allowed', 'produce_staff_market', 'produce_shift_items', 'produce_group_enabled']) assert.ok(!granted.has(name), `${name} 不應授權給 authenticated`);
  console.log('produce handover db checks passed');
} finally {
  await db.close();
}
