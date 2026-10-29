import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261029100000_restrict_manager_views.sql', import.meta.url), 'utf8');

const views = [
  'equipment_annual_cost_summary', 'equipment_central_monitoring_registry', 'equipment_lifecycle_overview',
  'vw_manager_abnormal_inspections', 'vw_manager_equipment', 'vw_manager_inspections', 'vw_manager_maintenance_orders',
  'vw_manager_monthly_kpi', 'vw_manager_open_repairs', 'vw_manager_repairs', 'vw_manager_today_inspections',
];
const officeViews = views.filter(v => v.startsWith('vw_manager_'));

// 還原現場：Supabase 預設把 public 新物件的所有權限授給 anon／authenticated，
// 加上 LibreOffice 用的 office_manager 只被授 SELECT。
const fixture = `
create role anon; create role authenticated; create role office_manager;
create table equipment(equipment_id int primary key, name text, status text);
alter table equipment enable row level security;
${views.map(v => `create view ${v} as select equipment_id as id, name, status from equipment;`).join('\n')}
grant usage on schema public to anon, authenticated, office_manager;
grant all on ${views.join(', ')} to authenticated;
grant select on ${officeViews.join(', ')} to office_manager;
`;

const db = new PGlite();
const priv = async (role, view, kind) =>
  (await db.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${view}`, kind])).rows[0].ok;

try {
  await db.exec(fixture);

  // 修正前：重現問題，登入使用者可讀可寫。
  assert.equal(await priv('authenticated', 'vw_manager_equipment', 'SELECT'), true, '修正前 authenticated 應可讀（重現問題）');
  assert.equal(await priv('authenticated', 'vw_manager_equipment', 'UPDATE'), true, '修正前 authenticated 應可寫（重現問題）');

  await db.exec(migration);

  // 修正後：anon／authenticated 對 11 個 view 完全沒有權限。
  for (const view of views) {
    for (const role of ['anon', 'authenticated']) {
      for (const kind of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        assert.equal(await priv(role, view, kind), false, `${role} 不得對 ${view} 有 ${kind}`);
      }
    }
  }

  // office_manager 的唯讀報表權限維持不變，且沒有寫入權。
  for (const view of officeViews) {
    assert.equal(await priv('office_manager', view, 'SELECT'), true, `office_manager 仍可讀 ${view}`);
    for (const kind of ['INSERT', 'UPDATE', 'DELETE']) assert.equal(await priv('office_manager', view, kind), false, `office_manager 不得 ${kind} ${view}`);
  }

  // 實際以 authenticated 身分查詢與更新都被拒絕。
  await db.exec(`set role authenticated`);
  await assert.rejects(db.query('select * from vw_manager_equipment'), /permission denied/);
  await assert.rejects(db.query(`update vw_manager_equipment set status = 'x'`), /permission denied/);
  await db.exec('reset role');

  // 只改權限：資料表與 view 本身都還在、資料未動。
  assert.equal((await db.query(`select count(*)::int as n from pg_views where schemaname='public'`)).rows[0].n, views.length);
} finally {
  await db.close();
}

console.log('管理報表 view 權限收斂測試通過：修正前可重現漏洞、修正後 anon／authenticated 無權限、office_manager 唯讀不變。');
