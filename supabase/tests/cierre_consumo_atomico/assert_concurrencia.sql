-- ════════════════════════════════════════════════════════════════════════════
-- Después de la carrera (dos sesiones reales sincronizadas con barrera en
-- run.sh): T6 quedó cerrada UNA vez y cada fila del plan tiene EXACTAMENTE un
-- movimiento. Los resultados por sesión (2 y 0) los verifica run.sh, que es
-- quien tiene los dos archivos de salida.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v record;
  v_movs int;
  v_reclamadas int;
  v_distintos int;
BEGIN
  SELECT estado, completada_en, completado_por INTO v
  FROM public.tareas_bloque WHERE id = 'a1000000-0000-0000-0000-000000000006';
  IF v.estado <> 'completada' OR v.completada_en IS NULL
     OR v.completado_por IS DISTINCT FROM 'a0000000-0000-0000-0000-00000000000a' THEN
    RAISE EXCEPTION 'C-a: T6 debía quedar completada y sellada por Ana (estado=%, por=%)',
      v.estado, v.completado_por;
  END IF;

  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000006';
  IF v_movs <> 2 THEN
    RAISE EXCEPTION 'C-b: dos sesiones concurrentes dejaron % movimientos para un plan de 2 filas', v_movs;
  END IF;

  SELECT count(*), count(DISTINCT movimiento_id) INTO v_reclamadas, v_distintos
  FROM public.tarea_bloque_suministros
  WHERE tarea_id = 'a1000000-0000-0000-0000-000000000006'
    AND movimiento_id IS NOT NULL;
  IF v_reclamadas <> 2 OR v_distintos <> 2 THEN
    RAISE EXCEPTION 'C-c: cada fila debía reclamar su propio movimiento (%/% distintos)',
      v_reclamadas, v_distintos;
  END IF;

  -- El descuento ocurrió UNA vez: Cloro 7 → 5. (Bolsas ya estaba en el piso.)
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000001') <> 5 THEN
    RAISE EXCEPTION 'C-d: el Cloro debía quedar en 5 (un solo descuento de 2)';
  END IF;
  IF (SELECT stock_actual FROM public.suministros_condominio
      WHERE id = '50000000-0000-0000-0000-000000000002') <> 0 THEN
    RAISE EXCEPTION 'C-e: las Bolsas debían seguir en 0';
  END IF;

  -- Contabilidad global tras la carrera: 6 reclamadas ↔ 6 movimientos, 1:1.
  SELECT count(*), count(DISTINCT movimiento_id) INTO v_reclamadas, v_distintos
  FROM public.tarea_bloque_suministros WHERE movimiento_id IS NOT NULL;
  IF v_reclamadas <> 6 OR v_distintos <> 6
     OR (SELECT count(*) FROM public.movimientos_suministro) <> 6 THEN
    RAISE EXCEPTION 'C-f: la contabilidad global no cuadra (% filas, % movimientos distintos)',
      v_reclamadas, v_distintos;
  END IF;
  RAISE NOTICE 'C · la carrera dejó UN cierre, 2 movimientos (uno por fila) y un solo descuento';
END $$;
