import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);

const bindingMigration = await readFile(new URL(
  '../../migrations/20261008070454_vehicle_driver_line_notifications.sql',
  import.meta.url,
), 'utf8');
const startMigration = await readFile(new URL(
  '../../migrations/20261008072136_vehicle_driver_line_link_start.sql',
  import.meta.url,
), 'utf8');

const ids = {
  active: '50000000-0000-0000-0000-000000000001',
  inactive: '50000000-0000-0000-0000-000000000002',
  nonDriver: '50000000-0000-0000-0000-000000000003',
};
const now = '2026-10-08T07:00:00.000Z';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.users (user_id uuid primary key, status text not null);
    create table public.vehicle_dispatch_drivers (
      user_id uuid primary key references public.users(user_id), active boolean not null
    );
    insert into public.users values
      ('${ids.active}', 'active'), ('${ids.inactive}', 'inactive'), ('${ids.nonDriver}', 'active');
    insert into public.vehicle_dispatch_drivers values
      ('${ids.active}', true), ('${ids.inactive}', true);
  `);
  await db.exec(bindingMigration);
  await db.exec(startMigration);
  return db;
}

async function start(db, userId, codeHash, consentedAt = now) {
  const result = await db.query(`
    select * from public.create_vehicle_line_link_intent($1, $2, $3::timestamptz, $4::timestamptz)
  `, [userId, codeHash, consentedAt, now]);
  return result.rows[0];
}

test('link start RPC is executable only by service role', async () => {
  const db = await database();
  const privileges = await db.query(`
    select has_function_privilege('authenticated',
      'public.create_vehicle_line_link_intent(uuid,text,timestamptz,timestamptz)', 'execute') as client_allowed,
      has_function_privilege('service_role',
      'public.create_vehicle_line_link_intent(uuid,text,timestamptz,timestamptz)', 'execute') as service_allowed
  `);
  assert.deepEqual(privileges.rows[0], { client_allowed: false, service_allowed: true });
  await db.close();
});

test('link start binds explicit consent, active roster, ten-minute expiry, and one pending code', async () => {
  const db = await database();
  const first = await start(db, ids.active, 'a'.repeat(64));
  assert.equal(first.outcome, 'created');
  assert.equal(new Date(first.expires_at).toISOString(), '2026-10-08T07:10:00.000Z');
  const second = await start(db, ids.active, 'b'.repeat(64));
  assert.equal(second.outcome, 'created');

  const intents = await db.query(`
    select code_hash, state, consented_at from public.vehicle_line_link_intents order by created_at, code_hash
  `);
  assert.equal(intents.rows.filter((row) => row.state === 'pending').length, 1);
  assert.ok(intents.rows.some((row) => row.code_hash === 'a'.repeat(64) && row.state === 'cancelled'));
  assert.ok(intents.rows.every((row) => new Date(row.consented_at).toISOString() === now));
  assert.equal((await start(db, ids.inactive, 'c'.repeat(64))).outcome, 'user_inactive');
  assert.equal((await start(db, ids.nonDriver, 'd'.repeat(64))).outcome, 'driver_inactive');
  await db.close();
});

test('linked account must be unlinked before starting a replacement and one LINE identity cannot move', async () => {
  const db = await database();
  await db.exec(`
    insert into public.vehicle_driver_line_bindings
      (user_id, line_user_id, state, consented_at, linked_at)
    values ('${ids.active}', 'U_SYNTHETIC_TEST_010', 'linked', now(), now());
  `);
  assert.equal((await start(db, ids.active, 'e'.repeat(64))).outcome, 'already_linked');
  const unlink = await db.query('select public.unlink_vehicle_line_account($1, $2::timestamptz) as unlinked', [ids.active, now]);
  assert.equal(unlink.rows[0].unlinked, true);
  assert.equal((await start(db, ids.active, 'f'.repeat(64))).outcome, 'created');

  await db.exec(`
    insert into public.vehicle_line_link_intents
      (user_id, code_hash, state, consented_at, created_at, expires_at)
    values ('${ids.nonDriver}', '${'9'.repeat(64)}', 'pending', '${now}', '${now}', '2026-10-08T07:10:00.000Z');
  `);
  const blocked = await db.query(`
    select * from public.consume_vehicle_line_link_intent($1, $2, $3, $4::timestamptz)
  `, ['9'.repeat(64), '1'.repeat(64), '2'.repeat(64), now]);
  assert.equal(blocked.rows[0].outcome, 'driver_inactive');
  await db.close();
});
