-- ════════════════════════════════════════════════════════════════════════════
-- La matriz de ACL de los helpers de RLS, declarada y verificada — forward-only
-- ════════════════════════════════════════════════════════════════════════════
-- COMPAÑERA OBLIGATORIA de la reparación de replay hecha en
-- `20260909000000_revoke_execute_helpers_rls_y_reset.sql`. Las dos hacen falta y
-- ninguna sustituye a la otra:
--
--   · Aquella repara la RECONSTRUCCIÓN DESDE CERO. Su verificación abortaba en
--     una Supabase Branch nueva, así que sin arreglarla ahí no se llega nunca a
--     esta migración: el replay muere antes.
--   · Ésta repara los ENTORNOS QUE YA EXISTEN. Producción, el sandbox de E2E y
--     cualquier base provisionada antes de hoy no van a volver a ejecutar una
--     migración histórica, así que la corrección de allá no les llega. Llega
--     ésta.
--
-- La matriz es la MISMA en los dos sitios, a propósito — si divergieran, la
-- verificación de abajo lo diría:
--
--   ┌──────────────────────────┬────────┬──────┬───────────────┬──────────────┐
--   │                          │ PUBLIC │ anon │ authenticated │ service_role │
--   ├──────────────────────────┼────────┼──────┼───────────────┼──────────────┤
--   │ 15 helpers de policies   │   NO   │  NO  │      SÍ       │      SÍ      │
--   │  5 de reseteo (legacy)   │   NO   │  NO  │      NO       │      SÍ      │
--   └──────────────────────────┴────────┴──────┴───────────────┴──────────────┘
--
-- POR QUÉ `authenticated` EN LOS HELPERS. Una policy se evalúa con el rol que
-- consulta, no con el dueño de la función: sin EXECUTE, `authenticated` deja de
-- poder leer sus propias filas y la RLS se queda a oscuras. Y `service_role`
-- porque las edge functions y el cron los llaman con esa clave.
--
-- POR QUÉ LOS DE RESETEO NO. Son herencia del auth propio anterior a Supabase
-- Auth; ni `src/` ni `supabase/functions/` las llaman. Dejarlas abiertas a
-- `anon` es el flujo de reseteo entero como oráculo, que es lo que
-- `20260909000000` cerró.
--
-- IDEMPOTENTE Y NO-OP EN PRODUCCIÓN. Sólo GRANT/REVOKE sobre funciones que ya
-- existen; no toca datos ni definiciones. En producción las ACL ya son éstas.
-- Si alguna función no existiera (base parcial), se salta con aviso en vez de
-- abortar: `to_regprocedure` devuelve NULL y no hay nada que ajustar.
--
-- REVERSIÓN
--   No la tiene, y es deliberado: revertir sería reabrir a `anon` los
--   predicados SECURITY DEFINER sobre los que se apoya toda la RLS. Si hiciera
--   falta soltar una función concreta, es un GRANT puntual y revisado.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fn         text;
  v_oid      oid;
  v_roles    text;
  v_ausentes text[] := ARRAY[]::text[];
  v_helpers  text[] := ARRAY[
    'current_user_role()',
    'get_my_cliente_id()',
    'get_my_company_id()',
    'get_my_user_id()',
    'has_admin_company_access(uuid)',
    'has_admin_or_owner_access_in_company(uuid)',
    'has_admin_project_access(uuid)',
    'has_company_owner_company_access(uuid)',
    'has_operator_project_access(uuid)',
    'has_super_admin_access()',
    'has_viewer_project_access(uuid)',
    'is_company_owner()',
    'is_super_admin()',
    'is_user_cliente_with_id(uuid)',
    'user_has_project_access(uuid)'
  ];
  v_reset    text[] := ARRAY[
    'request_password_reset(character varying, character varying, text)',
    'request_password_reset(text, text, text)',
    'update_user_password(character varying, character varying)',
    'validate_reset_token(character varying)',
    'validate_reset_token(text)'
  ];
  v_hay_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  v_hay_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  v_hay_srv  boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  -- ── Helpers de policies: conceder a authenticated + service_role ─────────
  v_roles := concat_ws(', ',
    CASE WHEN v_hay_auth THEN 'authenticated' END,
    CASE WHEN v_hay_srv  THEN 'service_role'  END);

  FOREACH fn IN ARRAY v_helpers LOOP
    v_oid := to_regprocedure('public.' || fn);
    IF v_oid IS NULL THEN
      v_ausentes := v_ausentes || fn;
      CONTINUE;
    END IF;
    IF v_roles <> '' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO %s', fn, v_roles);
    END IF;
    -- El orden importa: primero conceder, después cerrar. Al revés, un
    -- `REVOKE FROM PUBLIC` sin GRANT previo deja a authenticated sin nada
    -- durante el hueco — que es exactamente el defecto que esto repara.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    IF v_hay_anon THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', fn);
    END IF;
  END LOOP;

  -- ── Reseteo de contraseña: sólo service_role ────────────────────────────
  FOREACH fn IN ARRAY v_reset LOOP
    v_oid := to_regprocedure('public.' || fn);
    IF v_oid IS NULL THEN
      v_ausentes := v_ausentes || fn;
      CONTINUE;
    END IF;
    IF v_hay_srv THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    IF v_hay_anon THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', fn);
    END IF;
    IF v_hay_auth THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM authenticated', fn);
    END IF;
  END LOOP;

  IF array_length(v_ausentes, 1) IS NOT NULL THEN
    RAISE NOTICE 'ACL no ajustada (función ausente en esta base): %',
      array_to_string(v_ausentes, ', ');
  END IF;
