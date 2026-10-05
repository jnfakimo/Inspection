import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20261005023527_revoke_inspection_sensitive_access.sql',
  import.meta.url,
);
const sql = await readFile(migrationPath, 'utf8');

function readArrayAfter(label, source) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escaped}\\s+IN\\s+ARRAY\\s+ARRAY\\[([\\s\\S]*?)\\]\\s+LOOP`, 'i'));
  assert.ok(match, `could not find ${label} target list`);
  return [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((item) => item[1].replaceAll("''", "'"));
}

const functions = readArrayAfter('function_signature', sql);
const views = readArrayAfter('view_name', sql);
const expectedFunctions = [
  'public.admin_reset_user_password(text,text)',
  'public.get_auth_user_id_by_email(text)',
];
const expectedViews = [
  'equipment_annual_cost_summary',
  'equipment_central_monitoring_registry',
  'equipment_lifecycle_overview',
  'vw_manager_abnormal_inspections',
  'vw_manager_equipment',
  'vw_manager_inspections',
  'vw_manager_maintenance_orders',
  'vw_manager_monthly_kpi',
  'vw_manager_open_repairs',
  'vw_manager_repairs',
  'vw_manager_today_inspections',
];

test('migration names only the approved functions and views', () => {
  assert.deepEqual(functions, expectedFunctions);
  assert.deepEqual(views, expectedViews);
});

test('migration only revokes the requested ACLs and visibly handles missing objects', () => {
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE %I\.%I FROM anon, PUBLIC/i);
  assert.match(sql, /Skipping missing function %/);
  assert.match(sql, /Skipping missing view public\.%/);
  assert.match(sql, /Expected public\.% to be a view, found relkind %/);
  assert.doesNotMatch(sql, /^\s*(?:GRANT|CREATE|ALTER|DROP)\b/im);
});

test('isolated ACL model is idempotent and retains every non-target grant', () => {
  const initial = new Map([
    ['function', new Set(['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role', 'office_manager', 'custom_role'])],
    ['view', new Set(['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role', 'office_manager', 'custom_role'])],
  ]);
  const runModel = (acl) => new Map([
    ['function', new Set([...acl.get('function')].filter((role) => !['PUBLIC', 'anon', 'authenticated'].includes(role)))],
    ['view', new Set([...acl.get('view')].filter((role) => !['PUBLIC', 'anon'].includes(role)))],
  ]);

  const firstRun = runModel(initial);
  const secondRun = runModel(firstRun);
  assert.deepEqual(secondRun, firstRun);
  assert.deepEqual([...firstRun.get('function')].sort(), ['custom_role', 'office_manager', 'postgres', 'service_role']);
  assert.deepEqual([...firstRun.get('view')].sort(), ['authenticated', 'custom_role', 'office_manager', 'postgres', 'service_role']);
});
