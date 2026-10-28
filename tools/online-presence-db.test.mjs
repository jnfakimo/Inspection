import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261028120000_online_presence.sql', import.meta.url), 'utf8');

const ids = {
  a: '00000000-0000-0000-0000-00000000000a', b: '00000000-0000-0000-0000-00000000000b', c: '00000000-0000-0000-0000-00000000000c',
  authA: '10000000-0000-0000-0000-00000000000a', authB: '10000000-0000-0000-0000-00000000000b', authC: '10000000-0000-0000-0000-00000000000c',
};

const fixture = `
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth',true),'')::uuid$$;
create table users(user_id uuid primary key,auth_id uuid,status text);
create function reject_physical_data_removal() returns trigger language plpgsql as $$ begin raise exception '禁止實體刪除'; end $$;
grant usage on schema public to authenticated;
`;

const db = new PGlite();
const as = auth => db.query(`select set_config('test.auth',$1,false)`, [auth ?? '']);
const beat = async auth => { await as(auth); return (await db.query('select presence_heartbeat() as n')).rows[0].n; };

try {
  await db.exec(fixture);
  await db.exec(migration);
  await db.query(`insert into users values($1,$4,'active'),($2,$5,'active'),($3,$6,'active')`,
    [ids.a, ids.b, ids.c, ids.authA, ids.authB, ids.authC]);

  // 1. 不同人各算一人；同一人再回報不會重複計算。
  assert.equal(await beat(ids.authA), 1);
  assert.equal(await beat(ids.authB), 2);
  assert.equal(await beat(ids.authA), 2, '同一人重複回報不得重複計數');
  assert.equal((await db.query('select count(*)::int as n from user_presence')).rows[0].n, 2, '每人只有一列');

  // 2. 超過 3 分鐘沒回報視為離線。
  await db.query(`update user_presence set last_seen_at = now() - interval '4 minutes' where user_id = $1`, [ids.a]);
  assert.equal(await beat(ids.authB), 1, '逾 3 分鐘未回報的人不計入');
  await db.query(`update user_presence set last_seen_at = now() - interval '2 minutes 30 seconds' where user_id = $1`, [ids.a]);
  assert.equal(await beat(ids.authB), 2, '3 分鐘內仍計入');

  // 3. 已停用帳號不計入。
  await db.query(`update users set status='inactive' where user_id=$1`, [ids.a]);
  assert.equal(await beat(ids.authB), 1, '停用帳號不計入在線人數');
  await db.query(`update users set status='active' where user_id=$1`, [ids.a]);

  // 4. 登出視為離線，且不是刪除資料列。
  assert.equal(await beat(ids.authA), 2);
  await as(ids.authA);
  await db.query('select presence_leave()');
  assert.equal(await beat(ids.authB), 1, '登出後不計入');
  assert.equal((await db.query('select count(*)::int as n from user_presence')).rows[0].n, 2, '登出不得刪除資料列');

  // 5. 未登入、停用帳號不得回報；停用帳號登出不報錯。
  await as(null);
  await assert.rejects(db.query('select presence_heartbeat()'), /找不到有效的使用者帳號/);
  await db.query(`update users set status='inactive' where user_id=$1`, [ids.c]);
  await as(ids.authC);
  await assert.rejects(db.query('select presence_heartbeat()'), /找不到有效的使用者帳號/);
  await db.query('select presence_leave()');

  // 6. 一般登入角色不能直接讀寫 presence 表，也不能實體刪除。
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select * from user_presence'), /permission denied/i, '不得直接讀取，避免洩漏誰在線');
  await assert.rejects(db.query(`insert into user_presence(user_id) values('${ids.c}')`), /permission denied/i);
  await db.exec('reset role');
  await assert.rejects(db.query('delete from user_presence'), /禁止實體刪除/);

  // 7. anon 不能呼叫函式。
  await db.exec('set role anon');
  await assert.rejects(db.query('select presence_heartbeat()'), /permission denied/i);
  await db.exec('reset role');

  console.log('在線人數資料庫測試通過：不重複計數、3 分鐘視窗、停用不計入、登出離線、表不可直接讀寫或實體刪除。');
} finally {
  await db.close();
}
