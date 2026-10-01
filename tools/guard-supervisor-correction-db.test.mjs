import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261001170000_guard_supervisor_corrections.sql', import.meta.url), 'utf8');
const supervisor = '00000000-0000-0000-0000-000000000001';
const worker = '00000000-0000-0000-0000-000000000002';
const otherMarket = '00000000-0000-0000-0000-000000000003';
const logId = '10000000-0000-0000-0000-000000000001';
const incidentId = '20000000-0000-0000-0000-000000000001';
const query = (sql, args = []) => db.query(sql, args);
const actor = user => query("select set_config('test.actor',$1,false)", [user]);
const report = (description = '原始事件', handoverItem = null, reportedUpward = null) => ({
  duty_summary: '本班值勤正常', important_notes: '需注意門禁',
  incidents: [{ id: incidentId, time: '2026-10-01T10:00', location: '一樓', category: '門禁管制',
    description, action: '已處理', reported_to: '指揮台', handover_item: handoverItem,
    reported_upward: reportedUpward }],
  items: [{ name: '無線電', qty: 2, condition: '正常', note: '已清點' }],
});
const correct = (after, expected = null, market = 'market_1', stamp = '2026-10-01T02:00:00Z') =>
  query('select public.guard_supervisor_correct_log($1,$2,$3::jsonb,$4::timestamptz,$5) as data',
    [logId, market, JSON.stringify(after), stamp, expected]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.users(user_id uuid primary key,name text);
    create table public.user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table public.role_module_access(role_id text,system_key text,module_key text,mode text);
    create table public.guard_handover_logs(log_id uuid primary key,market_code text,duty_date date,
      duty_summary text,important_notes text,incidents jsonb,items jsonb,status text,
      updated_at timestamptz);
    create table public.audit_logs(audit_id uuid primary key default gen_random_uuid(),table_name text,
      record_id text,action text,changes jsonb,operator_id uuid,source text);
    create function public.active_user_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function public.active_rbac_role() returns text language sql stable as
      $$select 'unit_supervisor'::text$$;
    create function public.guard_market_allowed(p_market text) returns boolean language sql stable as
      $$select p_market=case when public.active_user_id()='${otherMarket}'::uuid then 'market_2' else 'market_1' end$$;
    create function public.has_system_access(text) returns boolean language sql stable as $$select true$$;
    create function public.reject_physical_data_removal() returns trigger language plpgsql as
      $$begin raise exception 'no physical removal'; end$$;
    insert into public.users values ('${supervisor}','主管'),('${worker}','同仁'),('${otherMarket}','二市主管');
    insert into public.user_module_access values
      ('${supervisor}','handover','guard-approve','allow'),
      ('${worker}','handover','guard-approve','deny'),
      ('${otherMarket}','handover','guard-approve','allow');
    insert into public.guard_handover_logs values
      ('${logId}','market_1','2026-10-01','原始概況','原始交辦',
       '[{"id":"${incidentId}","time":"2026-10-01T10:00","location":"一樓","category":"門禁管制","description":"原始事件","action":"已處理","reported_to":"指揮台"}]',
       '[{"name":"無線電","qty":1,"condition":"正常","note":""}]',
       'received','2026-10-01T02:00:00Z');
  `);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('set role authenticated');
  await actor(worker);
  await assert.rejects(correct(report('無權修正')), /主管|權限/);
  await actor(otherMarket);
  await assert.rejects(correct(report('跨市場'), null, 'market_1'), /主管|權限/);
  assert.equal((await query('select count(*)::int n from public.guard_handover_corrections')).rows[0].n, 0);
  await actor(supervisor);
  await assert.rejects(correct({ ...report(), incidents: [] }), /不可新增或移除/);
  await assert.rejects(correct(report('旗標錯誤', 'yes', false)), /異常事件修正內容無效/);
  const first = (await correct(report('修正事件', true, false))).rows[0].data;
  assert.equal(first.before_values.incidents[0].handover_item, null);
  assert.equal(first.after_values.incidents[0].handover_item, true);
  assert.equal(first.after_values.incidents[0].reported_upward, false);
  assert.equal(first.corrected_by, supervisor);
  await assert.rejects(correct(report('過期覆寫')), /重新載入/);
  const second = (await correct(report('再次修正', false, true), first.correction_id)).rows[0].data;
  assert.equal(second.before_values.incidents[0].description, '修正事件');
  assert.equal(second.after_values.incidents[0].reported_upward, true);
  await assert.rejects(query('insert into public.guard_handover_corrections(log_id,market_code,duty_date,before_values,after_values,corrected_by) values($1,$2,current_date,$3,$4,$5)',
    [logId, 'market_1', '{}', '{"duty_summary":"偽造"}', supervisor]), /permission denied/);
  await db.exec('reset role');
  await assert.rejects(query('update public.guard_handover_logs set duty_summary=$1 where log_id=$2', ['覆寫', logId]), /原始交接內容不可覆寫/);
  await query("update public.guard_handover_logs set status='submitted' where log_id=$1", [logId]);
  assert.equal((await query('select duty_summary from public.guard_handover_logs where log_id=$1', [logId])).rows[0].duty_summary, '原始概況');
  assert.equal((await query("select count(*)::int n from public.audit_logs where source='guard-supervisor-correction'")).rows[0].n, 2);
  await db.exec('set role authenticated');
  await actor(otherMarket);
  assert.equal((await query('select count(*)::int n from public.guard_handover_corrections')).rows[0].n, 0);
  await db.exec('reset role');
  await db.exec(`create function public.reject_guard_audit() returns trigger language plpgsql as
    $$begin raise exception 'audit unavailable'; end$$;
    create trigger reject_guard_audit before insert on public.audit_logs
      for each row execute function public.reject_guard_audit();`);
  await actor(supervisor);
  await assert.rejects(correct(report('稽核失敗'), second.correction_id), /audit unavailable/);
  assert.equal((await query('select count(*)::int n from public.guard_handover_corrections')).rows[0].n, 2);
  console.log('駐警主管修正 DB 通過：市場與權限、旗標、版本衝突、原件保護、歷程及稽核回滾。');
} finally { await db.close(); }
