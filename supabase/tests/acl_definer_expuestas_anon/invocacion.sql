-- ════════════════════════════════════════════════════════════════════════════
-- INVOCACIÓN EFECTIVA, no lectura de ACL.
--
-- `has_function_privilege` es lo que decide, pero leerlo y creerle es
-- exactamente el error que esta clase de prueba existe para no repetir. Aquí se
-- LLAMA a las funciones con `SET LOCAL ROLE` y se comprueba el SQLSTATE:
--
--   42501 insufficient_privilege  → la ACL rechazó la llamada (es lo buscado)
--   0A000 feature_not_supported   → «trigger functions can only be called as
--                                   triggers»: la ACL DEJÓ PASAR y lo que
--                                   rechaza es la forma de la llamada.
--
-- Esa diferencia es la prueba de que service_role conserva el acceso a las tres
-- funciones de trigger: si hubiera perdido EXECUTE, vería 42501 como anon.
--
-- Cada caso vive en su propio DO con su EXCEPTION: una excepción capturada
-- deshace su subtransacción, y con ella el SET LOCAL ROLE.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── anon NO puede llamar buscar_cliente_para_onboarding ─────────────────────
DO $$
BEGIN
  SET LOCAL ROLE anon;
  PERFORM public.buscar_cliente_para_onboarding('1234567890101', '1990-01-01', 'caso.seguro@ejemplo.test');
  RAISE EXCEPTION '❌ anon PUDO llamar buscar_cliente_para_onboarding';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'OK    anon NO puede llamar buscar_cliente_para_onboarding (42501)';
END $$;

-- ── authenticated SÍ puede, y obtiene el triple match del caso seguro ───────
DO $$
DECLARE v_res jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  v_res := public.buscar_cliente_para_onboarding('1234567890101', '1990-01-01', 'caso.seguro@ejemplo.test');
  RESET ROLE;
  IF (v_res->>'match_count')::int IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '❌ authenticated llamó pero el caso seguro no devolvió match_count=3: %', v_res;
  END IF;
  RAISE NOTICE 'OK    authenticated SÍ puede llamar buscar_cliente_para_onboarding (match_count=3)';
END $$;

-- ── anon SÍ puede llamar sso_lookup_domain, y sólo recibe sus tres campos ───
-- El dominio de la prueba tiene company_id (el fixture se lo pone a propósito);
-- si algún día la RPC lo devolviera, este bloque lo ve.
DO $$
DECLARE
  v_fila   record;
  v_campos text;
BEGIN
  SET LOCAL ROLE anon;
  SELECT * INTO v_fila FROM public.sso_lookup_domain('acme.test');
  RESET ROLE;
  IF v_fila IS NULL THEN
    RAISE EXCEPTION '❌ anon llamó sso_lookup_domain y no obtuvo fila para un dominio verified';
  END IF;
  IF v_fila.sso_available IS NOT TRUE OR v_fila.enforced IS NOT TRUE
     OR v_fila.provider_id IS DISTINCT FROM 'okta-acme' THEN
    RAISE EXCEPTION '❌ sso_lookup_domain devolvió algo distinto de lo esperado: %', v_fila;
  END IF;

  -- La forma del resultado, leída del catálogo: exactamente esos tres campos.
  SELECT string_agg(a.argname, ',' ORDER BY a.orden) INTO v_campos
    FROM pg_proc p,
         LATERAL unnest(p.proargnames, p.proargmodes) WITH ORDINALITY AS a(argname, argmode, orden)
   WHERE p.oid = 'public.sso_lookup_domain(text)'::regprocedure
     AND a.argmode = 't';
  IF v_campos IS DISTINCT FROM 'sso_available,enforced,provider_id' THEN
    RAISE EXCEPTION '❌ sso_lookup_domain ya no devuelve sólo los tres campos mínimos: %', v_campos;
  END IF;
  RAISE NOTICE 'OK    anon SÍ puede llamar sso_lookup_domain y recibe sólo {sso_available, enforced, provider_id}';
END $$;

-- ── anon sobre un dominio NO verificado: cero filas, sin filtrar nada ───────
DO $$
DECLARE v_n int;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.sso_lookup_domain('sinverificar.test');
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '❌ sso_lookup_domain anunció un dominio sin verificar (% filas)', v_n;
  END IF;
  RAISE NOTICE 'OK    anon no obtiene nada de un dominio sin verificar';
END $$;

-- ── Las cinco de backend: ni anon ni authenticated las invocan ──────────────
DO $$
DECLARE
  v_rol  text;
  v_sql  text;
  v_caso text;
  v_casos text[] := ARRAY[
    'SELECT public.migrate_custom_auth_to_supabase_unconfirmed()',
    'SELECT public.create_default_conversation_access_rules(''11111111-1111-1111-1111-111111111111''::uuid)',
    'SELECT public.fill_company_id_from_user()',
    'SELECT public.fn_set_recipient_company_id()',
    'SELECT public.set_updated_at()'
  ];
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_caso IN ARRAY v_casos LOOP
      BEGIN
        v_sql := v_caso;
        EXECUTE format('SET LOCAL ROLE %I', v_rol);
        EXECUTE v_sql;
        RAISE EXCEPTION '❌ % PUDO invocar directamente: %', v_rol, v_sql;
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'OK    % NO puede invocar %  (42501)', v_rol, v_sql;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ── service_role conserva el acceso que necesita ────────────────────────────
-- Las dos invocables de verdad se llaman y hacen su trabajo; las tres de
-- trigger tienen que fallar con 0A000 —no con 42501—, que es la prueba de que
-- la ACL las dejó pasar.
DO $$
DECLARE v_res jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  v_res := public.migrate_custom_auth_to_supabase_unconfirmed();
  PERFORM public.create_default_conversation_access_rules('22222222-2222-2222-2222-222222222222'::uuid);
  PERFORM public.buscar_cliente_para_onboarding('1234567890101', '1990-01-01', 'caso.seguro@ejemplo.test');
  PERFORM public.sso_lookup_domain('acme.test');
  RESET ROLE;
  IF v_res IS NULL THEN
    RAISE EXCEPTION '❌ service_role llamó migrate_custom_auth_... y no obtuvo resultado';
  END IF;
  PERFORM public.chk(
    (SELECT count(*) FROM public.conversation_access_rules
      WHERE company_id = '22222222-2222-2222-2222-222222222222'),
    4, 'service_role sembró las 4 reglas con create_default_conversation_access_rules');
  RAISE NOTICE 'OK    service_role conserva el acceso a las funciones invocables';
END $$;

DO $$
DECLARE
  v_caso  text;
  v_casos text[] := ARRAY[
    'SELECT public.fill_company_id_from_user()',
    'SELECT public.fn_set_recipient_company_id()',
    'SELECT public.set_updated_at()'
  ];
BEGIN
  FOREACH v_caso IN ARRAY v_casos LOOP
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE v_caso;
      RAISE EXCEPTION '❌ una función de trigger se dejó llamar suelta: %', v_caso;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION '❌ service_role PERDIÓ EXECUTE sobre %  (42501)', v_caso;
      WHEN feature_not_supported THEN
        RAISE NOTICE 'OK    service_role pasa la ACL de %; la rechaza el motor por ser de trigger (0A000)', v_caso;
    END;
  END LOOP;
END $$;
