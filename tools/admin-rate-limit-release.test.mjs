import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20260912090000_admin_account_application_rate_limit_release.sql', import.meta.url),
  'utf8',
);
const adminApi = readFileSync(new URL('../supabase/functions/admin-api/index.ts', import.meta.url), 'utf8');
const alertsUi = readFileSync(new URL('../web/components/admin/AlertsAdminV2.tsx', import.meta.url), 'utf8');
const auditUi = readFileSync(new URL('../web/components/admin/AuditAdminV2.tsx', import.meta.url), 'utf8');

assert.doesNotMatch(migration.replace(/--[^\r\n]*/g, ''), /\bdelete\s+from\b|\btruncate\b/i);
assert.match(adminApi, /admin_release_account_application_rate_limit/);
assert.match(adminApi, /p_alert_id:\s*alertId/);
assert.match(adminApi, /p_operator_id:\s*profile\.user_id/);
assert.match(alertsUi, /解除此 IP 帳號申請限制/);
assert.match(alertsUi, /profile\.rbac_role === 'sysadmin' \|\| profile\.role === 'admin'/);
assert.match(alertsUi, /原告警、阻擋事件與操作者時間均已保留/);
assert.match(alertsUi, /manual_unblock/);
assert.match(auditUi, /account_application_rate_limit_released:\s*'解除帳號申請限制'/);

const db = new PGlite();
const adminId = '10000000-0000-0000-0000-000000000001';
const userId = '10000000-0000-0000-0000-000000000002';
const alertId = '20000000-0000-0000-0000-000000000001';
const otherAlertId = '20000000-0000-0000-0000-000000000002';
const ip = '203.0.113.18';
const scope = 'username-login:account_application';

const call = async (targetAlertId, operatorId) => (
  await db.query(
    'select public.admin_release_account_application_rate_limit($1::uuid,$2::uuid) as result',
    [targetAlertId, operatorId],
  )
).rows[0].result;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable
      as $$ select nullif(current_setting('test.auth_role', true), '') $$;
    create table public.users(
      user_id uuid primary key,
      rbac_role text,
      role text,
      status text not null
    );
    create table public.security_alerts(
      alert_id uuid primary key,
      alert_type text,
      resource text,
      ip_address text,
      status text not null default 'open',
      details jsonb not null default '{}'::jsonb,
      acknowledged_at timestamptz,
      acknowledged_by uuid
    );
    create table public.request_rate_limits(
      subject text not null,
      scope text not null,
      window_started timestamptz not null,
      request_count integer not null,
      updated_at timestamptz not null,
      primary key(subject, scope)
    );
    create table public.request_rate_limit_events(
      event_id uuid primary key,
      subject text not null,
      scope text not null,
      request_count integer not null
    );
    create table public.audit_logs(
      audit_id uuid primary key default gen_random_uuid(),
      table_name text not null,
      record_id text not null,
      action text not null,
      changes jsonb,
      operator_id uuid,
      operated_at timestamptz default now(),
      source text,
      ip_address text
    );
    insert into public.users values
      ('${adminId}', 'sysadmin', 'admin', 'active'),
      ('${userId}', 'reporter', 'reporter', 'active');
    insert into public.security_alerts(alert_id,alert_type,resource,ip_address,status,details) values
      ('${alertId}', 'rate_limit', '${scope}', '${ip}', 'open', '{"request_count":6}'),
      ('${otherAlertId}', 'rate_limit', 'admin-api', '${ip}', 'open', '{}');
    insert into public.request_rate_limits values
      ('${ip}', '${scope}', now() - interval '1 hour', 6, now());
    insert into public.request_rate_limit_events values
      ('30000000-0000-0000-0000-000000000001', '${ip}', '${scope}', 6);
  `);
  await db.exec(migration);
  await db.exec(migration);

  await db.exec("select set_config('test.auth_role','anon',false)");
  await assert.rejects(call(alertId, adminId), /受信任的後端服務/);

  await db.exec("select set_config('test.auth_role','service_role',false)");
  await assert.rejects(call(alertId, userId), /僅限系統管理員/);
  await assert.rejects(call(otherAlertId, adminId), /不是帳號申請限流事件/);

  const result = await call(alertId, adminId);
  assert.equal(result.released, true);
  assert.equal(result.ip_address, ip);
  assert.equal(result.previous_request_count, 6);

  const rate = (await db.query(
    'select request_count,window_started,updated_at from public.request_rate_limits where subject=$1 and scope=$2',
    [ip, scope],
  )).rows[0];
  assert.equal(rate.request_count, 0);
  assert.equal(new Date(rate.window_started).getTime(), new Date(rate.updated_at).getTime());

  const alert = (await db.query(
    'select status,acknowledged_by,details from public.security_alerts where alert_id=$1',
    [alertId],
  )).rows[0];
  assert.equal(alert.status, 'acknowledged');
  assert.equal(alert.acknowledged_by, adminId);
  assert.equal(alert.details.manual_unblock.released_by, adminId);
  assert.equal(alert.details.manual_unblock.previous_request_count, 6);

  assert.equal((await db.query('select count(*)::int as n from public.request_rate_limit_events')).rows[0].n, 1);
  const audit = (await db.query('select * from public.audit_logs')).rows[0];
  assert.equal(audit.table_name, 'request_rate_limits');
  assert.equal(audit.record_id, alertId);
  assert.equal(audit.action, 'status_change');
  assert.equal(audit.operator_id, adminId);
  assert.equal(audit.ip_address, ip);
  assert.equal(audit.changes.event_type, 'account_application_rate_limit_released');
  assert.equal(audit.changes.previous_request_count, 6);

  await assert.rejects(call(alertId, adminId), /已由系統管理員解除/);
  assert.equal((await db.query('select count(*)::int as n from public.audit_logs')).rows[0].n, 1);
  console.log('帳號申請限流解除檢查通過：僅系統管理員、限定告警 IP、計數歸零、原告警與阻擋事件保留、解除稽核完整且不可重複。');
} finally {
  await db.close();
}
