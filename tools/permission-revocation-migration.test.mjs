import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL(
  '../supabase/migrations/20261005030003_revoke_inspection_sensitive_access.sql',
  import.meta.url,
);
const sql = await readFile(migrationPath, 'utf8');

const functions = [
  'public.admin_reset_user_password(text,text)',
  'public.get_auth_user_id_by_email(text)',
];
const views = [
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
const retainedRoles = ['authenticated', 'postgres', 'service_role', 'office_manager', 'custom_role'];

async function makeDatabaseWithTargets() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE office_manager;
    CREATE ROLE custom_role;
    CREATE TABLE public.synthetic_source(id integer, payload text);
    INSERT INTO public.synthetic_source VALUES (1, 'synthetic');
    CREATE FUNCTION public.admin_reset_user_password(text, text)
      RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic'::text $$;
    CREATE FUNCTION public.get_auth_user_id_by_email(text)
      RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(text, text)
      TO anon, authenticated, postgres, service_role, office_manager, custom_role;
    GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text)
      TO anon, authenticated, postgres, service_role, office_manager, custom_role;
    GRANT EXECUTE ON FUNCTION public.admin_reset_user_password(text, text) TO PUBLIC;
    GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO PUBLIC;
  `);

  for (const view of views) {
    await db.exec(`
      CREATE VIEW public.${view} AS SELECT id, payload FROM public.synthetic_source;
      GRANT ALL PRIVILEGES ON TABLE public.${view}
        TO anon, authenticated, postgres, service_role, office_manager, custom_role;
      GRANT ALL PRIVILEGES ON TABLE public.${view} TO PUBLIC;
      GRANT SELECT (id) ON TABLE public.${view} TO anon;
      GRANT UPDATE (payload) ON TABLE public.${view} TO PUBLIC;
      GRANT SELECT (id), UPDATE (payload) ON TABLE public.${view} TO service_role;
    `);
  }
  return db;
}

const aclSnapshotSql = `
  SELECT object_name, scope, grantee, privilege_type, is_grantable
    FROM (
      SELECT p.proname AS object_name,
             'function' AS scope,
             COALESCE(r.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type,
             acl.is_grantable
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, '{}'::aclitem[])) AS acl
        LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = acl.grantee
       WHERE n.nspname = 'public'
         AND p.proname IN ('admin_reset_user_password', 'get_auth_user_id_by_email')
      UNION ALL
      SELECT c.relname AS object_name,
             'table' AS scope,
             COALESCE(r.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type,
             acl.is_grantable
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
        LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = acl.grantee
       WHERE n.nspname = 'public' AND c.relkind = 'v'
      UNION ALL
      SELECT c.relname AS object_name,
             'column:' || a.attname AS scope,
             COALESCE(r.rolname, 'PUBLIC') AS grantee,
             acl.privilege_type,
             acl.is_grantable
        FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(a.attacl, '{}'::aclitem[])) AS acl
        LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = acl.grantee
       WHERE n.nspname = 'public' AND c.relkind = 'v'
         AND a.attnum > 0 AND NOT a.attisdropped
    ) AS grants
   WHERE grantee = ANY($1::text[])
   ORDER BY object_name, scope, grantee, privilege_type, is_grantable
