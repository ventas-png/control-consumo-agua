-- ════════════════════════════════════════════════════════════════════════════
-- ANTES de la migración: el hallazgo de la Preview limpia de #856.
-- Las siete nacen ejecutables por anon, authenticated y service_role — no
-- porque alguien lo escribiera, sino porque nadie revocó nada y una Supabase
-- nueva regala EXECUTE a los tres con ALTER DEFAULT PRIVILEGES.
-- Si esto dejara de reproducirse, la prueba ya no demuestra lo que dice.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_fn  text;
  v_rol text;
  v_fns text[] := ARRAY[
    'sso_lookup_domain(text)',
    'buscar_cliente_para_onboarding(text, date, text)',
    'migrate_custom_auth_to_supabase_unconfirmed()',
    'create_default_conversation_access_rules(uuid)',
    'fill_company_id_from_user()',
    'fn_set_recipient_company_id()',
    'set_updated_at()'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF to_regprocedure('public.' || v_fn) IS NULL THEN
      RAISE EXCEPTION '❌ el fixture no creó public.% — ¿cambió una firma?', v_fn;
    END IF;
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      PERFORM public.chk(
        has_function_privilege(v_rol, to_regprocedure('public.' || v_fn), 'EXECUTE')::int,
        1, format('%s PUEDE ejecutar %s (el hueco que la migración cierra)', v_rol, v_fn));
    END LOOP;
  END LOOP;
END $$;

-- La consulta (a) de security-guard.mjs, verbatim salvo el filtro por nombre:
-- las SIETE son hallazgo antes de la migración.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname = ANY (ARRAY[
        'sso_lookup_domain', 'buscar_cliente_para_onboarding',
        'migrate_custom_auth_to_supabase_unconfirmed',
        'create_default_conversation_access_rules', 'fill_company_id_from_user',
        'fn_set_recipient_company_id', 'set_updated_at'])),
  7,
  'consulta (a) del guard: las 7 son hallazgo ANTES de la migración');
