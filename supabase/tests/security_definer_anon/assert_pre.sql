-- Reproduce el hallazgo del guard ANTES de la migración: las 10 funciones son
-- anon-ejecutables. Estricto a propósito: si alguna NO lo fuera, el fixture ya
-- no representa el estado que el P1 denuncia y la suite dejaría de probar nada.
\set ON_ERROR_STOP on

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'banco_tg_movimiento_ledger()',
    'banco_tg_propagar_ledger_movimientos()',
    'conta_tg_linea_mismo_ledger()',
    'cxp_seed_iva_on_company()',
    'cxp_seed_on_company()',
    'fn_sincronizar_estado_personal()',
    'set_registros_project_id()',
    'can_access_conversation_project(uuid)',
    'is_conversation_assigned_to_me(uuid)',
    'conta_puede_escribir(text)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF NOT has_function_privilege('anon', to_regprocedure('public.' || fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'esperaba REPRODUCIR el hallazgo y anon NO puede ejecutar % — fixture desalineado', fn;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK    hallazgo reproducido: anon puede ejecutar las 10 (grant implícito de PUBLIC)';
  RAISE NOTICE 'OK    causa raíz demostrada: conta_puede_escribir tenía REVOKE FROM anon (20260818000000) y anon ejecuta IGUAL — hereda de PUBLIC';
END $$;

-- La consulta (a) del guard, verbatim (security-guard.mjs:40-44), acotada a las
-- 10: debe verlas TODAS antes de la migración.
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
  10,
  'consulta (a) del guard ve los 10 hallazgos antes de la migración');
