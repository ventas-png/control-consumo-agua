-- ════════════════════════════════════════════════════════════════════════════
-- ANTES de la migración: el defecto está ahí, tal como lo dejan S22 + S23.
-- Cualquier INSERT en registros_calidad —como postgres o como authenticated—
-- y cualquier UPDATE de parametros mueren con 42725 dentro del trigger.
-- Todo en una transacción que se revierte.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public;

DO $$
DECLARE v_estado text;
BEGIN
  PERFORM public.chk((SELECT count(*) FROM pg_proc WHERE proname = 'calcular_cumplimiento_calidad' AND pronamespace = 'public'::regnamespace),
    2, 'hay DOS sobrecargas de calcular_cumplimiento_calidad (S22 + S23)');
  PERFORM public.chk_txt(
    (SELECT tgfoid::regprocedure::text FROM pg_trigger WHERE tgname = 'registros_calidad_cumplimiento' AND NOT tgisinternal),
    'trg_registros_calidad_cumplimiento()', 'el trigger ejecuta la función de S22');
  PERFORM public.chk((SELECT count(*) FROM public.calidad_tipologias WHERE company_id IS NULL), 9,
    'S23 sembró las 9 tipologías globales');

  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros, company_id)
    VALUES ('fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42725', 'ANTES · INSERT como postgres muere con 42725 (función no única): ' || v_estado);

  -- Sin el trigger la fila entra: así se puede medir también el UPDATE.
  ALTER TABLE public.registros_calidad DISABLE TRIGGER registros_calidad_cumplimiento;
  INSERT INTO public.registros_calidad (id, fuente_id, parametros, company_id)
    VALUES ('0c0c0c0c-0000-4000-8000-000000000001', 'fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  ALTER TABLE public.registros_calidad ENABLE TRIGGER registros_calidad_cumplimiento;
  v_estado := public.intentar($q$ UPDATE public.registros_calidad SET parametros = '{"pH": 8}'::jsonb WHERE id = '0c0c0c0c-0000-4000-8000-000000000001' $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42725', 'ANTES · UPDATE de parametros como postgres muere con 42725: ' || v_estado);
  v_estado := public.intentar($q$ UPDATE public.registros_calidad SET observaciones = 'x' WHERE id = '0c0c0c0c-0000-4000-8000-000000000001' $q$);
  PERFORM public.chk_txt(v_estado, 'OK', 'ANTES · UPDATE de una columna que no dispara el trigger sí pasa (el defecto es del trigger)');
END $$;

-- Como authenticated (admin de A): el mismo 42725, que es lo que ve la app.
SELECT set_config('request.jwt.claim.sub', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_estado text;
BEGIN
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros)
    VALUES ('fa0f0f0f-0000-4000-8000-00000000a001', '{"pH": 7.5}'::jsonb) $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42725', 'ANTES · INSERT como authenticated muere con 42725: ' || v_estado);
END $$;
RESET ROLE;
ROLLBACK;
