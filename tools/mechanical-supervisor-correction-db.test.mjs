import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261001150000_mechanical_supervisor_corrections.sql', import.meta.url), 'utf8');
const supervisor = '00000000-0000-0000-0000-000000000001';
const worker = '00000000-0000-0000-0000-000000000002';
const otherMarketSupervisor = '00000000-0000-0000-0000-000000000003';
const entry = '10000000-0000-0000-0000-000000000001';
const query = (sql, args = []) => db.query(sql, args);
const actor = (user, role) => query("select set_config('test.actor',$1,false),set_config('test.role',$2,false)", [user, role]);
const correct = (expected, item, details, result, notes, market = 'market_2') =>
  query('select public.mechanical_supervisor_correct_entry($1,$2,$3,$4,$5,$6,$7) as data',
    [entry, market, item, details, result, notes, expected]);

try {
  await db.exec(`
    create role anon; create role authenticated;
    create table public.users(user_id uuid primary key,name text);
    create table public.mechanical_handover_entries(entry_id uuid primary key,market_code text,work_date date,
      work_item text not null,details text,result text,notes text,is_deleted boolean not null default false);
    create table public.audit_logs(audit_id uuid primary key default gen_random_uuid(),table_name text,record_id text,
      action text,changes jsonb,operator_id uuid,source text);
    create function public.active_user_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function public.mechanical_market_allowed(text) returns boolean language sql stable as
      $$select $1=case when public.active_user_id()='$3'::uuid then 'market_1' else 'market_2' end$$;
    create function public.can_approve_mechanical_handover() returns boolean language sql stable as
      $$select current_setting('test.role',true) in ('unit_supervisor','sysadmin')$$;
    insert into public.users values
      ('${supervisor}','機電主管'),('${worker}','機電同仁'),('${otherMarketSupervisor}','一市主管');
    insert into public.mechanical_handover_entries values
      ('${entry}','market_2','2026-10-01','原始工作','原始說明','處理中','原始備註',false);
  `.replaceAll('$3', otherMarketSupervisor));
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('set role authenticated');
  await actor(worker, 'technician');
  await assert.rejects(correct(null, '竄改', null, '正常', null), /主管|permission/);
  await actor(otherMarketSupervisor, 'unit_supervisor');
  await assert.rejects(correct(null, '跨市場', null, '正常', null), /主管|權限/);
  await actor(supervisor, 'unit_supervisor');
  await assert.rejects(correct(null, '', '', '正常', ''), /格式無效/);
  await assert.rejects(correct(null, '有效工作', '', null, ''), /格式無效/);
  const first = (await correct(null, '修正工作', '修正說明', '已完成', '修正備註')).rows[0].data;
  assert.equal(first.before_values.result, '處理中');
  assert.equal(first.after_values.result, '已完成');
  assert.equal(first.corrected_by, supervisor);
  await db.exec('reset role');
  assert.equal((await query('select work_item,result from public.mechanical_handover_entries where entry_id=$1', [entry])).rows[0].result, '處理中');
  await db.exec('set role authenticated');
  await assert.rejects(correct(null, '過期覆寫', null, '正常', null), /重新載入/);
  const second = (await correct(first.correction_id, '二次修正', '修正說明', '待料', '修正備註')).rows[0].data;
  await db.exec('reset role');
  assert.equal(second.before_values.work_item, '修正工作');
  assert.equal((await query('select count(*)::int as n from public.mechanical_handover_corrections')).rows[0].n, 2);
  assert.equal((await query("select count(*)::int as n from public.audit_logs where source='mechanical-supervisor-correction'")).rows[0].n, 2);

  await db.exec('set role authenticated');
  await actor(otherMarketSupervisor, 'unit_supervisor');
  assert.equal((await query('select count(*)::int as n from public.mechanical_handover_corrections')).rows[0].n, 0,
    '其他市場不得讀取修正歷程');
  await actor(supervisor, 'unit_supervisor');
  assert.equal((await query('select count(*)::int as n from public.mechanical_handover_corrections')).rows[0].n, 2);
  await assert.rejects(query('insert into public.mechanical_handover_corrections(entry_id,market_code,work_date,before_values,after_values,corrected_by) values($1,$2,current_date,$3,$4,$5)',
    [entry, 'market_2', '{}', '{"result":"偽造"}', supervisor]), /permission denied/);
  await db.exec('reset role');
  await assert.rejects(query('update public.mechanical_handover_entries set notes=$1 where entry_id=$2', ['覆寫', entry]), /原始工作紀錄不可覆寫/);

  await db.exec(`create function public.reject_correction_audit() returns trigger language plpgsql as
    $$begin raise exception 'audit unavailable'; end$$;
    create trigger reject_correction_audit before insert on public.audit_logs
      for each row execute function public.reject_correction_audit();`);
  await assert.rejects(correct(second.correction_id, '三次修正', '說明', '正常', '備註'), /audit unavailable/);
  assert.equal((await query('select count(*)::int as n from public.mechanical_handover_corrections')).rows[0].n, 2,
    '中央稽核失敗時修正應回滾');
  console.log('主管修正 DB 通過：角色與市場隔離、不可覆寫原始資料、逐次前後值、過期衝突、稽核失敗回滾。');
} finally { await db.close(); }
