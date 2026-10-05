-- Record the targeted ACL revocations already applied and independently verified
-- on 2026-10-05. This migration changes grants only; it does not redefine objects.
DO $migration$
DECLARE
  function_signature text;
  view_name text;
  view_relkind "char";
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.admin_reset_user_password(text,text)',
    'public.get_auth_user_id_by_email(text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL THEN
      RAISE NOTICE 'Skipping missing function %', function_signature;
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        pg_catalog.to_regprocedure(function_signature)
      );
    END IF;
  END LOOP;

  FOREACH view_name IN ARRAY ARRAY[
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
    'vw_manager_today_inspections'
  ] LOOP
    SELECT c.relkind
      INTO view_relkind
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = view_name;

    IF NOT FOUND THEN
      RAISE NOTICE 'Skipping missing view public.%', view_name;
    ELSIF view_relkind <> 'v' THEN
      RAISE EXCEPTION 'Expected public.% to be a view, found relkind %',
        view_name, view_relkind;
    ELSE
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM anon, PUBLIC',
        'public', view_name
      );
    END IF;
  END LOOP;
END
$migration$;