END $$;

-- ── Verificación con has_function_privilege, celda por celda ────────────────
-- Lo que se declara arriba se COMPRUEBA aquí, contra el catálogo. Si el ajuste
-- no surtió efecto, falla en el apply o en la preview branch — no semanas
-- después en un guard nocturno.
DO $$
DECLARE
  fn         text;
  v_oid      oid;
  v_helpers  text[] := ARRAY[
    'current_user_role()',
    'get_my_cliente_id()',
    'get_my_company_id()',
    'get_my_user_id()',
    'has_admin_company_access(uuid)',
    'has_admin_or_owner_access_in_company(uuid)',
    'has_admin_project_access(uuid)',
    'has_company_owner_company_access(uuid)',
    'has_operator_project_access(uuid)',
    'has_super_admin_access()',
    'has_viewer_project_access(uuid)',
    'is_company_owner()',
    'is_super_admin()',
    'is_user_cliente_with_id(uuid)',
    'user_has_project_access(uuid)'
  ];
  v_reset    text[] := ARRAY[
    'request_password_reset(character varying, character varying, text)',
    'request_password_reset(text, text, text)',
    'update_user_password(character varying, character varying)',
    'validate_reset_token(character varying)',
    'validate_reset_token(text)'
  ];
  v_hay_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  v_hay_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
  v_hay_srv  boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role');
BEGIN
  FOREACH fn IN ARRAY v_helpers LOOP
    v_oid := to_regprocedure('public.' || fn);
    CONTINUE WHEN v_oid IS NULL;
    IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC conserva EXECUTE sobre public.%', fn; END IF;
    IF v_hay_anon AND has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon conserva EXECUTE sobre public.%', fn; END IF;
    IF v_hay_auth AND NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated NO puede ejecutar public.% — las policies que lo evalúan dejarían de leer', fn; END IF;
    IF v_hay_srv AND NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role NO puede ejecutar public.% — el cron y las edge functions dejarían de funcionar', fn; END IF;
  END LOOP;

  FOREACH fn IN ARRAY v_reset LOOP
    v_oid := to_regprocedure('public.' || fn);
    CONTINUE WHEN v_oid IS NULL;
    IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC conserva EXECUTE sobre public.% (reseteo)', fn; END IF;
    IF v_hay_anon AND has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon conserva EXECUTE sobre public.% (reseteo)', fn; END IF;
    IF v_hay_auth AND has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated conserva EXECUTE sobre public.% (reseteo)', fn; END IF;
    IF v_hay_srv AND NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role NO puede ejecutar public.% (reseteo)', fn; END IF;
  END LOOP;
END $$;