`;

async function retainedAclSnapshot(db) {
  return (await db.query(aclSnapshotSql, [retainedRoles])).rows;
}

async function objectDefinitionSnapshot(db) {
  const viewRows = (await db.query(`
    SELECT c.relname, c.relkind, c.relowner, c.reloptions, pg_catalog.pg_get_viewdef(c.oid, true) AS definition
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
     ORDER BY c.relname
  `)).rows;
  const functionRows = (await db.query(`
    SELECT p.proname, p.proowner, p.prosrc, p.prosecdef, p.proconfig,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('admin_reset_user_password', 'get_auth_user_id_by_email')
     ORDER BY p.proname, identity_arguments
  `)).rows;
  return { viewRows, functionRows };
}

async function targetAclRows(db) {
  return (await db.query(`
    SELECT scope, object_name, grantee
      FROM (
        SELECT 'function' AS scope, p.proname AS object_name,
               COALESCE(r.rolname, 'PUBLIC') AS grantee
          FROM pg_catalog.pg_proc AS p
          JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, '{}'::aclitem[])) AS acl
          LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = acl.grantee
         WHERE n.nspname = 'public'
           AND p.proname IN ('admin_reset_user_password', 'get_auth_user_id_by_email')
        UNION ALL
        SELECT 'table', c.relname, COALESCE(r.rolname, 'PUBLIC')
          FROM pg_catalog.pg_class AS c
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, '{}'::aclitem[])) AS acl
          LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = acl.grantee
         WHERE n.nspname = 'public' AND c.relkind = 'v'
        UNION ALL
        SELECT 'column:' || a.attname, c.relname, COALESCE(r.rolname, 'PUBLIC')
          FROM pg_catalog.pg_attribute AS a
          JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(a.attacl, '{}'::aclitem[])) AS acl
          LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = acl.grantee
         WHERE n.nspname = 'public' AND c.relkind = 'v'
           AND a.attnum > 0 AND NOT a.attisdropped
      ) AS grants
     WHERE (scope = 'function' AND grantee IN ('anon', 'PUBLIC', 'authenticated'))
        OR (scope <> 'function' AND grantee IN ('anon', 'PUBLIC'))
     ORDER BY scope, object_name, grantee
  `)).rows;
}

test('migration names only approved targets and visibly skips absent objects', () => {
  for (const signature of functions) assert.ok(sql.includes(`'${signature}'`));
  for (const view of views) assert.ok(sql.includes(`'${view}'`));
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE %I\.%I FROM anon, PUBLIC/i);
  assert.match(sql, /Skipping missing function %/);
  assert.match(sql, /Skipping missing view public\.%/);
  assert.match(sql, /Expected public\.% to be a view, found relkind %/);
  assert.match(sql, /^BEGIN;\s/i);
  assert.match(sql, /COMMIT;\s*$/i);
  assert.doesNotMatch(sql, /^\s*(?:GRANT|CREATE|ALTER|DROP)\b/im);
});

test('real isolated PostgreSQL run revokes target ACLs, preserves other ACLs/definitions, and is repeatable', async () => {
  const db = await makeDatabaseWithTargets();
  try {
    const beforeAcl = await retainedAclSnapshot(db);
    const beforeDefinitions = await objectDefinitionSnapshot(db);
    assert.equal(beforeDefinitions.viewRows.length, views.length);
    assert.equal(beforeDefinitions.functionRows.length, functions.length);

    await db.exec(sql);

    const afterFirstAcl = await retainedAclSnapshot(db);
    const afterFirstDefinitions = await objectDefinitionSnapshot(db);
    assert.deepEqual(afterFirstAcl, beforeAcl);
    assert.deepEqual(afterFirstDefinitions, beforeDefinitions);
    assert.deepEqual(await targetAclRows(db), []);

    await db.exec(sql);

    assert.deepEqual(await retainedAclSnapshot(db), beforeAcl);
    assert.deepEqual(await objectDefinitionSnapshot(db), beforeDefinitions);
    assert.deepEqual(await targetAclRows(db), []);
  } finally {
    await db.close();
  }
});

test('real isolated PostgreSQL run succeeds and creates nothing when target objects are absent', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    await db.exec(sql);
    const objectCount = await db.query(`
      SELECT count(*)::integer AS count
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = ANY($1::text[])
    `, [views]);
    const functionCount = await db.query(`
      SELECT count(*)::integer AS count
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])
    `, [functions.map((signature) => signature.split('.')[1].split('(')[0])]);
    assert.equal(objectCount.rows[0].count, 0);
    assert.equal(functionCount.rows[0].count, 0);
  } finally {
    await db.close();
  }
});
