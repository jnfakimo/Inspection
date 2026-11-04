import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';

const sql = await readFile(new URL('../../migrations/20261104160000_inspection_line_equipment_bot.sql', import.meta.url), 'utf8');
const active = '50000000-0000-0000-0000-000000000001';
const other = '50000000-0000-0000-0000-000000000002';
const inactive = '50000000-0000-0000-0000-000000000003';
const lineId = `U${'a'.repeat(32)}`;
const otherLineId = `U${'b'.repeat(32)}`;
const lineHash = createHash('sha256').update(lineId).digest('hex');
const otherLineHash = createHash('sha256').update(otherLineId).digest('hex');
const now = '2026-11-04T08:00:00Z';
const equipmentId = '60000000-0000-0000-0000-000000000001';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.users (user_id uuid primary key, status text not null);
    create table public.equipment (equipment_id uuid primary key, asset_code text, qr_code text, name text);
    create table public.equipment_monitor_events (
      event_id uuid primary key, equipment_id uuid not null references public.equipment(equipment_id),
      severity text not null, event_state text not null, title text, occurred_at timestamptz
    );
    insert into public.users values
      ('${active}', 'active'), ('${other}', 'active'), ('${inactive}', 'inactive');
    insert into public.equipment values
      ('60000000-0000-0000-0000-000000000001', 'EQ-001', 'QR-001', '測試設備');
  `);
  await db.exec(sql);
  return db;
}

const call = (db, name, args) => db.query(
  `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as outcome`, args,
).then(result => result.rows[0].outcome);
const start = (db, user, hash, at = now) => db.query(
  'select * from public.create_inspection_line_link($1::uuid,$2,$3::timestamptz,$4::timestamptz)',
  [user, hash, at, at],
).then(result => result.rows[0]);
const consume = (db, code, hash, nonce, at = now) => call(db, 'consume_inspection_line_link',
  [code, hash, nonce, at]);
const complete = (db, nonce, hash, id, result = 'ok', at = now) => call(db, 'complete_inspection_line_link',
  [nonce, hash, id, result, at]);

test('schema is private and RPCs are service-role only', async () => {
  const db = await database();
  const grant = await db.query(`
    select has_table_privilege('authenticated', 'public.inspection_line_bindings', 'select') as table_read,
      has_function_privilege('authenticated',
        'public.complete_inspection_line_link(text,text,text,text,timestamptz)', 'execute') as client_execute,
      has_function_privilege('service_role',
        'public.complete_inspection_line_link(text,text,text,text,timestamptz)', 'execute') as service_execute
  `);
  assert.deepEqual(grant.rows[0], { table_read: false, client_execute: false, service_execute: true });
  const rls = await db.query(`select relrowsecurity from pg_class where oid = 'public.inspection_line_bindings'::regclass`);
  assert.equal(rls.rows[0].relrowsecurity, true);
  const alertPrivileges = await db.query(`
    select has_table_privilege('authenticated', 'public.inspection_line_equipment_subscriptions', 'select') as subscriptions_read,
      has_table_privilege('authenticated', 'public.inspection_line_alert_outbox', 'select') as outbox_read,
      has_function_privilege('authenticated',
        'public.claim_inspection_line_alerts(integer,integer,timestamptz)', 'execute') as client_claim,
      has_function_privilege('service_role',
        'public.claim_inspection_line_alerts(integer,integer,timestamptz)', 'execute') as service_claim
  `);
  assert.deepEqual(alertPrivileges.rows[0], {
    subscriptions_read: false, outbox_read: false, client_claim: false, service_claim: true,
  });
  await db.close();
});

test('active consent creates one expiring request; inactive user is rejected', async () => {
  const db = await database();
  assert.equal((await start(db, active, 'a'.repeat(64))).outcome, 'created');
  assert.equal((await start(db, active, 'b'.repeat(64))).outcome, 'created');
  const rows = await db.query('select code_hash,state from public.inspection_line_link_requests order by code_hash');
  assert.deepEqual(rows.rows.map(row => row.state), ['cancelled', 'pending']);
  assert.equal((await start(db, inactive, 'c'.repeat(64))).outcome, 'user_inactive');
  await db.close();
});

test('code and LINE nonce are single-use; wrong identity and expiry cannot bind', async () => {
  const db = await database();
  const code = 'a'.repeat(64), hash = lineHash, nonce = 'c'.repeat(64);
  await start(db, active, code);
  assert.equal(await consume(db, code, hash, nonce), 'ready');
  assert.equal(await consume(db, code, hash, nonce), 'already_used');
  assert.equal(await complete(db, nonce, otherLineHash, otherLineId), 'identity_mismatch');
  assert.equal(await complete(db, nonce, hash, otherLineId), 'invalid_request');
  assert.equal(await complete(db, nonce, hash, lineId, 'ok', '2026-11-04T08:11:00Z'), 'expired');
  const rows = await db.query('select * from public.inspection_line_bindings');
  assert.equal(rows.rows.length, 0);
  await db.close();
});

test('verified link binds only once; unlink revokes; identity cannot move to another account', async () => {
  const db = await database();
  const code = 'a'.repeat(64), hash = lineHash, nonce = 'c'.repeat(64);
  await start(db, active, code);
  assert.equal(await consume(db, code, hash, nonce), 'ready');
  assert.equal(await complete(db, nonce, hash, lineId), 'linked');
  assert.equal(await complete(db, nonce, hash, lineId), 'already_used');
  assert.equal((await start(db, active, 'd'.repeat(64))).outcome, 'already_linked');
  await start(db, other, 'e'.repeat(64));
  assert.equal(await consume(db, 'e'.repeat(64), hash, '1'.repeat(64)), 'ready');
  assert.equal(await complete(db, '1'.repeat(64), hash, lineId), 'binding_conflict');
  assert.equal(await call(db, 'unlink_inspection_line', [active, now]), true);
  const rows = await db.query('select state,line_user_id from public.inspection_line_bindings where user_id = $1', [active]);
  assert.deepEqual(rows.rows[0], { state: 'unlinked', line_user_id: null });
  await db.close();
});

async function linkedDatabase() {
  const db = await database();
  const code = 'a'.repeat(64), nonce = 'c'.repeat(64);
  await start(db, active, code);
  assert.equal(await consume(db, code, lineHash, nonce), 'ready');
  assert.equal(await complete(db, nonce, lineHash, lineId), 'linked');
  return db;
}

test('only personally subscribed equipment warning/critical open events enter outbox', async () => {
  const db = await linkedDatabase();
  const subscribed = await db.query(
    'select public.subscribe_inspection_line_equipment($1::uuid,$2::uuid,$3::timestamptz) as outcome',
    [active, equipmentId, now],
  );
  assert.equal(subscribed.rows[0].outcome, 'subscribed');
  await db.exec("insert into public.equipment_monitor_events values " +
    "('70000000-0000-0000-0000-000000000001', '" + equipmentId + "', 'info', 'open', '普通事件', '" + now + "')," +
    "('70000000-0000-0000-0000-000000000002', '" + equipmentId + "', 'warning', 'open', '警示事件', '" + now + "')," +
    "('70000000-0000-0000-0000-000000000003', '" + equipmentId + "', 'critical', 'resolved', '已結案', '" + now + "')");
  let rows = await db.query('select event_id,state from public.inspection_line_alert_outbox');
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].state, 'pending');
  await db.exec("update public.equipment_monitor_events set severity = 'warning' " +
    "where event_id = '70000000-0000-0000-0000-000000000001'");
  rows = await db.query('select event_id from public.inspection_line_alert_outbox');
  assert.equal(rows.rows.length, 2);
  await db.close();
});

test('claim leases once; stale lease cannot finish; unsubscribe cancels queued work', async () => {
  const db = await linkedDatabase();
  const claimAt = '2026-11-04T10:00:00Z';
  await call(db, 'subscribe_inspection_line_equipment', [active, equipmentId, now]);
  await db.exec("insert into public.equipment_monitor_events values " +
    "('70000000-0000-0000-0000-000000000004', '" + equipmentId + "', 'warning', 'open', '警示', '" + now + "')");
  const first = await db.query(
    'select * from public.claim_inspection_line_alerts($1::integer,$2::integer,$3::timestamptz)',
    [20, 90, claimAt],
  );
  assert.equal(first.rows.length, 1);
  const duplicate = await db.query(
    'select * from public.claim_inspection_line_alerts($1::integer,$2::integer,$3::timestamptz)',
    [20, 90, claimAt],
  );
  assert.equal(duplicate.rows.length, 0);
  const id = first.rows[0].outbox_id;
  const lease = first.rows[0].lease_token;
  assert.equal(await call(db, 'finish_inspection_line_alert',
    [id, '80000000-0000-0000-0000-000000000001', 'sent', 200, null, now]), 'lease_lost');
  assert.equal(await call(db, 'unsubscribe_inspection_line_equipment', [active, equipmentId, now]), true);
  assert.equal(await call(db, 'finish_inspection_line_alert', [id, lease, 'sent', 200, null, now]), 'lease_lost');
  const row = await db.query('select state from public.inspection_line_alert_outbox where outbox_id = $1', [id]);
  assert.equal(row.rows[0].state, 'cancelled');
  await db.close();
});

test('unlink clears personal subscriptions and queued alerts', async () => {
  const db = await linkedDatabase();
  await call(db, 'subscribe_inspection_line_equipment', [active, equipmentId, now]);
  await db.exec("insert into public.equipment_monitor_events values " +
    "('70000000-0000-0000-0000-000000000005', '" + equipmentId + "', 'critical', 'open', '緊急', '" + now + "')");
  assert.equal(await call(db, 'unlink_inspection_line', [active, now]), true);
  const sub = await db.query('select active from public.inspection_line_equipment_subscriptions');
  const queue = await db.query('select state from public.inspection_line_alert_outbox');
  assert.equal(sub.rows[0].active, false);
  assert.equal(queue.rows[0].state, 'cancelled');
  await db.close();
});

test('retry returns pending and the next successful claim uses one outbox identity', async () => {
  const db = await linkedDatabase();
  await call(db, 'subscribe_inspection_line_equipment', [active, equipmentId, now]);
  await db.exec("insert into public.equipment_monitor_events values " +
    "('70000000-0000-0000-0000-000000000006', '" + equipmentId + "', 'warning', 'open', '警示', '" + now + "')");
  const first = await db.query(
    'select * from public.claim_inspection_line_alerts($1::integer,$2::integer,$3::timestamptz)',
    [20, 90, '2026-11-04T10:00:00Z'],
  );
  const id = first.rows[0].outbox_id;
  assert.equal(await call(db, 'finish_inspection_line_alert',
    [id, first.rows[0].lease_token, 'retry', 503, '2026-11-04T10:05:00Z', now]), 'pending');
  const tooEarly = await db.query(
    'select * from public.claim_inspection_line_alerts($1::integer,$2::integer,$3::timestamptz)',
    [20, 90, '2026-11-04T10:04:59Z'],
  );
  assert.equal(tooEarly.rows.length, 0);
  const second = await db.query(
    'select * from public.claim_inspection_line_alerts($1::integer,$2::integer,$3::timestamptz)',
    [20, 90, '2026-11-04T10:05:00Z'],
  );
  assert.equal(second.rows[0].outbox_id, id);
  assert.notEqual(second.rows[0].lease_token, first.rows[0].lease_token);
  assert.equal(await call(db, 'finish_inspection_line_alert',
    [id, second.rows[0].lease_token, 'sent', 200, null, now]), 'sent');
  const result = await db.query('select state,attempts from public.inspection_line_alert_outbox where outbox_id = $1', [id]);
  assert.deepEqual(result.rows[0], { state: 'sent', attempts: 2 });
  await db.close();
});
