import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);

const bindingMigration = await readFile(new URL('../../migrations/20261008070454_vehicle_driver_line_notifications.sql', import.meta.url), 'utf8');
const outboxMigration = await readFile(new URL('../../migrations/20261008071250_vehicle_dispatch_line_outbox.sql', import.meta.url), 'utf8');
const linkStartMigration = await readFile(new URL('../../migrations/20261008072136_vehicle_driver_line_link_start.sql', import.meta.url), 'utf8');
const workerMigration = await readFile(new URL('../../migrations/20261008073738_vehicle_dispatch_line_worker_leases.sql', import.meta.url), 'utf8');
const preferencesMigration = await readFile(new URL('../../migrations/20261008081918_vehicle_personal_line_notifications.sql', import.meta.url), 'utf8');

const user1 = '10000000-0000-0000-0000-000000000001';
const user2 = '10000000-0000-0000-0000-000000000002';
const request1 = '20000000-0000-0000-0000-000000000001';
const vehicle1 = '30000000-0000-0000-0000-000000000001';
const start = '2026-10-08T08:00:00.000Z';
const afterLease = '2026-10-08T08:03:00.000Z';

async function database(enableProduction = true, enqueueBeforePreferences = false) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.users (user_id uuid primary key, status text not null, username text not null, name text not null);
    create table public.vehicle_dispatch_drivers (user_id uuid primary key references public.users(user_id), active boolean not null);
    create table public.vehicle_dispatch_requests (
      request_id uuid primary key, status text not null, driver_id uuid references public.users(user_id),
      vehicle_id uuid, dispatch_note text
    );
    insert into public.users values ('${user1}', 'active', '022443', 'Test Driver'), ('${user2}', 'active', '022444', 'Other Driver');
    insert into public.vehicle_dispatch_drivers values ('${user1}', true), ('${user2}', true);
  `);
  await db.exec(bindingMigration);
  await db.exec(outboxMigration);
  await db.exec(linkStartMigration);
  await db.exec(linkStartMigration);
  await db.exec(workerMigration);
  await db.exec(workerMigration);
  if (enqueueBeforePreferences) {
    await db.exec(`
      insert into public.vehicle_driver_line_bindings(user_id,line_user_id,state,consented_at,linked_at)
      values ('${user1}','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','linked',now(),now()),
             ('${user2}','Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','linked',now(),now());
    `);
    await assign(db);
    assert.equal((await db.query(`select state from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0].state, 'pending');
  }
  await db.exec(preferencesMigration);
  await db.exec(preferencesMigration);
  if (!enqueueBeforePreferences) {
    await db.exec(`
      insert into public.vehicle_driver_line_bindings(user_id,line_user_id,state,consented_at,linked_at)
      values ('${user1}','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','linked',now(),now()),
             ('${user2}','Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','linked',now(),now());
    `);
  }
  if (enableProduction) await savePreferences(db, {
    personal: true, assignment: true, revoked: true, test: false, recipient: null,
  });
  if (enableProduction) {
    const state = (await db.query(`select personal_enabled, assignment_enabled, assignment_revoked_enabled from public.vehicle_line_notification_settings where singleton_id=true`)).rows[0];
    assert.deepEqual(state, { personal_enabled: true, assignment_enabled: true, assignment_revoked_enabled: true });
    assert.equal((await db.query(`select public.vehicle_line_personal_event_enabled('assignment') as enabled`)).rows[0].enabled, true);
  }
  return db;
}

async function savePreferences(db, { personal, assignment, revoked, test, recipient }, actor = user1) {
  await db.query(`select public.save_vehicle_line_notification_settings($1,$2,$3,$4,$5,$6)`, [
    personal, assignment, revoked, test, recipient, actor,
  ]);
}

async function assign(db, requestId = request1) {
  await db.query(`insert into public.vehicle_dispatch_requests(request_id,status) values ($1,'approved')`, [requestId]);
  await db.query(`update public.vehicle_dispatch_requests set status='assigned',driver_id=$1,vehicle_id=$2 where request_id=$3`, [user1, vehicle1, requestId]);
  await db.query(`update public.vehicle_dispatch_notification_outbox set next_attempt_at=$1::timestamptz where request_id=$2`, [start, requestId]);
}

async function claim(db, at = start) {
  const result = await db.query(`select * from public.claim_vehicle_dispatch_line_notifications(20,90,$1::timestamptz)`, [at]);
  return result.rows;
}

