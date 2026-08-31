-- ════════════════════════════════════════════════════════════════════════════
-- Tras RE-APLICAR 20260907001000: nada se duplicó, nada se reabrió, nada se
-- volvió a descontar. La idempotencia de la migración no es un adorno: el
-- apply de producción puede reintentarse.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n int;
BEGIN
  -- Una sola definición de cada función (CREATE OR REPLACE, no duplicados).
  SELECT count(*) INTO n FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname IN ('cerrar_tarea_y_consumir_insumos',
                      'consumir_insumos_tarea',
                      'tarea_bloque_consumir_reclamado');
  IF n <> 3 THEN
    RAISE EXCEPTION 'RE-1: se esperaban exactamente 3 funciones (hay %)', n;
  END IF;

  -- Un solo CHECK y un solo índice parcial.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conrelid = 'public.tarea_bloque_suministros'::regclass
    AND conname = 'tbs_consumo_o_descarte_check';
  IF n <> 1 THEN
    RAISE EXCEPTION 'RE-2: el CHECK se duplicó o se perdió (hay %)', n;
  END IF;
  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'idx_tbs_pendientes';
  IF n <> 1 THEN
    RAISE EXCEPTION 'RE-3: idx_tbs_pendientes se duplicó o se perdió (hay %)', n;
  END IF;

  -- El estado de los datos no se movió: 6 movimientos, 6 filas reclamadas,
  -- el «no usado» sigue sellado y el stock donde la carrera lo dejó.
  IF (SELECT count(*) FROM public.movimientos_suministro) <> 6 THEN
    RAISE EXCEPTION 'RE-4: re-aplicar cambió los movimientos';
  END IF;
  IF (SELECT count(*) FROM public.tarea_bloque_suministros
      WHERE movimiento_id IS NOT NULL) <> 6 THEN
    RAISE EXCEPTION 'RE-5: re-aplicar cambió las filas reclamadas';
  END IF;
  IF (SELECT no_usado_en FROM public.tarea_bloque_suministros
      WHERE tarea_id = 'a1000000-0000-0000-0000-000000000002'
        AND suministro_id = '50000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION 'RE-6: el backfill re-corrió y tocó un sello existente';
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 5 THEN
    RAISE EXCEPTION 'RE-7: re-aplicar movió el stock';
  END IF;
  RAISE NOTICE 'RE · re-aplicar no duplica funciones ni constraints, y no toca datos';
END $$;

-- Y el replay 001000 → 001100 conserva el ENDURECIMIENTO: si el orden del
-- re-apply dejara la versión permisiva, lo omitido volvería a consumir.
DO $$
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000003', '[]'::jsonb);
    RAISE EXCEPTION 'RE-8: tras el replay, la tarea omitida volvió a poder consumir';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000006',
      '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":0.001}]'::jsonb);
    RAISE EXCEPTION 'RE-9: tras el replay, 0.001 volvió a colarse';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  RAISE NOTICE 'RE · el replay conserva el endurecimiento: omitida y 0.001 siguen fuera';
END $$;
