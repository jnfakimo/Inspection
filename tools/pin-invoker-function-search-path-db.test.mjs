import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261106100000_pin_invoker_function_search_path.sql', import.meta.url), 'utf8');

// 正式庫現況（2026-11-06 讀取）：15 個 security invoker 函式沒有 search_path；本文原樣複製。
const fixture = `
create role anon; create role authenticated; create role service_role;
create sequence public.req_seq; create sequence public.wo_seq; create sequence public.vehicle_dispatch_seq; create sequence public.meeting_booking_no_seq;
create table public.materials(material_code text);
create schema evil; create table evil.materials(material_code text);
insert into evil.materials values ('CAT-1F-0099');

create function public.gen_material_code(p_cat text, p_floor text) returns text language plpgsql as $$
declare pre text; n int;
begin
  pre := coalesce(nullif(upper(p_cat),''),'OTH') || '-' || coalesce(nullif(upper(p_floor),''),'NA') || '-';
  select coalesce(max((regexp_replace(material_code, '^.*-', ''))::int),0)+1
    into n from materials where material_code like pre || '%';
  return pre || lpad(n::text, 4, '0');
end;
$$;
create function public.gen_meeting_booking_no() returns text language sql as $$
  select 'MR-' || to_char(current_date,'YYYYMMDD') || '-' || lpad(nextval('public.meeting_booking_no_seq')::text,6,'0')
$$;
create function public.gen_req_no() returns text language sql as $$ select 'RP'||to_char(now(),'YYYYMMDD')||'-'||lpad(nextval('req_seq')::text,4,'0') $$;
create function public.gen_vehicle_dispatch_no() returns text language sql as $$
  select 'CAR-' || to_char(now() at time zone 'Asia/Taipei','YYYYMMDD') || '-' ||
         lpad(nextval('vehicle_dispatch_seq')::text,4,'0')
$$;
create function public.gen_wo_no() returns text language sql as $$ select 'WO'||to_char(now(),'YYYYMMDD')||'-'||lpad(nextval('wo_seq')::text,4,'0') $$;

create function public.reject_physical_data_removal() returns trigger language plpgsql as $$
begin
  raise exception '永久資料保護：資料表 % 禁止 DELETE/TRUNCATE，請改用狀態停用。', tg_table_name using errcode = '55000';
end;
$$;
create function public.reject_security_alert_removal() returns trigger language plpgsql as $$
begin
  raise exception '安全告警永久保存：禁止刪除或清空 security_alerts。' using errcode = '55000';
end;
$$;
create function public.reject_security_monitor_history_change() returns trigger language plpgsql as $$
begin
  raise exception '資安監測歷程永久保存：禁止修改、刪除或清空 %。', tg_table_name using errcode='55000';
end;
$$;
create function public.reject_security_session_block_removal() returns trigger language plpgsql as $$
begin
  raise exception '安全工作階段阻擋紀錄永久保存：禁止刪除或清空。' using errcode='55000';
end;
$$;
create function public.set_equipment_lifecycle_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
create function public.set_floor_spaces_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
create function public.set_materials_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
create function public.set_plan_markers_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;
create function public.touch_vehicle_tracking_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
create function public.touch_vehicle_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;

-- 正式庫的權限：reject_security_monitor_history_change 只有 postgres／service_role，其餘保持 PUBLIC 可執行。
revoke all on function public.reject_security_monitor_history_change() from public;
grant execute on function public.reject_security_monitor_history_change() to service_role;
grant execute on function public.gen_req_no() to anon, authenticated, service_role;

-- 用來驗證觸發器函式：updated_at 與禁止實體刪除（逐列與整表 TRUNCATE）。
create table public.t_touch(id int primary key, updated_at timestamptz);
create trigger trg_touch before insert or update on public.t_touch for each row execute function public.touch_vehicle_updated_at();
create table public.t_protected(id int primary key);
create trigger trg_no_delete before delete on public.t_protected for each row execute function public.reject_physical_data_removal();
create trigger trg_no_truncate before truncate on public.t_protected for each statement execute function public.reject_physical_data_removal();
create table public.t_alerts(id int primary key);
create trigger trg_alert_delete before delete on public.t_alerts for each row execute function public.reject_security_alert_removal();
create table public.t_history(id int primary key);
create trigger trg_hist before update or delete on public.t_history for each row execute function public.reject_security_monitor_history_change();
create table public.t_blocks(id int primary key);
create trigger trg_block_delete before delete on public.t_blocks for each row execute function public.reject_security_session_block_removal();
insert into public.t_protected values (1); insert into public.t_alerts values (1); insert into public.t_history values (1); insert into public.t_blocks values (1);
`;

const GEN = ['gen_material_code', 'gen_meeting_booking_no', 'gen_req_no', 'gen_vehicle_dispatch_no', 'gen_wo_no'];
const TRIGGERS = [
  'reject_physical_data_removal', 'reject_security_alert_removal', 'reject_security_monitor_history_change', 'reject_security_session_block_removal',
  'set_equipment_lifecycle_updated_at', 'set_floor_spaces_updated_at', 'set_materials_updated_at', 'set_plan_markers_updated_at',
  'touch_vehicle_tracking_updated_at', 'touch_vehicle_updated_at',
];

