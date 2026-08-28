-- ════════════════════════════════════════════════════════════════════════════
-- NEGATIVA: con 20260907000500 a solas, los agujeros de #809 SE REPRODUCEN.
-- Si dejaran de reproducirse, el escenario no prueba nada — este archivo
-- ABORTA en ese caso, para que nadie relaje la migración creyendo que la
-- vulnerabilidad «ya no estaba».
--
-- Todo dentro de UNA transacción que se REVIERTE al final: la demostración no
-- contamina el estado sobre el que después corren la migración y assert.sql.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

SELECT set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

-- ── 1 · el consumo NO exige cierre, y el 0 NO es terminal ───────────────────
DO $$
DECLARE
  v_estado text;
  v_consumidos int;
  v_no_usados int;
  v_movs int;
  v_cloro numeric;
BEGIN
  SELECT estado INTO v_estado FROM public.tareas_bloque
   WHERE id = 'a1000000-0000-0000-0000-000000000001';
  IF v_estado <> 'pendiente' THEN
    RAISE EXCEPTION 'la NEGATIVA necesita a T1 pendiente (está %)', v_estado;
  END IF;

  -- «No usé nada»: las dos filas quedan con motivo… y siguen reclamables.
  SELECT consumidos, no_usados INTO v_consumidos, v_no_usados
  FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000001',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":0},
      {"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":0}]'::jsonb);
  IF v_consumidos <> 0 OR v_no_usados <> 2 THEN
    RAISE EXCEPTION 'NEGATIVA 1a: se esperaba 0 consumidos / 2 no usados (hubo %/%)',
      v_consumidos, v_no_usados;
  END IF;

  -- Una llamada posterior que sólo MENCIONA los insumos (sin `cantidad`: el
  -- COALESCE cae al plan) las consume completas — sobre una tarea que sigue
  -- PENDIENTE. Los dos agujeros en una sola llamada.
  SELECT consumidos INTO v_consumidos
  FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000001',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001"},
      {"suministro_id":"50000000-0000-0000-0000-000000000002"}]'::jsonb);
  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000001';
  SELECT stock_actual INTO v_cloro FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_consumidos <> 2 OR v_movs <> 2 OR v_cloro <> 8 THEN
    RAISE EXCEPTION 'la vulnerabilidad ya no se reproduce: el RPC viejo no consumió '
      'la tarea pendiente tras el 0 (consumidos=%, movs=%, cloro=%) — '
      'revisá el fixture antes de confiar en esta suite', v_consumidos, v_movs, v_cloro;
  END IF;
  RAISE NOTICE 'NEGATIVA 1: una tarea PENDIENTE consumió inventario, y el «no lo usé» no fue terminal';
END $$;

-- ── 2 · el JSON sin validar deja pasar NaN y envenena el stock ──────────────
DO $$
DECLARE
  v_bolsas numeric;
BEGIN
  PERFORM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000002',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":"NaN"}]'::jsonb);
  SELECT stock_actual INTO v_bolsas FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000002';
  IF v_bolsas IS DISTINCT FROM 'NaN'::numeric THEN
    RAISE EXCEPTION 'la vulnerabilidad ya no se reproduce: "NaN" no envenenó el '
      'stock (quedó %) — revisá el fixture antes de confiar en esta suite', v_bolsas;
  END IF;
  RAISE NOTICE 'NEGATIVA 2: "NaN" pasó el <= 0, generó un movimiento y el stock quedó NaN';
END $$;

-- ── 3 · dos operaciones = descuadre sin reintento ───────────────────────────
-- El frontend viejo cerraba con un UPDATE y descontaba en una SEGUNDA llamada.
-- Si la segunda nunca llega, nada la reintenta: cerrada y con el almacén
-- intacto. (T3 no tiene plan de insumos consumido: basta el UPDATE.)
DO $$
DECLARE
  v_estado text;
  v_movs int;
BEGIN
  UPDATE public.tareas_bloque
     SET estado = 'completada', completada_en = now()
   WHERE id = 'a1000000-0000-0000-0000-000000000003';
  SELECT estado INTO v_estado FROM public.tareas_bloque
   WHERE id = 'a1000000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_movs FROM public.movimientos_suministro
   WHERE origen_id = 'a1000000-0000-0000-0000-000000000003';
  IF v_estado <> 'completada' OR v_movs <> 0 THEN
    RAISE EXCEPTION 'NEGATIVA 3: se esperaba cerrada sin movimientos (estado=%, movs=%)',
      v_estado, v_movs;
  END IF;
  RAISE NOTICE 'NEGATIVA 3: el cierre en dos pasos deja la tarea cerrada y el stock intacto si el segundo paso se pierde';
END $$;

ROLLBACK;
