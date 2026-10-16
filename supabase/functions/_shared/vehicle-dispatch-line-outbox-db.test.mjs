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
const outboxMigration = await readFile(new URL(
  '../../migrations/20261008071250_vehicle_dispatch_line_outbox.sql',
  import.meta.url,
), 'utf8');

const ids = {
  user1: '10000000-0000-0000-0000-000000000001',
  user2: '10000000-0000-0000-0000-000000000002',
  user3: '10000000-0000-0000-0000-000000000003',
  request1: '20000000-0000-0000-0000-000000000001',
  request2: '20000000-0000-0000-0000-000000000002',
  vehicle1: '30000000-0000-0000-0000-000000000001',
  vehicle2: '30000000-0000-0000-0000-000000000002',
  lease: '40000000-0000-0000-0000-000000000001',
};

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
    create table public.vehicle_dispatch_requests (
      request_id uuid primary key,
      status text not null,
      driver_id uuid references public.users(user_id),
      vehicle_id uuid,
      dispatch_note text
    );
    insert into public.users values
      ('${ids.user1}', 'active'),
      ('${ids.user2}', 'active'),
      ('${ids.user3}', 'active');
    insert into public.vehicle_dispatch_drivers values
      ('${ids.user1}', true), ('${ids.user2}', true), ('${ids.user3}', true);
  `);
  await db.exec(bindingMigration);
  await db.exec(outboxMigration);
  await db.exec(`
    insert into public.vehicle_driver_line_bindings
      (user_id, line_user_id, state, consented_at, linked_at)
    values
      ('${ids.user1}', 'U_SYNTHETIC_TEST_001', 'linked', now(), now()),
      ('${ids.user2}', 'U_SYNTHETIC_TEST_002', 'linked', now(), now());
  `);
  return db;
}

async function addRequest(db, requestId, { status = 'approved', driverId = null, vehicleId = null } = {}) {
  const initialStatus = status === 'assigned' ? 'approved' : status;
  await db.query(`
    insert into public.vehicle_dispatch_requests(request_id, status, driver_id, vehicle_id)
    values ($1, $2, $3, $4)
  `, [requestId, initialStatus, status === 'assigned' ? null : driverId, status === 'assigned' ? null : vehicleId]);
  if (status === 'assigned') {
    await db.query(`
      update public.vehicle_dispatch_requests
      set status = 'assigned', driver_id = $1, vehicle_id = $2
      where request_id = $3
    `, [driverId, vehicleId, requestId]);
  }
}

async function rowsForRequest(db, requestId) {
  return (await db.query(`
    select event_type, dispatch_revision, recipient_user_id, state, accepted_at,
      lease_token, lease_expires_at, retry_key
    from public.vehicle_dispatch_notification_outbox
    where request_id = $1
    order by event_type, dispatch_revision, recipient_user_id
  `, [requestId])).rows;
}

test('outbox is private and assignment writes one stable event in the same revision', async () => {
  const db = await database();
  const privileges = await db.query(`
    select has_table_privilege('authenticated', 'public.vehicle_dispatch_notification_outbox', 'select') as client_read,
      has_table_privilege('service_role', 'public.vehicle_dispatch_notification_outbox', 'select') as service_read,
      (select relrowsecurity from pg_class where oid = 'public.vehicle_dispatch_notification_outbox'::regclass) as rls
  `);
  assert.deepEqual(privileges.rows[0], { client_read: false, service_read: true, rls: true });

  await addRequest(db, ids.request1);
  await db.query(`
    update public.vehicle_dispatch_requests
    set status = 'assigned', driver_id = $1, vehicle_id = $2
    where request_id = $3
  `, [ids.user1, ids.vehicle1, ids.request1]);
  await db.query(`update public.vehicle_dispatch_requests set dispatch_note = 'synthetic note' where request_id = $1`, [ids.request1]);

  const request = (await db.query('select assignment_revision from public.vehicle_dispatch_requests where request_id = $1', [ids.request1])).rows[0];
  assert.equal(request.assignment_revision, 1);
  const rows = await rowsForRequest(db, ids.request1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, 'assignment');
  assert.equal(rows[0].dispatch_revision, 1);
  assert.equal(rows[0].recipient_user_id, ids.user1);
  assert.equal(rows[0].state, 'pending');
  assert.match(rows[0].retry_key, /^[0-9a-f-]{36}$/);

  await addRequest(db, ids.request2);
  await db.query(`update public.vehicle_dispatch_requests set status = 'assigned', driver_id = $1, vehicle_id = $2 where request_id = $3`, [ids.user3, ids.vehicle1, ids.request2]);
  assert.equal((await rowsForRequest(db, ids.request2))[0].state, 'skipped_unavailable');
  await db.close();
});

test('assignment and outbox roll back together', async () => {
  const db = await database();
  await addRequest(db, ids.request1);
  await db.exec('begin');
  await db.query(`update public.vehicle_dispatch_requests set status = 'assigned', driver_id = $1, vehicle_id = $2 where request_id = $3`, [ids.user1, ids.vehicle1, ids.request1]);
  assert.equal((await rowsForRequest(db, ids.request1)).length, 1);
  await db.exec('rollback');

  const request = (await db.query('select status, assignment_revision from public.vehicle_dispatch_requests where request_id = $1', [ids.request1])).rows[0];
  assert.deepEqual(request, { status: 'approved', assignment_revision: 0 });
  assert.equal((await rowsForRequest(db, ids.request1)).length, 0);
  await db.close();
});

test('reassignment cancels queued old delivery and queues the new driver', async () => {
  const db = await database();
  await addRequest(db, ids.request1, { status: 'assigned', driverId: ids.user1, vehicleId: ids.vehicle1 });
  await db.query(`update public.vehicle_dispatch_requests set driver_id = $1, vehicle_id = $2 where request_id = $3`, [ids.user2, ids.vehicle2, ids.request1]);

  const rows = await rowsForRequest(db, ids.request1);
  const oldAssignment = rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 1);
  const newAssignment = rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 2);
  assert.equal(oldAssignment.state, 'cancelled');
  assert.equal(newAssignment.state, 'pending');
  assert.equal(rows.some((row) => row.event_type === 'assignment_revoked'), false);
  assert.equal((await db.query('select assignment_revision from public.vehicle_dispatch_requests where request_id = $1', [ids.request1])).rows[0].assignment_revision, 2);
  await db.close();
});

test('accepted assignment gets a revocation on reassignment or cancellation', async () => {
  const db = await database();
  await addRequest(db, ids.request1, { status: 'assigned', driverId: ids.user1, vehicleId: ids.vehicle1 });
  await db.query(`
    update public.vehicle_dispatch_notification_outbox
    set state = 'accepted', accepted_at = now(), provider_http_status = 200
    where request_id = $1 and event_type = 'assignment'
  `, [ids.request1]);
  await db.query(`update public.vehicle_dispatch_requests set driver_id = $1, vehicle_id = $2 where request_id = $3`, [ids.user2, ids.vehicle2, ids.request1]);

  let rows = await rowsForRequest(db, ids.request1);
  assert.equal(rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 1).state, 'accepted');
  assert.equal(rows.find((row) => row.event_type === 'assignment_revoked').state, 'pending');
  assert.equal(rows.find((row) => row.event_type === 'assignment_revoked').recipient_user_id, ids.user1);
  assert.equal(rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 2).recipient_user_id, ids.user2);

  await addRequest(db, ids.request2, { status: 'assigned', driverId: ids.user1, vehicleId: ids.vehicle1 });
  await db.query(`
    update public.vehicle_dispatch_notification_outbox
    set state = 'accepted', accepted_at = now(), provider_http_status = 200
    where request_id = $1 and event_type = 'assignment'
  `, [ids.request2]);
  await db.query(`update public.vehicle_dispatch_requests set status = 'cancelled' where request_id = $1`, [ids.request2]);
  rows = await rowsForRequest(db, ids.request2);
  assert.equal(rows.find((row) => row.event_type === 'assignment_revoked').state, 'pending');
  assert.equal((await db.query('select assignment_revision from public.vehicle_dispatch_requests where request_id = $1', [ids.request2])).rows[0].assignment_revision, 2);
  await db.close();
});

test('in-flight sends become uncertain and unlink cancels remaining queued notices', async () => {
  const db = await database();
  await addRequest(db, ids.request1, { status: 'assigned', driverId: ids.user1, vehicleId: ids.vehicle1 });
  await db.query(`
    update public.vehicle_dispatch_notification_outbox
    set state = 'sending', lease_token = $1, lease_expires_at = now() + interval '1 minute'
    where request_id = $2 and event_type = 'assignment'
  `, [ids.lease, ids.request1]);
  await db.query(`update public.vehicle_dispatch_requests set driver_id = $1, vehicle_id = $2 where request_id = $3`, [ids.user2, ids.vehicle2, ids.request1]);
  let rows = await rowsForRequest(db, ids.request1);
  assert.equal(rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 1).state, 'uncertain');
  assert.equal(rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 1).lease_token, null);

  const linked = await db.query('select public.unlink_vehicle_line_account($1, now()) as unlinked', [ids.user2]);
  assert.equal(linked.rows[0].unlinked, true);
  rows = await rowsForRequest(db, ids.request1);
  assert.equal(rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 2).state, 'cancelled');
  const binding = (await db.query('select state, line_user_id from public.vehicle_driver_line_bindings where user_id = $1', [ids.user2])).rows[0];
  assert.deepEqual(binding, { state: 'unlinked', line_user_id: null });
  await db.close();
});