const db = new PGlite();
const state = async () => Object.fromEntries((await db.query(
  `select p.proname as name, p.proconfig as config, p.proacl::text as acl, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer, md5(p.prosrc) as body
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1)`, [[...GEN, ...TRIGGERS]])).rows.map(r => [r.name, r]));
const rejects = async sql => { try { await db.exec(sql); return null; } catch (error) { return error; } };

try {
  await db.exec(fixture);
  const before = await state();
  assert.equal(Object.keys(before).length, 15, '應有 15 個函式');
  for (const [name, row] of Object.entries(before)) assert.equal(row.config, null, `修正前 ${name} 不應有 search_path（重現問題）`);

  // 修正前：呼叫端 search_path 先含可寫入的 evil，gen_material_code 讀到攻擊者的 materials（重現搜尋路徑問題）。
  await db.exec('set search_path = evil, public');
  assert.equal((await db.query(`select public.gen_material_code('cat', '1f') as v`)).rows[0].v, 'CAT-1F-0100', '修正前應被 evil.materials 搶先解析（重現問題）');

  await db.exec(migration);

  // 修正後：15 個函式都固定 search_path。
  const after = await state();
  for (const name of GEN) assert.deepEqual(after[name].config, ['search_path=public, pg_temp'], `${name} 應固定為 public, pg_temp`);
  for (const name of TRIGGERS) assert.deepEqual(after[name].config, ['search_path=""'], `${name} 應固定為空字串`);

  // 本文、擁有者、權限（含 PUBLIC 的 EXECUTE）、security invoker 完全不變。
  for (const name of Object.keys(before)) {
    assert.equal(after[name].body, before[name].body, `${name} 的本文不得改變`);
    assert.equal(after[name].acl, before[name].acl, `${name} 的權限不得改變`);
    assert.equal(after[name].owner, before[name].owner, `${name} 的擁有者不得改變`);
    assert.equal(after[name].definer, false, `${name} 仍應是 security invoker`);
  }

  // 同樣的呼叫端 search_path（evil 優先）也不再被搶先解析。
  assert.equal((await db.query(`select public.gen_material_code('cat', '1f') as v`)).rows[0].v, 'CAT-1F-0001', '修正後應讀 public.materials，不被 evil.materials 搶先');
  await db.exec(`insert into public.materials values ('CAT-1F-0001')`);
  assert.equal((await db.query(`select public.gen_material_code('cat', '1f') as v`)).rows[0].v, 'CAT-1F-0002', '編號應依 public.materials 遞增');
  await db.exec('reset search_path');

  // 編號函式功能不變（序列都在 public）。
  const one = async fn => (await db.query(`select public.${fn}() as v`)).rows[0].v;
  assert.match(await one('gen_req_no'), /^RP\d{8}-0001$/);
  assert.match(await one('gen_wo_no'), /^WO\d{8}-0001$/);
  assert.match(await one('gen_vehicle_dispatch_no'), /^CAR-\d{8}-0001$/);
  assert.match(await one('gen_meeting_booking_no'), /^MR-\d{8}-000001$/);
  assert.match(await one('gen_req_no'), /^RP\d{8}-0002$/);

  // 觸發器函式在空字串 search_path 下仍正常：updated_at 照樣更新。
  await db.exec(`insert into public.t_touch(id) values (1)`);
  assert.notEqual((await db.query(`select updated_at as v from public.t_touch where id = 1`)).rows[0].v, null, 'touch_vehicle_updated_at 應仍會寫入 updated_at');

  // 核心保護：reject_physical_data_removal（正式庫 62 個觸發器使用）仍擋 DELETE 與 TRUNCATE，錯誤碼 55000。
  const del = await rejects(`delete from public.t_protected`);
  assert.ok(del && del.code === '55000' && /禁止 DELETE\/TRUNCATE/.test(del.message), 'reject_physical_data_removal 修正後仍必須擋 DELETE');
  const trunc = await rejects(`truncate public.t_protected`);
  assert.ok(trunc && trunc.code === '55000', 'reject_physical_data_removal 修正後仍必須擋 TRUNCATE');
  assert.equal((await db.query(`select count(*)::int as n from public.t_protected`)).rows[0].n, 1, '資料列不得被刪除');

  // 其他三個 reject_* 觸發器同樣仍有效。
  const alert = await rejects(`delete from public.t_alerts`);
  assert.ok(alert && alert.code === '55000', 'reject_security_alert_removal 仍必須擋 DELETE');
  const history = await rejects(`update public.t_history set id = 2`);
  assert.ok(history && history.code === '55000', 'reject_security_monitor_history_change 仍必須擋 UPDATE');
  const block = await rejects(`delete from public.t_blocks`);
  assert.ok(block && block.code === '55000', 'reject_security_session_block_removal 仍必須擋 DELETE');

  // 冪等：再套用一次不失敗、設定不變。
  await db.exec(migration);
  assert.deepEqual((await state()).gen_req_no.config, ['search_path=public, pg_temp']);

  // 函式不存在的環境（全新佈建）：略過，不報錯。
  const empty = new PGlite();
  try {
    await empty.exec(migration);
  } finally {
    await empty.close();
  }
} finally {
  await db.close();
}

console.log('15 個 invoker 函式 search_path 測試通過：修正前可重現搜尋路徑問題、修正後固定且功能不變（含禁止實體刪除仍有效）、本文與權限不變、可重複套用、函式不存在時略過。');
