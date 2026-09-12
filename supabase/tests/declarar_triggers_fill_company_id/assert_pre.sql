-- ════════════════════════════════════════════════════════════════════════════
-- ANTES de la migración: el fixture reproduce el hueco de la reconstrucción.
--
-- Ninguno de los dos triggers existe, y por eso una inserción sin company_id
-- hecha como `authenticated` —lo que hace la app por la Data API— muere en el
-- WITH CHECK de RLS. Si este archivo no fallara aquí, el resto de la prueba no
-- estaría midiendo nada.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

SELECT public.chk(
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('fuentes_agua_fill_company_id', 'registros_calidad_fill_company_id')
      AND NOT tgisinternal),
  0, 'ninguno de los dos triggers existe en la reconstrucción sin 20260912015504');

DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.fuentes_agua (identificador, nombre, tipo_agua) VALUES ('F-1', 'Pozo 1', 'pozo');
    RAISE EXCEPTION '❌ sin trigger, la inserción en fuentes_agua NO debía pasar el WITH CHECK';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK    sin trigger, fuentes_agua rechaza por RLS la fila sin company_id (42501)';
  END;
  BEGIN
    INSERT INTO public.registros_calidad (parametros) VALUES ('{}'::jsonb);
    RAISE EXCEPTION '❌ sin trigger, la inserción en registros_calidad NO debía pasar el WITH CHECK';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK    sin trigger, registros_calidad rechaza por RLS la fila sin company_id (42501)';
  END;
  RESET ROLE;
END $$;