async function prepare(db, job, at = start) {
  return (await db.query(`select * from public.prepare_vehicle_dispatch_line_notification($1,$2,$3::timestamptz)`, [job.outbox_id, job.lease_token, at])).rows[0];
}

async function rowsForRequest(db, requestId) {
  return (await db.query(`select event_type, dispatch_revision, recipient_user_id, state, accepted_at, lease_token, lease_expires_at, retry_key
    from public.vehicle_dispatch_notification_outbox where request_id=$1 order by event_type, dispatch_revision`, [requestId])).rows;
}

async function finish(db, job, input) {
  return (await db.query(`select public.finish_vehicle_dispatch_line_notification($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) as result`, [
    job.outbox_id, job.lease_token, input.resolution, input.status ?? null, input.error ?? null,
    input.next ?? null, input.acceptedRequestId ?? null, input.now ?? start,
  ])).rows[0].result;
}

test('worker RPCs are service-role-only and concurrent claims lease each event once', async () => {
  const db = await database();
  await assign(db);
  assert.equal((await db.query(`select count(*)::int as count from public.vehicle_dispatch_notification_outbox`)).rows[0].count, 1);
  const permissions = await db.query(`
    select has_function_privilege('authenticated','public.claim_vehicle_dispatch_line_notifications(integer,integer,timestamptz)','execute') as client_claim,
      has_function_privilege('service_role','public.claim_vehicle_dispatch_line_notifications(integer,integer,timestamptz)','execute') as service_claim,
      has_function_privilege('authenticated','public.prepare_vehicle_dispatch_line_notification(uuid,uuid,timestamptz)','execute') as client_prepare,
      has_function_privilege('service_role','public.prepare_vehicle_dispatch_line_notification(uuid,uuid,timestamptz)','execute') as service_prepare,
      has_function_privilege('authenticated','public.finish_vehicle_dispatch_line_notification(uuid,uuid,text,smallint,text,timestamptz,text,timestamptz)','execute') as client_finish,
      has_function_privilege('service_role','public.finish_vehicle_dispatch_line_notification(uuid,uuid,text,smallint,text,timestamptz,text,timestamptz)','execute') as service_finish
  `);
  assert.deepEqual(permissions.rows[0], { client_claim: false, service_claim: true, client_prepare: false, service_prepare: true, client_finish: false, service_finish: true });

  const [left, right] = await Promise.all([claim(db), claim(db)]);
  assert.equal(left.length + right.length, 1);
  const row = (await db.query(`select state,lease_token from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0];
  assert.equal(row.state, 'leased');
  assert.ok(row.lease_token);
  await db.close();
});

test('private LINE tables enable RLS and expose direct table privileges only to service_role', async () => {
  const db = await database(false);
  const result = await db.query(`
    select c.relname as table_name, c.relrowsecurity as rls,
      has_table_privilege('anon', c.oid, 'select') as anon_select,
      has_table_privilege('authenticated', c.oid, 'select') as auth_select,
      has_table_privilege('anon', c.oid, 'insert') as anon_insert,
      has_table_privilege('authenticated', c.oid, 'insert') as auth_insert,
      has_table_privilege('service_role', c.oid, 'select') as service_select,
      has_table_privilege('service_role', c.oid, 'insert') as service_insert,
      has_table_privilege('service_role', c.oid, 'delete') as service_delete
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
    order by c.relname
  `, [[
    'vehicle_driver_line_bindings', 'vehicle_line_link_intents', 'vehicle_line_account_link_nonces',
    'vehicle_dispatch_notification_outbox', 'vehicle_line_notification_settings', 'vehicle_line_notification_test_runs',
  ]]);
  assert.equal(result.rows.length, 6);
  for (const row of result.rows) {
    assert.equal(row.rls, true, `${row.table_name} must keep RLS enabled`);
    assert.equal(row.anon_select, false, `${row.table_name} must not be readable by anon`);
    assert.equal(row.auth_select, false, `${row.table_name} must not be readable by authenticated clients`);
    assert.equal(row.anon_insert, false, `${row.table_name} must not be writable by anon`);
    assert.equal(row.auth_insert, false, `${row.table_name} must not be writable by authenticated clients`);
    assert.equal(row.service_select, true, `${row.table_name} must be readable by server code`);
    assert.equal(row.service_insert, true, `${row.table_name} must be writable by server code`);
    assert.equal(row.service_delete, row.table_name !== 'vehicle_line_notification_settings',
      `${row.table_name} must keep its intended delete grant`);
  }
  await db.close();
});

test('personal notifications default off and disabled assignment events never enter the outbox', async () => {
  const db = await database(false);
  const defaults = (await db.query(`select personal_enabled, assignment_enabled, assignment_revoked_enabled, test_enabled from public.vehicle_line_notification_settings`)).rows[0];
  assert.deepEqual(defaults, { personal_enabled: false, assignment_enabled: false, assignment_revoked_enabled: false, test_enabled: false });
  await assign(db);
  assert.equal((await db.query(`select count(*)::int as count from public.vehicle_dispatch_notification_outbox`)).rows[0].count, 0);
  assert.deepEqual(await claim(db), []);
  await db.query(`delete from public.vehicle_line_notification_settings where singleton_id=true`);
  await assign(db, '20000000-0000-0000-0000-000000000002');
  assert.equal((await db.query(`select count(*)::int as count from public.vehicle_dispatch_notification_outbox`)).rows[0].count, 0);
  await db.close();
});

test('default-off migration cancels any event queued in the migration rollout gap', async () => {
  const db = await database(false, true);
  const row = (await db.query(`select state, last_error_code from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0];
  assert.deepEqual(row, { state: 'cancelled', last_error_code: 'preferences_disabled' });
  assert.deepEqual(await claim(db), []);
  await db.close();
});

test('turning off preferences cancels queued and leased work before prepare can send it', async () => {
  const db = await database();
  await assign(db);
  const [job] = await claim(db);
  assert.ok(job);
  await savePreferences(db, { personal: false, assignment: false, revoked: false, test: false, recipient: null });
  const row = (await db.query(`select state,lease_token,last_error_code from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0];
  assert.deepEqual(row, { state: 'cancelled', lease_token: null, last_error_code: 'preferences_disabled' });
  assert.equal((await prepare(db, job)).outcome, 'lease_lost');
  await db.close();
});

test('event toggles govern enqueue, reassignment and revocation independently', async () => {
  const db = await database(false);
  await savePreferences(db, { personal: true, assignment: true, revoked: false, test: false, recipient: null });
  await assign(db);
  const original = (await rowsForRequest(db, request1))[0];
  assert.equal(original.event_type, 'assignment');
  assert.equal(original.state, 'pending');
  await db.query(`update public.vehicle_dispatch_notification_outbox set state='accepted',accepted_at=now(),provider_http_status=200 where request_id=$1`, [request1]);
  await db.query(`update public.vehicle_dispatch_requests set driver_id=$1,vehicle_id=$2 where request_id=$3`, [user2, '30000000-0000-0000-0000-000000000002', request1]);
  const rows = await rowsForRequest(db, request1);
  assert.equal(rows.filter((row) => row.event_type === 'assignment_revoked').length, 0);
  assert.equal(rows.filter((row) => row.event_type === 'assignment').length, 2);
  assert.equal(rows.find((row) => row.event_type === 'assignment' && row.dispatch_revision === 2).state, 'pending');
  await db.close();
});

test('synthetic test run can address only the verified 022443 profile and is separate from dispatch jobs', async () => {
  const db = await database(false);
  await savePreferences(db, { personal: false, assignment: false, revoked: false, test: true, recipient: user1 });
  const created = await db.query(`select public.create_vehicle_line_notification_test($1,$2::timestamptz) as test_run_id`, [user2, start]);
  const testRunId = created.rows[0].test_run_id;
  const claimed = await db.query(`select * from public.claim_vehicle_line_notification_test($1,$2::timestamptz,90)`, [testRunId, start]);
  assert.equal(claimed.rows.length, 1);
  assert.equal(claimed.rows[0].test_run_id, testRunId);
  assert.deepEqual(await claim(db), []);
  const prepared = (await db.query(`select * from public.prepare_vehicle_line_notification_test($1,$2,$3::timestamptz)`, [testRunId, claimed.rows[0].lease_token, start])).rows[0];
  assert.equal(prepared.outcome, 'ready');
  assert.equal(prepared.line_user_id, 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.match(prepared.message_text, /合成測試/);
  assert.equal((await db.query(`select count(*)::int as count from public.vehicle_dispatch_requests`)).rows[0].count, 0);
  assert.equal((await db.query(`select public.finish_vehicle_line_notification_test($1,$2,'accepted',200::smallint,$3::timestamptz) as result`, [testRunId, claimed.rows[0].lease_token, start])).rows[0].result, 'accepted');

  const queued = (await db.query(`select public.create_vehicle_line_notification_test($1,$2::timestamptz) as test_run_id`, [user2, start])).rows[0].test_run_id;
  await savePreferences(db, { personal: false, assignment: false, revoked: false, test: false, recipient: user1 });
  assert.deepEqual(await db.query(`select * from public.claim_vehicle_line_notification_test($1,$2::timestamptz,90)`, [queued, start]).then(result => result.rows), []);
  assert.equal((await db.query(`select state from public.vehicle_line_notification_test_runs where test_run_id=$1`, [queued])).rows[0].state, 'cancelled');

  await assert.rejects(savePreferences(db, { personal: false, assignment: false, revoked: false, test: true, recipient: user2 }), /test_recipient_not_eligible/);
  await db.close();
});

test('synthetic recipient eligibility is rechecked at creation, claim, and prepare', async () => {
  const db = await database(false);
  await savePreferences(db, { personal: false, assignment: false, revoked: false, test: true, recipient: user1 });

  await assert.rejects(
    savePreferences(db, { personal: false, assignment: false, revoked: false, test: true, recipient: user2 }),
    /test_recipient_not_eligible/,
  );
  await db.query(`update public.users set username='022449' where user_id=$1`, [user1]);
  await assert.rejects(
    db.query(`select public.create_vehicle_line_notification_test($1,$2::timestamptz)`, [user2, start]),
    /test_recipient_not_ready/,
  );
  await db.query(`update public.users set username='022443' where user_id=$1`, [user1]);
  await db.query(`update public.vehicle_dispatch_drivers set active=false where user_id=$1`, [user1]);
  await assert.rejects(
    db.query(`select public.create_vehicle_line_notification_test($1,$2::timestamptz)`, [user2, start]),
    /test_recipient_not_ready/,
  );
  await db.query(`update public.vehicle_dispatch_drivers set active=true where user_id=$1`, [user1]);

  const beforeClaim = (await db.query(`select public.create_vehicle_line_notification_test($1,$2::timestamptz) as test_run_id`, [user2, start])).rows[0].test_run_id;
  await db.query(`update public.users set status='inactive' where user_id=$1`, [user1]);
  assert.deepEqual(await db.query(`select * from public.claim_vehicle_line_notification_test($1,$2::timestamptz,90)`, [beforeClaim, start]).then((result) => result.rows), []);
  assert.equal((await db.query(`select state from public.vehicle_line_notification_test_runs where test_run_id=$1`, [beforeClaim])).rows[0].state, 'suppressed');

  await db.query(`update public.users set status='active' where user_id=$1`, [user1]);
  const beforePrepare = (await db.query(`select public.create_vehicle_line_notification_test($1,$2::timestamptz) as test_run_id`, [user2, start])).rows[0].test_run_id;
  const [lease] = (await db.query(`select * from public.claim_vehicle_line_notification_test($1,$2::timestamptz,90)`, [beforePrepare, start])).rows;
  await db.query(`update public.vehicle_dispatch_drivers set active=false where user_id=$1`, [user1]);
  const prepared = (await db.query(`select * from public.prepare_vehicle_line_notification_test($1,$2,$3::timestamptz)`, [beforePrepare, lease.lease_token, start])).rows[0];
  assert.equal(prepared.outcome, 'suppressed');
  assert.equal(prepared.line_user_id, null);
  assert.equal((await db.query(`select state from public.vehicle_line_notification_test_runs where test_run_id=$1`, [beforePrepare])).rows[0].state, 'suppressed');
  await db.close();
});

test('personal preference and synthetic test RPCs are not executable by authenticated clients', async () => {
  const db = await database(false);
  const result = await db.query(`
    select has_function_privilege('authenticated','public.save_vehicle_line_notification_settings(boolean,boolean,boolean,boolean,uuid,uuid)','execute') as save,
      has_function_privilege('authenticated','public.create_vehicle_line_notification_test(uuid,timestamptz)','execute') as create_test,
      has_function_privilege('authenticated','public.claim_vehicle_line_notification_test(uuid,timestamptz,integer)','execute') as claim_test,
      has_function_privilege('service_role','public.create_vehicle_line_notification_test(uuid,timestamptz)','execute') as server_create
  `);
  assert.deepEqual(result.rows[0], { save: false, create_test: false, claim_test: false, server_create: true });
  await db.close();
});

test('prepare rechecks live binding and assignment, then freezes the generic HTTPS payload for retries', async () => {
  const db = await database();
  await assign(db);
  const [job] = await claim(db);
  const ready = await prepare(db, job);
  assert.equal(ready.outcome, 'ready');
  assert.equal(ready.line_user_id, 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.match(ready.retry_key, /^[0-9a-f-]{36}$/);
  assert.equal(ready.attempts, 1);
  assert.match(ready.message_text, /^公務車派車資訊已更新，請登入系統查看：https:\/\/jnfakimo\.github\.io\/Inspection\/v2\/systems\/vehicle\/requests\/$/);
  assert.doesNotMatch(ready.message_text, /localhost|127\.0\.0\.1/);
  assert.equal((await db.query(`select state,attempts from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0].state, 'sending');
  await db.close();
});

test('expired leased rows are reclaimed and stale lease results cannot overwrite the new owner', async () => {
  const db = await database();
  await assign(db);
  const [first] = await claim(db);
  const [reclaimed] = await claim(db, afterLease);
  assert.equal(reclaimed.outbox_id, first.outbox_id);
  assert.notEqual(reclaimed.lease_token, first.lease_token);
  assert.equal(await finish(db, first, { resolution: 'accepted', status: 200 }), 'lease_lost');
  assert.equal((await prepare(db, reclaimed, afterLease)).outcome, 'ready');
  await db.close();
});

test('expired sending retries the identical recipient, body, and retry key', async () => {
  const db = await database();
  await assign(db);
  const [first] = await claim(db);
  const firstAttempt = await prepare(db, first);
  const [reclaimed] = await claim(db, afterLease);
  const secondAttempt = await prepare(db, reclaimed, afterLease);
  assert.equal(secondAttempt.outcome, 'ready');
  assert.equal(secondAttempt.line_user_id, firstAttempt.line_user_id);
  assert.equal(secondAttempt.message_text, firstAttempt.message_text);
  assert.equal(secondAttempt.retry_key, firstAttempt.retry_key);
  assert.equal(secondAttempt.attempts, 2);
  assert.equal(await finish(db, first, { resolution: 'accepted', status: 200 }), 'lease_lost');
  assert.equal(await finish(db, reclaimed, { resolution: 'accepted', status: 409, acceptedRequestId: 'accepted-id-001', now: afterLease }), 'accepted');
  const saved = (await db.query(`select state,provider_http_status,provider_accepted_request_id from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0];
  assert.deepEqual(saved, { state: 'accepted', provider_http_status: 409, provider_accepted_request_id: 'accepted-id-001' });
  await db.close();
});

test('assignment change or unlink cancels leased work before it can be prepared', async () => {
  const db = await database();
  await assign(db);
  const [job] = await claim(db);
  await db.query(`update public.vehicle_dispatch_requests set driver_id=$1,vehicle_id=$2 where request_id=$3`, [user2, '30000000-0000-0000-0000-000000000002', request1]);
  await db.query(`update public.vehicle_dispatch_notification_outbox set next_attempt_at=$1::timestamptz where request_id=$2 and state='pending'`, [start, request1]);
  assert.equal((await prepare(db, job)).outcome, 'lease_lost');
  let states = (await db.query(`select state from public.vehicle_dispatch_notification_outbox where request_id=$1 order by dispatch_revision`, [request1])).rows;
  assert.equal(states[0].state, 'cancelled');

  const [newJob] = await claim(db);
  await db.query(`select public.unlink_vehicle_line_account($1,$2::timestamptz)`, [user2, start]);
  assert.equal((await prepare(db, newJob)).outcome, 'lease_lost');
  states = (await db.query(`select state from public.vehicle_dispatch_notification_outbox where request_id=$1 order by dispatch_revision`, [request1])).rows;
  assert.equal(states[1].state, 'cancelled');
  await db.close();
});

test('finish accepts only provider acceptance, bounded retry, uncertain, and dead-letter outcomes', async () => {
  const db = await database();
  await assign(db);
  let [job] = await claim(db);
  await prepare(db, job);
  assert.equal(await finish(db, job, { resolution: 'accepted', status: 409 }), 'invalid_resolution');
  assert.equal(await finish(db, job, { resolution: 'retry_wait', status: 429, error: 'line_rate_limited', next: '2026-10-08T08:01:00.000Z' }), 'invalid_resolution');
  assert.equal(await finish(db, job, { resolution: 'dead_letter', status: 400, error: 'line_client_error' }), 'dead_letter');
  const saved = (await db.query(`select state,accepted_at from public.vehicle_dispatch_notification_outbox where request_id=$1`, [request1])).rows[0];
  assert.deepEqual(saved, { state: 'dead_letter', accepted_at: null });
  await db.close();
});
