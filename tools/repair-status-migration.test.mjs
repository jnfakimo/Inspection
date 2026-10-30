import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261028160000_restore_repair_workflow_statuses.sql', import.meta.url), 'utf8');
const db = new PGlite();
try {
  await db.exec(`
    create table repair_requests (request_id int primary key, status text,
      constraint repair_requests_status_check check (status in ('pending','transferred','closed','cancelled')));
    alter table repair_requests enable row level security;
    create policy own_request on repair_requests using (false);
    insert into repair_requests values (1, 'pending');
  `);
  await assert.rejects(db.exec("update repair_requests set status='assigned' where request_id=1"), /repair_requests_status_check/);
  const securityState = async () => ({
    rls: (await db.query("select relrowsecurity from pg_class where oid='repair_requests'::regclass")).rows,
    policies: (await db.query("select policyname,qual,with_check from pg_policies where tablename='repair_requests'")).rows,
  });
  const before = await securityState();
  await db.exec(migration);
  for (const state of ['assigned','accepted','in_progress','waiting_parts','waiting_vendor','pending_review','completed','closed','returned','rejected','overdue','cancelled','transferred','pending']) {
    await db.query('update repair_requests set status=$1 where request_id=1',[state]);
    assert.equal((await db.query('select status from repair_requests where request_id=1')).rows[0].status,state);
  }
  await assert.rejects(db.exec("update repair_requests set status='invalid' where request_id=1"),/repair_requests_status_check/);
  await db.exec(migration);
  assert.deepEqual(await securityState(),before,'不得放寬 RLS 或 policy');
  assert.deepEqual((await db.query('select * from repair_requests')).rows,[{request_id:1,status:'pending'}]);
  console.log('PASS：重現舊約束故障、14 種有效狀態、拒絕無效狀態、RLS 不變、重跑安全。');
} finally { await db.close(); }
