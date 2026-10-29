import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261029110000_lock_patrol_checkins.sql', import.meta.url), 'utf8');

// 還原現場：舊表啟用 RLS，但有 allow_all_for_now（all／public／true），authenticated 持有全部權限。
const fixture = `
create role anon; create role authenticated;
create table patrol_checkins(checkin_id int primary key, label text);
alter table patrol_checkins enable row level security;
create policy allow_all_for_now on patrol_checkins for all to public using (true);
grant usage on schema public to anon, authenticated;
grant all on patrol_checkins to authenticated;
`;

const db = new PGlite();
const priv = async (role, kind) => (await db.query(`select has_table_privilege($1, 'public.patrol_checkins', $2) as ok`, [role, kind])).rows[0].ok;

try {
  await db.exec(fixture);

  // 修正前：登入使用者可任意寫入、讀取（重現問題）。
  await db.exec('set role authenticated');
  await db.exec(`insert into patrol_checkins values (1, 'junk')`);
  assert.equal((await db.query('select count(*)::int as n from patrol_checkins')).rows[0].n, 1, '修正前 authenticated 應可寫可讀（重現問題）');
  await db.exec('reset role');

  await db.exec(migration);

  // 修正後：policy 已移除、anon／authenticated 沒有任何權限。
  assert.equal((await db.query(`select count(*)::int as n from pg_policies where tablename = 'patrol_checkins'`)).rows[0].n, 0);
  for (const role of ['anon', 'authenticated']) {
    for (const kind of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      assert.equal(await priv(role, kind), false, `${role} 不得對 patrol_checkins 有 ${kind}`);
    }
  }
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from patrol_checkins'), /permission denied/);
  await assert.rejects(db.query(`insert into patrol_checkins values (2, 'x')`), /permission denied/);
  await db.exec('reset role');

  // 只改權限：資料表與既有資料都還在，RLS 維持啟用。
  assert.equal((await db.query('select count(*)::int as n from patrol_checkins')).rows[0].n, 1);
  assert.equal((await db.query(`select relrowsecurity as on from pg_class where relname = 'patrol_checkins'`)).rows[0].on, true);
} finally {
  await db.close();
}

console.log('patrol_checkins 收斂測試通過：修正前可重現開放讀寫、修正後 anon／authenticated 無權限、資料與 RLS 維持。');
