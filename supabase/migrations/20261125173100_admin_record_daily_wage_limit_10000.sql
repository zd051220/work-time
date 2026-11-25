-- Enforce the same 10,000 CNY daily-wage ceiling at the database boundary.
-- Preserve the existing SECURITY DEFINER function body and all grant checks.
DO $$DECLARE v_definition text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'admin_create_record_for_user'
    AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_code text, p_record jsonb';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Target admin record function was not found';
  END IF;
  IF pg_catalog.strpos(v_definition, 'v_wage > 1000000') = 0 THEN
    RAISE EXCEPTION 'Expected previous wage limit was not found; refusing to alter function';
  END IF;

  v_definition := pg_catalog.replace(v_definition, 'v_wage > 1000000', 'v_wage > 10000');
  EXECUTE v_definition;
END$$;
