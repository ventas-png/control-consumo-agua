-- Post-migración 20260825010000: estado final de ACLs.
\set ON_ERROR_STOP on

DO $$
DECLARE
  fn text;
  triggers text[] := ARRAY[
    'banco_tg_movimiento_ledger()',
    'banco_tg_propagar_ledger_movimientos()',
    'conta_tg_linea_mismo_ledger()',
    'cxp_seed_iva_on_company()',
    'cxp_seed_on_company()',
    'fn_sincronizar_estado_personal()',
    'set_registros_project_id()'
  ];
  helpers text[] := ARRAY[
    'can_access_conversation_project(uuid)',
    'is_conversation_assigned_to_me(uuid)',
    'conta_puede_escribir(text)'
  ];
BEGIN
  FOREACH fn IN ARRAY triggers || helpers LOOP
    PERFORM public.chk(
      has_function_privilege('anon', to_regprocedure('public.' || fn), 'EXECUTE')::int,
      0, format('anon NO puede ejecutar %s', fn));
  END LOOP;
  FOREACH fn IN ARRAY triggers LOOP
    PERFORM public.chk(
      has_function_privilege('authenticated', to_regprocedure('public.' || fn), 'EXECUTE')::int,
      0, format('authenticated NO puede ejecutar %s (función de trigger)', fn));
  END LOOP;
  FOREACH fn IN ARRAY helpers LOOP
    PERFORM public.chk(
      has_function_privilege('authenticated', to_regprocedure('public.' || fn), 'EXECUTE')::int,
      1, format('authenticated SÍ puede ejecutar %s (helper de policy)', fn));
  END LOOP;
END $$;

-- La consulta (a) del guard, verbatim: ya no ve NINGUNA de las 10.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname = ANY (ARRAY[
        'banco_tg_movimiento_ledger','banco_tg_propagar_ledger_movimientos',
        'conta_tg_linea_mismo_ledger','cxp_seed_iva_on_company','cxp_seed_on_company',
        'fn_sincronizar_estado_personal','set_registros_project_id',
        'can_access_conversation_project','is_conversation_assigned_to_me',
        'conta_puede_escribir'])),
  0,
  'consulta (a) del guard: 0 de las 10 tras la migración');
