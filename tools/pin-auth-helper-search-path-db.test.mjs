import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261029140000_pin_auth_helper_search_path.sql', import.meta.url), 'utf8');

// 還原正式庫現況：兩個 security definer 函式沒有 search_path，只有 service_role 可執行；
// pgcrypto 的 crypt()／gen_salt() 在 extensions schema（以簡單函式代替真實加密，只驗證名稱解析）。
const fixture = `
create role anon; create role authenticated; create role service_role; create role attacker;
create schema auth; create schema extensions;
create table auth.users(id uuid primary key, email text, encrypted_password text);
insert into auth.users values ('11111111-1111-4111-8111-111111111111', 'a@example.invalid', 'old');
create function extensions.gen_salt(text) returns text language sql as $$ select 'salt' $$;
create function extensions.crypt(text, text) returns text language sql as $$ select 'hash:' || $1 || ':' || $2 $$;

create function public.admin_reset_user_password(p_email text, p_new_password text) returns void language plpgsql security definer as $$
begin
  update auth.users set encrypted_password = crypt(p_new_password, gen_salt('bf')) where email = p_email;
end;
$$;
create function public.get_auth_user_id_by_email(p_email text) returns uuid language plpgsql security definer as $$
begin
  return (select id from auth.users where email = p_email limit 1);
end;
$$;
revoke all on function public.admin_reset_user_password(text, text), public.get_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_reset_user_password(text, text), public.get_auth_user_id_by_email(text) to service_role;

-- 攻擊者可寫入 public，並放一個同名的 crypt()，用來搶先解析。
create function public.crypt(text, text) returns text language sql as $$ select 'HIJACKED' $$;
`;

const db = new PGlite();
const config = async name => (await db.query(`select proconfig from pg_proc where proname = $1`, [name])).rows[0].proconfig;
const password = async () => (await db.query(`select encrypted_password as p from auth.users`)).rows[0].p;
const privs = async name => (await db.query(
  `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as svc, pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
   from pg_proc p where p.proname = $1`, [name])).rows[0];

try {
  await db.exec(fixture);
  // 呼叫端的 search_path 先含 public（攻擊者可寫），再含 extensions。
  await db.exec(`set search_path = public, extensions`);

  // 修正前：沒有 search_path，同名函式被搶先解析，密碼雜湊被改寫成 HIJACKED（重現問題）。
  assert.equal(await config('admin_reset_user_password'), null);
  assert.equal(await config('get_auth_user_id_by_email'), null);
  await db.exec(`select public.admin_reset_user_password('a@example.invalid', 'new-pass')`);
  assert.equal(await password(), 'HIJACKED', '修正前 search_path 劫持應成功（重現問題）');
  await db.exec(`update auth.users set encrypted_password = 'old'`);

  await db.exec(migration);

  // 修正後：兩個函式都固定了 search_path。
  assert.deepEqual(await config('admin_reset_user_password'), ['search_path=extensions, pg_temp']);
  assert.deepEqual(await config('get_auth_user_id_by_email'), ['search_path=""']);

  // 即使呼叫端 search_path 仍是 public 優先，也不再被劫持，且功能正常。
  await db.exec(`select public.admin_reset_user_password('a@example.invalid', 'new-pass')`);
  assert.equal(await password(), 'hash:new-pass:salt', '修正後應使用 extensions.crypt，不得被 public.crypt 劫持');
  assert.equal((await db.query(`select public.get_auth_user_id_by_email('a@example.invalid') as id`)).rows[0].id, '11111111-1111-4111-8111-111111111111');
  assert.equal((await db.query(`select public.get_auth_user_id_by_email('nobody@example.invalid') as id`)).rows[0].id, null);

  // 權限、擁有者與 security definer 完全不變：只有 service_role 可執行。
  for (const name of ['admin_reset_user_password', 'get_auth_user_id_by_email']) {
    assert.deepEqual(await privs(name), { anon: false, auth: false, svc: true, owner: 'postgres', definer: true }, `${name} 的權限、擁有者或 definer 不得改變`);
  }

  // 冪等：再套用一次不會失敗，設定不變。
  await db.exec(migration);
  assert.deepEqual(await config('admin_reset_user_password'), ['search_path=extensions, pg_temp']);

  // 函式不存在的環境（例如全新佈建）：略過，不報錯。
  const empty = new PGlite();
  try {
    await empty.exec(migration);
  } finally {
    await empty.close();
  }
} finally {
  await db.close();
}

console.log('Auth 輔助函式 search_path 測試通過：修正前可重現劫持、修正後固定路徑且不被劫持、權限不變、可重複套用、函式不存在時略過。');
