import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);

const migration = await readFile(new URL(
  '../../migrations/20261008070454_vehicle_driver_line_notifications.sql',
  import.meta.url,
), 'utf8');

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.users (user_id uuid primary key, status text not null);
    create table public.vehicle_dispatch_drivers (
      user_id uuid primary key references public.users(user_id),
      active boolean not null
    );
    insert into public.users values
      ('10000000-0000-0000-0000-000000000001', 'active'),
      ('10000000-0000-0000-0000-000000000002', 'active'),
      ('10000000-0000-0000-0000-000000000003', 'inactive');
    insert into public.vehicle_dispatch_drivers values
      ('10000000-0000-0000-0000-000000000001', true),
      ('10000000-0000-0000-0000-000000000002', true),
      ('10000000-0000-0000-0000-000000000003', true);
  `);
  await db.exec(migration);
  return db;
}

const now = '2026-10-08T07:00:00.000Z';
const user1 = '10000000-0000-0000-0000-000000000001';
const user2 = '10000000-0000-0000-0000-000000000002';
const user3 = '10000000-0000-0000-0000-000000000003';
const hashes = {
  code1: 'a'.repeat(64),
  code2: 'b'.repeat(64),
  nonce1: 'c'.repeat(64),
  nonce2: 'd'.repeat(64),
  nonce3: '1'.repeat(64),
  line1: 'e'.repeat(64),
  line2: 'f'.repeat(64),
  code3: '2'.repeat(64),
};

async function addIntent(db, userId, codeHash, createdAt = now, expiresAt = '2026-10-08T07:10:00.000Z') {
  await db.query(`
    insert into public.vehicle_line_link_intents
      (user_id, code_hash, consented_at, created_at, expires_at)
    values ($1, $2, $3, $3, $4)
  `, [userId, codeHash, createdAt, expiresAt]);
}

async function consume(db, codeHash, lineHash, nonceHash, at = now) {
  const result = await db.query(`
    select * from public.consume_vehicle_line_link_intent($1, $2, $3, $4::timestamptz)
  `, [codeHash, lineHash, nonceHash, at]);
  return result.rows[0];
}

async function complete(db, nonceHash, lineHash, rawLineId, result = 'ok', at = now) {
  const reply = await db.query(`
    select public.complete_vehicle_line_account_link($1, $2, $3, $4, $5::timestamptz) as outcome
  `, [nonceHash, lineHash, rawLineId, result, at]);
  return reply.rows[0].outcome;
}

test('migration creates private binding tables and service-role-only RPCs', async () => {
  const db = await database();
  const relations = await db.query(`
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'vehicle_driver_line_bindings', 'vehicle_line_link_intents', 'vehicle_line_account_link_nonces'
    ) order by c.relname
  `);
  assert.equal(relations.rows.length, 3);
  assert.ok(relations.rows.every((row) => row.relrowsecurity));
  for (const table of ['vehicle_driver_line_bindings', 'vehicle_line_link_intents', 'vehicle_line_account_link_nonces']) {
    const access = await db.query('select has_table_privilege($1, $2, $3) as allowed', ['authenticated', `public.${table}`, 'select']);
    assert.equal(access.rows[0].allowed, false, `${table} must not be readable by authenticated clients`);
    const serviceAccess = await db.query('select has_table_privilege($1, $2, $3) as allowed', ['service_role', `public.${table}`, 'select']);
    assert.equal(serviceAccess.rows[0].allowed, true, `${table} must remain available to service role`);
  }
  const functionAccess = await db.query(`
    select has_function_privilege('authenticated',
      'public.complete_vehicle_line_account_link(text,text,text,text,timestamptz)', 'execute') as allowed
  `);
  assert.equal(functionAccess.rows[0].allowed, false);
  await db.close();
});

test('link intent is consent-bound, expires, and can be consumed only once', async () => {
  const db = await database();
  await addIntent(db, user1, hashes.code1);
  assert.deepEqual(await consume(db, hashes.code1, hashes.line1, hashes.nonce1), {
    user_id: user1,
    intent_id: (await db.query('select intent_id from public.vehicle_line_link_intents where code_hash = $1', [hashes.code1])).rows[0].intent_id,
    outcome: 'ready',
  });
  assert.equal((await consume(db, hashes.code1, hashes.line1, hashes.nonce2)).outcome, 'already_used');

  await addIntent(db, user2, hashes.code2, '2026-10-08T06:50:00.000Z', '2026-10-08T07:00:00.000Z');
  assert.equal((await consume(db, hashes.code2, hashes.line2, hashes.nonce2)).outcome, 'expired');
  const expired = await db.query('select state from public.vehicle_line_link_intents where code_hash = $1', [hashes.code2]);
  assert.equal(expired.rows[0].state, 'expired');
  await db.close();
});

test('account-link webhook nonce checks LINE identity, one-time use, driver eligibility, and unlink', async () => {
  const db = await database();
  await addIntent(db, user1, hashes.code1);
  await consume(db, hashes.code1, hashes.line1, hashes.nonce1);

  assert.equal(await complete(db, hashes.nonce1, hashes.line2, 'U_SYNTHETIC_TEST_001'), 'identity_mismatch');
  assert.equal(await complete(db, hashes.nonce1, hashes.line1, 'U_SYNTHETIC_TEST_001'), 'linked');
  assert.equal(await complete(db, hashes.nonce1, hashes.line1, 'U_SYNTHETIC_TEST_001'), 'already_used');
  const binding = await db.query('select user_id, line_user_id, state from public.vehicle_driver_line_bindings');
  assert.deepEqual(binding.rows, [{ user_id: user1, line_user_id: 'U_SYNTHETIC_TEST_001', state: 'linked' }]);
  const privateFlow = await db.query(`
    select count(*)::integer as count from public.vehicle_line_account_link_nonces
    where line_user_id_hash = $1 and nonce_hash = $2
  `, [hashes.line1, hashes.nonce1]);
  assert.equal(privateFlow.rows[0].count, 1);

  await addIntent(db, user2, hashes.code3);
  await consume(db, hashes.code3, hashes.line1, hashes.nonce3);
  assert.equal(await complete(db, hashes.nonce3, hashes.line1, 'U_SYNTHETIC_TEST_001'), 'binding_conflict');

  const unlinked = await db.query('select public.unlink_vehicle_line_account($1, $2::timestamptz) as unlinked', [user1, '2026-10-08T07:01:00.000Z']);
  assert.equal(unlinked.rows[0].unlinked, true);
  const cleared = await db.query('select line_user_id, state from public.vehicle_driver_line_bindings where user_id = $1', [user1]);
  assert.deepEqual(cleared.rows[0], { line_user_id: null, state: 'unlinked' });
  assert.equal(await complete(db, hashes.nonce3, hashes.line1, 'U_SYNTHETIC_TEST_001'), 'already_used');
  await db.close();
});

test('non-driver cannot consume a link intent', async () => {
  const db = await database();
  await addIntent(db, user3, hashes.code1);
  assert.equal((await consume(db, hashes.code1, hashes.line1, hashes.nonce1)).outcome, 'driver_inactive');
  const state = await db.query('select state from public.vehicle_line_link_intents where code_hash = $1', [hashes.code1]);
  assert.equal(state.rows[0].state, 'cancelled');
  await db.close();
});
