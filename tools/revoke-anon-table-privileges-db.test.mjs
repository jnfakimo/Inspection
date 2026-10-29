import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261029130000_revoke_anon_table_privileges.sql', import.meta.url), 'utf8');

const tables = [
  'account_applications', 'market_analysis_templates', 'market_data_points', 'market_data_sources', 'market_simulation_runs',
  'official_document_events', 'official_document_notifications', 'official_document_steps', 'official_documents', 'weather_api_cache',
];

// 還原現場：Supabase 預設授權（default privileges 把新資料表全部權限授給 anon／authenticated），表啟用 RLS 但沒有 anon policy。
const fixture = `
create role anon; create role authenticated; create role service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
${tables.map((t) => `create table ${t}(id int primary key, v text); alter table ${t} enable row level security; insert into ${t} values (1, 'x');`).join('\n')}
create table other_table(id int primary key);
`;

const db = new PGlite();
const priv = async (role, table, kind) => (await db.query(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${table}`, kind])).rows[0].ok;
const kinds = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

try {
  await db.exec(fixture);

  // 修正前：anon 持有全部權限（重現問題）。
  for (const t of tables) assert.equal(await priv('anon', t, 'SELECT'), true, `修正前 anon 應持有 ${t} 權限（重現問題）`);

  await db.exec(migration);

  // 修正後：10 張表 anon 完全沒有權限；authenticated／service_role 完全不變。
  for (const t of tables) {
    for (const kind of kinds) {
      assert.equal(await priv('anon', t, kind), false, `anon 不得對 ${t} 有 ${kind}`);
      assert.equal(await priv('authenticated', t, kind), true, `authenticated 對 ${t} 的 ${kind} 不得受影響`);
      assert.equal(await priv('service_role', t, kind), true, `service_role 對 ${t} 的 ${kind} 不得受影響`);
    }
  }
  // 其他既有的表不動。
  assert.equal(await priv('anon', 'other_table', 'SELECT'), true, '本 migration 只動指定的 10 張表');

  // 預設授權：日後新建的資料表 anon 預設沒有權限，authenticated／service_role 照舊有。
  await db.exec('create table future_table(id int primary key)');
  for (const kind of kinds) {
    assert.equal(await priv('anon', 'future_table', kind), false, `新表 anon 預設不得有 ${kind}`);
    assert.equal(await priv('authenticated', 'future_table', kind), true, `新表 authenticated 預設權限維持 ${kind}`);
  }

  // 實際以 anon 身分查詢被拒；資料與資料表都還在。
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from account_applications'), /permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int as n from account_applications')).rows[0].n, 1);
} finally {
  await db.close();
}

console.log('anon 權限收回測試通過：修正前可重現、修正後 10 張表 anon 無權限且 authenticated／service_role 不變、新表預設不再授權 anon。');
