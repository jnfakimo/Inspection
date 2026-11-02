import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);

const migration = await readFile(new URL(
  '../../migrations/20261031090000_line_group_register_codes.sql',
  import.meta.url,
), 'utf8');

const ids = {
  admin: '60000000-0000-0000-0000-000000000001',
  inactive: '60000000-0000-0000-0000-000000000002',
};
const groupA = `C${'a'.repeat(32)}`;
const groupB = `C${'b'.repeat(32)}`;
const now = '2026-10-31T01:00:00.000Z';
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.users (user_id uuid primary key, status text, role text, rbac_role text, dept_id uuid);
    create table public.system_settings (key text primary key, value text, updated_at timestamptz default now());
    create function public.reject_physical_data_removal() returns trigger language plpgsql as $$
    begin raise exception 'physical removal is not allowed'; end $$;
    insert into public.users values ('${ids.admin}', 'active', 'admin', 'sysadmin', null), ('${ids.inactive}', 'inactive', 'admin', 'sysadmin', null);
    insert into public.system_settings values ('line_group_id', '${groupA}', '${now}');
  `);
  await db.exec(migration);
  return db;
}

const create = async (db, userId, code, at = now) => (await db.query(
  'select * from public.create_line_group_register_code($1, $2, $3::timestamptz)', [userId, hash(code), at],
)).rows[0];
const consume = async (db, code, groupId, at = now) => (await db.query(
  'select public.consume_line_group_register_code($1, $2, $3, $4::timestamptz) as outcome',
  [hash(code), groupId, hash(groupId), at],
)).rows[0].outcome;
const currentGroup = async (db) => (await db.query(
  "select value from public.system_settings where key = 'line_group_id'",
)).rows[0].value;

test('register code table and RPCs are service-role only', async () => {
  const db = await database();
  const { rows: [row] } = await db.query(`
    select
      has_table_privilege('authenticated', 'public.line_group_register_codes', 'select') as client_select,
      has_table_privilege('anon', 'public.line_group_register_codes', 'insert') as anon_insert,
      has_function_privilege('authenticated', 'public.create_line_group_register_code(uuid,text,timestamptz)', 'execute') as client_create,
      has_function_privilege('authenticated', 'public.consume_line_group_register_code(text,text,text,timestamptz)', 'execute') as client_consume,
      has_function_privilege('service_role', 'public.consume_line_group_register_code(text,text,text,timestamptz)', 'execute') as service_consume,
      (select relrowsecurity from pg_class where oid = 'public.line_group_register_codes'::regclass) as rls
  `);
  assert.deepEqual(row, {
    client_select: false, anon_insert: false, client_create: false, client_consume: false, service_consume: true, rls: true,
  });
});

test('a valid code registers the group exactly once', async () => {
  const db = await database();
  assert.equal((await create(db, ids.admin, 'ABCD2345')).outcome, 'created');
  assert.equal(await consume(db, 'ABCD2345', groupB), 'registered');
  assert.equal(await currentGroup(db), groupB);
  assert.equal(await consume(db, 'ABCD2345', groupA), 'already_used');
  assert.equal(await currentGroup(db), groupB);
  const { rows: [stored] } = await db.query('select code_hash, group_id_hash, state from public.line_group_register_codes');
  assert.equal(stored.state, 'consumed');
  assert.equal(stored.group_id_hash, hash(groupB));
  assert.notEqual(stored.code_hash, 'ABCD2345');
});

test('unknown, expired, superseded and malformed requests never change the group', async () => {
  const db = await database();
  assert.equal(await consume(db, 'ZZZZ9999', groupB), 'invalid_code');

  await create(db, ids.admin, 'OLDC2345');
  await create(db, ids.admin, 'NEWC2345');
  assert.equal(await consume(db, 'OLDC2345', groupB), 'already_used');

  assert.equal(await consume(db, 'NEWC2345', groupB, '2026-10-31T01:10:00.000Z'), 'expired');
  assert.equal(await consume(db, 'NEWC2345', groupB), 'already_used');

  await create(db, ids.admin, 'FMTC2345');
  assert.equal(await consume(db, 'FMTC2345', 'synthetic-group'), 'invalid_request');
  assert.equal(await currentGroup(db), groupA);

  const { rows } = await db.query("select count(*)::int as pending from public.line_group_register_codes where state = 'pending'");
  assert.equal(rows[0].pending, 1);
});

test('inactive accounts cannot create codes and codes cannot be physically removed', async () => {
  const db = await database();
  assert.equal((await create(db, ids.inactive, 'ABCD2345')).outcome, 'user_inactive');
  await create(db, ids.admin, 'ABCD2345');
  await assert.rejects(db.query('delete from public.line_group_register_codes'), /physical removal/);
});

test('revoked status, role and issuance scope cancel codes without changing the group', async () => {
  for (const change of ["status='inactive'", "status=null", "role='reporter',rbac_role='reporter'",
    "role='admin',rbac_role='reporter'", "dept_id='70000000-0000-0000-0000-000000000001'"]) {
    const db = await database();
    await create(db, ids.admin, 'ABCD2345');
    await db.exec(`update users set ${change} where user_id='${ids.admin}'`);
    assert.equal(await consume(db, 'ABCD2345', groupB), 'issuer_unauthorized', change);
    assert.equal(await currentGroup(db), groupA);
    await db.exec(`update users set status='active',role='admin',rbac_role='sysadmin',dept_id=null where user_id='${ids.admin}'`);
    assert.equal(await consume(db, 'ABCD2345', groupB), 'already_used');
    await db.close();
  }
});

test('creation matches existing administrator roles and refuses non-admins', async () => {
  const db = await database();
  let sequence = 0;
  for (const [role, rbac, expected] of [['reporter','reporter','issuer_unauthorized'],
    ['supervisor','unit_supervisor','issuer_unauthorized'],[null,null,'issuer_unauthorized'],
    ['admin','reporter','created'],['reporter','sysadmin','created']]) {
    await db.query('update users set role=$1,rbac_role=$2 where user_id=$3',[role,rbac,ids.admin]);
    assert.equal((await create(db,ids.admin,`CODE${++sequence}`)).outcome,expected);
  }
});

test('failed group write rolls back code consumption atomically', async () => {
  const db = await database();
  await create(db,ids.admin,'ABCD2345');
  await db.exec(`create function reject_test_group_write() returns trigger language plpgsql as $$
    begin raise exception 'synthetic write failure'; end $$;
    create trigger synthetic_failure before update on system_settings for each row execute function reject_test_group_write();`);
  await assert.rejects(consume(db,'ABCD2345',groupB), /synthetic write failure/);
  assert.equal(await currentGroup(db),groupA);
  assert.equal((await db.query('select state from line_group_register_codes')).rows[0].state,'pending');
  await db.exec('drop trigger synthetic_failure on system_settings');
  assert.equal(await consume(db,'ABCD2345',groupB),'registered');
});

test('pre-upgrade codes fail closed and migration can be reapplied', async () => {
  const db = await database();
  await create(db,ids.admin,'ABCD2345');
  await db.exec('update line_group_register_codes set issuer_scope=null');
  await db.exec(migration);
  assert.equal(await consume(db,'ABCD2345',groupB),'issuer_unauthorized');
  assert.equal(await currentGroup(db),groupA);
});

test('transaction rollback restores consumption; queued duplicate calls cannot overwrite', async () => {
  const db = await database();
  await create(db,ids.admin,'ABCD2345');
  await db.exec('begin');
  assert.equal(await consume(db,'ABCD2345',groupB),'registered');
  await db.exec('rollback');
  assert.equal(await currentGroup(db),groupA);
  // PGlite serializes these calls; this is NOT a real PostgreSQL multi-session race test.
  assert.deepEqual(await Promise.all([consume(db,'ABCD2345',groupB),consume(db,'ABCD2345',groupA)]),['registered','already_used']);
  assert.equal(await currentGroup(db),groupB);
});
