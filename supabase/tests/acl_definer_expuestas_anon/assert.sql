-- ════════════════════════════════════════════════════════════════════════════
-- DESPUÉS de la migración: la matriz de producción, celda por celda.
--
-- Es la MISMA matriz que declara 20260911223000 y la misma que tiene hoy
-- nnsqmeigtgewatameexo. Se pregunta con has_function_privilege —lo que de
-- verdad decide en tiempo de ejecución— y se comprueban las CUATRO celdas de
-- cada fila, incluidas las que deben seguir en SÍ: una prueba que sólo mira los
-- `no` convierte «revocar de más» en un aprobado.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_matriz text[][] := ARRAY[
    -- firma                                              PUBLIC anon auth  srv
    ['sso_lookup_domain(text)',                            'f',  't', 't', 't'],
    ['buscar_cliente_para_onboarding(text, date, text)',   'f',  'f', 't', 't'],
    ['migrate_custom_auth_to_supabase_unconfirmed()',      'f',  'f', 'f', 't'],
    ['create_default_conversation_access_rules(uuid)',     'f',  'f', 'f', 't'],
    ['fill_company_id_from_user()',                        'f',  'f', 'f', 't'],
    ['fn_set_recipient_company_id()',                      'f',  'f', 'f', 't'],
    ['set_updated_at()',                                   'f',  'f', 'f', 't']
  ];
  v_roles text[] := ARRAY['public', 'anon', 'authenticated', 'service_role'];
  v_fn    text;
  v_i     int;
  v_j     int;
BEGIN
  FOR v_i IN 1 .. array_length(v_matriz, 1) LOOP
    v_fn := v_matriz[v_i][1];
    IF to_regprocedure('public.' || v_fn) IS NULL THEN
      RAISE EXCEPTION '❌ no existe public.% — ¿cambió una firma?', v_fn;
    END IF;
    FOR v_j IN 1 .. array_length(v_roles, 1) LOOP
      PERFORM public.chk(
        has_function_privilege(v_roles[v_j], to_regprocedure('public.' || v_fn), 'EXECUTE')::int,
        (v_matriz[v_i][v_j + 1] = 't')::int,
        format('%-13s %s %s', v_roles[v_j],
               CASE WHEN v_matriz[v_i][v_j + 1] = 't' THEN 'SÍ ejecuta' ELSE 'NO ejecuta' END,
               v_fn));
    END LOOP;
  END LOOP;
END $$;

-- El lint `anon` de los asesores, POR NOMBRE y no por conteo: entre estas
-- siete, la única que queda es sso_lookup_domain.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname = ANY (ARRAY[
        'buscar_cliente_para_onboarding', 'migrate_custom_auth_to_supabase_unconfirmed',
        'create_default_conversation_access_rules', 'fill_company_id_from_user',
        'fn_set_recipient_company_id', 'set_updated_at'])),
  0,
  'lint anon: ninguna de las otras seis');

SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname = 'sso_lookup_domain'),
  1,
  'lint anon: sso_lookup_domain SIGUE ahí, que es la excepción documentada');

-- El lint `authenticated`, igual: sólo sso_lookup_domain y
-- buscar_cliente_para_onboarding.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname = ANY (ARRAY[
        'migrate_custom_auth_to_supabase_unconfirmed',
        'create_default_conversation_access_rules', 'fill_company_id_from_user',
        'fn_set_recipient_company_id', 'set_updated_at'])),
  0,
  'lint authenticated: ninguna de las cinco de backend');
