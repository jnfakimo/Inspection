import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 水果組電子交接簿第二批：存貨交接明細、果菜報廢報告、運回放行單的資料庫規則。
// 以 PGlite 載入真實 migration（第一批＋第二批），只用最小假資料與假函式替代既有的使用者／權限基礎。
const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);
const base = readFileSync(new URL('../supabase/migrations/20261021090000_produce_handover_fruit.sql', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../supabase/migrations/20261022090000_produce_handover_documents.sql', import.meta.url), 'utf8');
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const U = { a: id(1), b: id(2), leader: id(3), deputy: id(4), director: id(5), sysadmin: id(6), outsider: id(7), c: id(9) };
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);
const rpc = async (who, sql, args = []) => { await actor(who); return (await query(sql, args)).rows[0].r; };
const fails = async (who, sql, args, pattern) => {
  await actor(who);
  await assert.rejects(() => query(sql, args), error => pattern.test(String(error.message)), `${sql} 應被擋下：${pattern}`);
};

const stockLines = [
  { purchase_no: 'A001', supplier_code: 'L00181-288', product_name: '蘋果', grade: 'A', pieces: '12', container: '10', weight: '120', location: 'A區3柱', reason: '未拍賣' },
  { product_name: '', pieces: '', weight: '' }, // 空白列略過
  { product_name: '柳丁', pieces: 5, weight: 50.456, extra: 'dropped' },
];
const saveStock = (who, stock = null, lines = stockLines, date = '2026-10-01') =>
  rpc(who, `select public.produce_stock_save('fruit','market_1',$1::uuid,$2::date,'一區一組',$3::jsonb) r`, [stock, date, JSON.stringify(lines)]);
const saveScrap = (who, scrap = null, over = {}) =>
  rpc(who, `select public.produce_scrap_save('fruit','market_1',$1::uuid,'2026-10-15'::date,$2,$3,$4,$5,$6::jsonb) r`,
    [scrap, over.remark ?? '農藥檢驗不合格', over.supervisor ?? '督導甲', over.auctioneer ?? '拍賣員乙', over.inspector ?? '檢驗員丙',
      JSON.stringify(over.lines ?? [{ receive_date: '2026-10-15', supplier_code: 'L00181-288', product_name: '蘋果', pieces: 12, container: '10', weight: 120, scrap_date: '2026-10-15', reason: '農藥檢驗不合格' }])]);
const submit = (who, type, doc) => rpc(who, `select public.produce_doc_submit('fruit','market_1',$1,$2::uuid) r`, [type, doc]);
const sign = (who, type, doc, stage, note = null) => rpc(who, `select public.produce_doc_sign('fruit','market_1',$1,$2::uuid,$3,$4) r`, [type, doc, stage, note]);
const signSql = `select public.produce_doc_sign('fruit','market_1',$1,$2::uuid,$3,null)`;

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
    create function business_market_approval_allowed(uuid,text,text) returns boolean language sql stable as
      $$select case $3 when 'deputy_director' then $1='${U.deputy}'::uuid when 'director' then $1='${U.director}'::uuid else false end$$;
    insert into roles values('sysadmin'),('unit_supervisor'),('reporter');
    insert into role_permissions values('unit_supervisor','sys_handover',true),('reporter','sys_handover',true);
    insert into departments values
      ('${id(90)}',null,'MKT1','active'),('${id(91)}',null,'MKT2','active'),
      ('${id(92)}','${id(90)}','MKT1-FRUIT','active'),('${id(94)}','${id(90)}','MKT1-ADMIN','active'),('${id(95)}','${id(90)}','MKT1-GUARD','active');
    insert into users(user_id,name,status,username,email,dept_id,rbac_role,role) values
      ('${U.a}','水果甲','active','a','a@example.test','${id(92)}','reporter','inspector'),
      ('${U.b}','水果乙','active','b','b@example.test','${id(92)}','reporter','inspector'),
      ('${U.c}','水果丙停用','inactive','c','c@example.test','${id(92)}','reporter','inspector'),
      ('${U.leader}','水果組長','active','leader','l@example.test','${id(92)}','unit_supervisor','supervisor'),
      ('${U.deputy}','副主任','active','deputy','d@example.test','${id(94)}','unit_supervisor','supervisor'),
      ('${U.director}','主任','active','director','dir@example.test','${id(94)}','unit_supervisor','supervisor'),
      ('${U.sysadmin}','管理員','active','sysadmin','s@example.test','${id(94)}','sysadmin','admin'),
      ('${U.outsider}','駐警','active','guard','g@example.test','${id(95)}','reporter','inspector');
  `);
  await db.exec(base);
  await db.exec(docs);
  await db.exec(docs); // 可重複套用
  await query(`insert into role_module_access values('reporter','handover','fruit','allow'),('unit_supervisor','handover','fruit','allow')
    on conflict(role_id,system_key,module_key) do update set mode='allow'`);

  /* 明細正規化 */
  const norm = async (kind, lines) => (await query(`select public.produce_normalize_lines($1,$2::jsonb) r`, [kind, JSON.stringify(lines)])).rows[0].r;
  const normalized = await norm('stock', stockLines);
  assert.equal(normalized.length, 2, '空白列略過');
  assert.equal(normalized[0].product_name, '蘋果');
  assert.equal(normalized[0].pieces, 12);
  assert.equal(Number(normalized[1].weight), 50.46, '重量四捨五入到小數 2 位');
  assert.equal('extra' in normalized[1], false, '未列入白名單的欄位丟棄');
  await assert.rejects(() => norm('stock', [{ pieces: 3 }]), /每一列都必須填寫品名/);
  await assert.rejects(() => norm('stock', [{ product_name: 'x', pieces: 'abc' }]), /必須是數字/);
  await assert.rejects(() => norm('stock', [{ product_name: 'x', pieces: 1.5 }]), /必須是整數/);
  await assert.rejects(() => norm('stock', [{ product_name: 'x', weight: -1 }]), /超出範圍/);
  await assert.rejects(() => norm('stock', [{ product_name: 'x'.repeat(81) }]), /過長/);
  await assert.rejects(() => norm('scrap', [{ product_name: 'x', receive_date: '2026-13-45' }]), /日期格式無效/);
  await assert.rejects(() => norm('stock', Array.from({ length: 61 }, () => ({ product_name: 'x' }))), /至多 60 列/);
  await assert.rejects(() => norm('stock', { not: 'array' }), /格式無效/);

  /* 存貨交接明細：草稿、權限、送出、鎖定 */
  const stock = await saveStock(U.a);
  assert.equal(stock.status, 'draft');
  assert.equal(stock.created_name, '水果甲');
  assert.equal(stock.lines.length, 2);
  await fails(U.outsider, `select public.produce_stock_save('fruit','market_1',null,'2026-10-01'::date,null,'[]'::jsonb)`, [], /未開放/);
  await fails(U.sysadmin, `select public.produce_stock_save('fruit','market_2',null,'2026-10-01'::date,null,'[]'::jsonb)`, [], /未開放/);
  await fails(U.b, `select public.produce_stock_save('fruit','market_1',$1::uuid,'2026-10-01'::date,null,'[]'::jsonb)`, [stock.stock_id], /只有填表人或組\(副\)長/);
  const edited = await saveStock(U.leader, stock.stock_id, [{ product_name: '蘋果', pieces: 20, weight: 200 }]);
  assert.equal(edited.lines[0].pieces, 20, '組長可修改草稿');
  await fails(U.a, `select public.produce_doc_submit('fruit','market_1','stock',$1::uuid)`, [id(80)], /找不到存貨交接/);
  await fails(U.b, `select public.produce_doc_submit('fruit','market_1','stock',$1::uuid)`, [stock.stock_id], /只有填表人或組\(副\)長/);
  const empty = await saveStock(U.a, null, []);
  await fails(U.a, `select public.produce_doc_submit('fruit','market_1','stock',$1::uuid)`, [empty.stock_id], /至少填寫一列/);
  await fails(U.b, signSql, ['stock', stock.stock_id, 'small_leader'], /尚未送出/);
  const submitted = await submit(U.a, 'stock', stock.stock_id);
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.submitted_name, '水果甲');
  await fails(U.a, `select public.produce_stock_save('fruit','market_1',$1::uuid,'2026-10-01'::date,null,'[]'::jsonb)`, [stock.stock_id], /已送出或作廢/);
  await actor(U.sysadmin);
  await assert.rejects(() => query(`update produce_stock_handovers set lines='[]'::jsonb where stock_id=$1`, [stock.stock_id]), /內容鎖定/);
  await assert.rejects(() => query(`update produce_stock_handovers set status='draft',submitted_at=null where stock_id=$1`, [stock.stock_id]), /內容鎖定/);
  await assert.rejects(() => query(`delete from produce_stock_handovers where stock_id=$1`, [stock.stock_id]), /不可刪除/);
  await fails(U.a, `select public.produce_doc_void('fruit','market_1','stock',$1::uuid,'寫錯了')`, [stock.stock_id], /只有草稿可以作廢/);

  /* 存貨交接：小組長 → 組(副)長，沒有主(副)任這一關 */
  await fails(U.leader, signSql, ['stock', stock.stock_id, 'group_leader'], /請先由小組長簽核/);
  await fails(U.a, signSql, ['stock', stock.stock_id, 'small_leader'], /小組長不可是填表人/);
  await fails(U.outsider, signSql, ['stock', stock.stock_id, 'small_leader'], /未開放/);
  await fails(U.b, signSql, ['stock', stock.stock_id, 'director'], /簽核階段無效/);
  await fails(U.deputy, signSql, ['stock', stock.stock_id, 'small_leader'], /不能簽核此階段/);
  const small = await sign(U.b, 'stock', stock.stock_id, 'small_leader', '核對無誤');
  assert.equal(small.stage_label, '小組長');
  assert.equal(small.signer_name, '水果乙');
  await fails(U.b, signSql, ['stock', stock.stock_id, 'small_leader'], /已簽核/);
  await fails(U.b, signSql, ['stock', stock.stock_id, 'group_leader'], /不能簽核此階段/);
  await fails(U.deputy, signSql, ['stock', stock.stock_id, 'group_leader'], /不能簽核此階段/);
  await fails(U.leader, `select public.produce_stock_distribute('fruit','market_1',$1::uuid,'accounting')`, [stock.stock_id], /請先由組\(副\)長簽核/);
  assert.equal((await sign(U.leader, 'stock', stock.stock_id, 'group_leader')).stage_label, '組(副)長');
  // 簽核紀錄不可改刪。
  await actor(U.sysadmin);
  await assert.rejects(() => query(`delete from produce_document_signatures`), /不可修改或刪除/);
  await assert.rejects(() => query(`update produce_document_signatures set signer_id=$1`, [U.a]), /不可修改或刪除/);

  /* 一式三份的送出紀錄 */
  const rpcDistribute = (who, target) => rpc(who, `select public.produce_stock_distribute('fruit','market_1',$1::uuid,$2) r`, [stock.stock_id, target]);
  await fails(U.deputy, `select public.produce_stock_distribute('fruit','market_1',$1::uuid,'accounting')`, [stock.stock_id], /只有水果組同仁/);
  await fails(U.a, `select public.produce_stock_distribute('fruit','market_1',$1::uuid,'self')`, [stock.stock_id], /送出對象無效/);
  const sentAccounting = await rpcDistribute(U.a, 'accounting');
  assert.ok(sentAccounting.sent_accounting_at);
  assert.equal(sentAccounting.sent_business_at, null);
  assert.equal((await rpcDistribute(U.b, 'accounting')).sent_accounting_name, '水果甲', '重複登記不覆蓋第一次');
  const sentBoth = await rpcDistribute(U.b, 'business');
  assert.equal(sentBoth.sent_business_name, '水果乙');

  /* 報廢報告：先輸入姓名；小組長 → 組(副)長 → 主(副)任 */
  const scrap = await saveScrap(U.a);
  assert.equal(scrap.lines[0].scrap_date, '2026-10-15');
  assert.equal(scrap.auctioneer_name, '拍賣員乙');
  const noNames = await saveScrap(U.a, null, { auctioneer: '', inspector: '' });
  await fails(U.a, `select public.produce_doc_submit('fruit','market_1','scrap',$1::uuid)`, [noNames.scrap_id], /拍賣員與檢驗員姓名/);
  const noLines = await saveScrap(U.a, null, { lines: [] });
  await fails(U.a, `select public.produce_doc_submit('fruit','market_1','scrap',$1::uuid)`, [noLines.scrap_id], /至少填寫一列/);
  assert.equal((await submit(U.a, 'scrap', scrap.scrap_id)).status, 'submitted');
  await fails(U.a, `select public.produce_scrap_save('fruit','market_1',$1::uuid,'2026-10-15'::date,null,null,null,null,'[]'::jsonb)`, [scrap.scrap_id], /已送出或作廢/);
  await actor(U.sysadmin);
  await assert.rejects(() => query(`update produce_scrap_reports set auctioneer_name='別人' where scrap_id=$1`, [scrap.scrap_id]), /內容鎖定/);
  await fails(U.director, signSql, ['scrap', scrap.scrap_id, 'director'], /請先由組\(副\)長簽核/);
  await fails(U.leader, signSql, ['scrap', scrap.scrap_id, 'group_leader'], /請先由小組長簽核/);
  await sign(U.b, 'scrap', scrap.scrap_id, 'small_leader');
  await fails(U.director, signSql, ['scrap', scrap.scrap_id, 'director'], /請先由組\(副\)長簽核/);
  await sign(U.leader, 'scrap', scrap.scrap_id, 'group_leader');
  await fails(U.a, signSql, ['scrap', scrap.scrap_id, 'director'], /不能簽核此階段/);
  await fails(U.leader, signSql, ['scrap', scrap.scrap_id, 'director'], /不能簽核此階段/);
  assert.equal((await sign(U.deputy, 'scrap', scrap.scrap_id, 'director')).stage_label, '主(副)任', '副主任可簽主(副)任這一關');
  await fails(U.director, signSql, ['scrap', scrap.scrap_id, 'director'], /已簽核/);
  const scrap2 = await saveScrap(U.a);
  await submit(U.a, 'scrap', scrap2.scrap_id);
  await sign(U.sysadmin, 'scrap', scrap2.scrap_id, 'small_leader');
  await sign(U.sysadmin, 'scrap', scrap2.scrap_id, 'group_leader');
  assert.equal((await sign(U.director, 'scrap', scrap2.scrap_id, 'director')).signer_name, '主任', '主任也可簽主(副)任這一關');

  /* 草稿作廢：留原因、不實體刪除、作廢後不可簽 */
  const draft = await saveScrap(U.a);
  await fails(U.b, `select public.produce_doc_void('fruit','market_1','scrap',$1::uuid,'重複建立')`, [draft.scrap_id], /只有填表人或組\(副\)長/);
  await fails(U.a, `select public.produce_doc_void('fruit','market_1','scrap',$1::uuid,'x')`, [draft.scrap_id], /2 至 200 字/);
  const voided = await rpc(U.a, `select public.produce_doc_void('fruit','market_1','scrap',$1::uuid,'重複建立') r`, [draft.scrap_id]);
  assert.equal(voided.status, 'void');
  assert.equal(voided.void_reason, '重複建立');
  await fails(U.a, `select public.produce_scrap_save('fruit','market_1',$1::uuid,'2026-10-15'::date,null,null,null,null,'[]'::jsonb)`, [draft.scrap_id], /已送出或作廢/);
  await actor(U.sysadmin);
  await assert.rejects(() => query(`update produce_scrap_reports set remark='x' where scrap_id=$1`, [draft.scrap_id]), /已作廢/);
  await fails(U.b, signSql, ['scrap', draft.scrap_id, 'small_leader'], /尚未送出或已作廢/);

  /* 運回放行單 */
  const issue = (who, over = {}) => rpc(who, `select public.produce_slip_issue('fruit',$1,$2,$3::timestamptz,$4,$5,$6,$7,$8,$9) r`,
    [over.market ?? 'market_1', over.paper ?? '001485', over.at ?? '2026-10-15T10:30:00+08:00', over.vehicle ?? '大發車行 ABC-123', over.product ?? '蘋果',
      over.supplier ?? '產地合作社', over.qty ?? '12 件／120 公斤', over.receiver ?? '王收貨', over.remark ?? null]);
  const roc = Number((await query(`select (extract(year from now() at time zone 'Asia/Taipei')::int-1911)::text r`)).rows[0].r);
  const slip1 = await issue(U.a);
  assert.equal(slip1.serial_no, `F1-${roc}-00001`);
  assert.equal(slip1.paper_no, '001485', '可手填紙本單號');
  assert.equal(slip1.issuer_name, '水果甲');
  assert.equal((await issue(U.b, { paper: null })).serial_no, `F1-${roc}-00002`, '流水號遞增');
  await fails(U.outsider, `select public.produce_slip_issue('fruit','market_1',null,now(),null,'蘋果',null,null,null,null)`, [], /未開放/);
  await fails(U.sysadmin, `select public.produce_slip_issue('fruit','market_2',null,now(),null,'蘋果',null,null,null,null)`, [], /未開放/);
  await fails(U.a, `select public.produce_slip_issue('fruit','market_1',null,now(),null,'   ',null,null,null,null)`, [], /請填寫品名/);
  await fails(U.a, `select public.produce_slip_issue('fruit','market_1',null,now()+interval '1 day',null,'蘋果',null,null,null,null)`, [], /不得晚於目前時間/);
  await fails(U.a, `select public.produce_slip_issue('fruit','market_1',null,null,null,'蘋果',null,null,null,null)`, [], /請填寫處理時間/);
  await fails(U.a, `select public.produce_slip_issue('fruit','market_1',$1,now(),null,'蘋果',null,null,null,null)`, ['9'.repeat(31)], /過長/);
  await actor(U.sysadmin);
  await assert.rejects(() => query(`update produce_release_slips set product_name='梨' where slip_id=$1`, [slip1.slip_id]), /不可修改，只能作廢/);
  await assert.rejects(() => query(`delete from produce_release_slips`), /不可刪除/);
  await fails(U.b, `select public.produce_slip_void('fruit','market_1',$1::uuid,'開錯單')`, [slip1.slip_id], /只有開單人或組\(副\)長/);
  await fails(U.a, `select public.produce_slip_void('fruit','market_1',$1::uuid,'x')`, [slip1.slip_id], /2 至 200 字/);
  const slipVoid = await rpc(U.leader, `select public.produce_slip_void('fruit','market_1',$1::uuid,'開錯單') r`, [slip1.slip_id]);
  assert.equal(slipVoid.status, 'void');
  assert.equal(slipVoid.voided_name, '水果組長');
  await fails(U.a, `select public.produce_slip_void('fruit','market_1',$1::uuid,'再作廢一次')`, [slip1.slip_id], /已作廢/);
  assert.equal((await issue(U.a)).serial_no, `F1-${roc}-00003`, '作廢的號碼不會重用');

  /* 品名建議：來自存貨、報廢與放行單；作廢單據不列入 */
  await saveScrap(U.a, null, { lines: [{ product_name: '香蕉', supplier_code: 'ZZ-1', pieces: 1 }] });
  const voidedDraft = await saveScrap(U.a, null, { lines: [{ product_name: '作廢品名', supplier_code: 'VOID-1', pieces: 1 }] });
  await rpc(U.a, `select public.produce_doc_void('fruit','market_1','scrap',$1::uuid,'重複建立') r`, [voidedDraft.scrap_id]);
  const suggestions = await rpc(U.b, `select public.produce_name_suggestions('fruit','market_1') r`);
  assert.ok(suggestions.products.includes('蘋果') && suggestions.products.includes('香蕉'));
  assert.ok(!suggestions.products.includes('作廢品名'), '作廢單據不列入建議');
  assert.ok(suggestions.suppliers.includes('L00181-288') && suggestions.suppliers.includes('ZZ-1') && !suggestions.suppliers.includes('VOID-1'));
  assert.equal(suggestions.products[0], '蘋果', '依使用次數排序');
  await fails(U.outsider, `select public.produce_name_suggestions('fruit','market_1')`, [], /未開放/);

  /* 授權：前端只能呼叫對外 RPC；內部函式與計數表不開放 */
  const grants = (await query(`select p.proname,
    (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where a.grantee=(select oid from pg_roles where rolname='authenticated') and a.privilege_type='EXECUTE') as granted
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'produce\\_%'`)).rows;
  const granted = new Set(grants.filter(row => Number(row.granted) > 0).map(row => row.proname));
  for (const name of ['produce_stock_save', 'produce_scrap_save', 'produce_doc_submit', 'produce_doc_void', 'produce_doc_sign',
    'produce_stock_distribute', 'produce_slip_issue', 'produce_slip_void', 'produce_name_suggestions']) assert.ok(granted.has(name), `${name} 應授權給 authenticated`);
  for (const name of ['produce_normalize_lines', 'produce_actor_name', 'produce_document_stage_allowed', 'produce_document_stage_order',
    'produce_signature_gate', 'produce_protect_document', 'produce_protect_slip']) assert.ok(!granted.has(name), `${name} 不應授權給 authenticated`);
  const tableGrants = (await query(`select table_name,privilege_type from information_schema.role_table_grants
    where grantee='authenticated' and table_name in ('produce_stock_handovers','produce_scrap_reports','produce_document_signatures','produce_release_slips','produce_slip_counters')`)).rows;
  assert.ok(tableGrants.every(row => row.privilege_type === 'SELECT'), '前端對單據表只有讀取權限');
  assert.ok(!tableGrants.some(row => row.table_name === 'produce_slip_counters'), '流水號計數表不開放給前端');
  console.log('produce handover document db checks passed');
} finally {
  await db.close();
}
