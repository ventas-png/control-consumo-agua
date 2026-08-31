-- ════════════════════════════════════════════════════════════════════════════
-- NEGATIVA (fase 2): con 20260907001000 aplicada, los tres agujeros de
-- 20260907001100 SE REPRODUCEN. Si dejaran de reproducirse, el escenario no
-- prueba nada — este archivo ABORTA en ese caso.
--
-- Todo dentro de UNA transacción que se REVIERTE al final: la demostración no
-- contamina el estado sobre el que después corren la migración y assert.sql.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

SELECT set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

-- ── 1 · lo OMITIDO consumía inventario ──────────────────────────────────────
DO $$
DECLARE
  v_consumidos int;
  v_cloro numeric;
BEGIN
  UPDATE public.tareas_bloque
     SET estado = 'omitida', completada_en = now()
   WHERE id = 'a1000000-0000-0000-0000-000000000001';

  -- El motor consume TODO el plan no reclamado (lo no declarado cae al plan):
  -- Cloro 2 declarado + Bolsas 3 del plan — dos salidas de una tarea NO hecha.
  SELECT consumidos INTO v_consumidos
  FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000001',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":2}]'::jsonb);
  SELECT stock_actual INTO v_cloro FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_consumidos <> 2 OR v_cloro <> 8 THEN
    RAISE EXCEPTION 'la vulnerabilidad ya no se reproduce: la tarea OMITIDA no '
      'consumió (consumidos=%, cloro=%) — revisá el fixture antes de confiar '
      'en esta suite', v_consumidos, v_cloro;
  END IF;
  RAISE NOTICE 'NEGATIVA 1: una tarea OMITIDA — trabajo NO realizado — descontó el plan entero del inventario';
END $$;

-- ── 2 · 0.001 se volvía un movimiento de 0.00 que reclama sin descontar ─────
DO $$
DECLARE
  v_mov numeric;
  v_reclamada boolean;
BEGIN
  UPDATE public.tareas_bloque
     SET estado = 'completada'
   WHERE id = 'a1000000-0000-0000-0000-000000000002';

  PERFORM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000002',
    '[{"suministro_id":"50000000-0000-0000-0000-000000000001","cantidad":0.001}]'::jsonb);

  SELECT m.cantidad, tbs.movimiento_id IS NOT NULL
    INTO v_mov, v_reclamada
  FROM public.tarea_bloque_suministros tbs
  LEFT JOIN public.movimientos_suministro m ON m.id = tbs.movimiento_id
  WHERE tbs.tarea_id = 'a1000000-0000-0000-0000-000000000002'
    AND tbs.suministro_id = '50000000-0000-0000-0000-000000000001';
  IF NOT v_reclamada OR v_mov IS DISTINCT FROM 0.00 THEN
    RAISE EXCEPTION 'la vulnerabilidad ya no se reproduce: 0.001 no dejó el '
      'movimiento redondeado a 0.00 (reclamada=%, cantidad=%) — revisá el '
      'fixture antes de confiar en esta suite', v_reclamada, v_mov;
  END IF;
  RAISE NOTICE 'NEGATIVA 2: 0.001 pasó la validación y numeric(10,2) lo redondeó a un movimiento de 0.00 — fila reclamada sin descontar nada';
END $$;

-- ── 3 · el mismo UUID en mayúsculas pasaba como «otro» suministro ───────────
DO $$
DECLARE
  v_consumidos int;
BEGIN
  -- El chequeo de duplicados agrupaba por TEXTO: dos representaciones del
  -- MISMO uuid (aquí, con y sin guiones — el cast acepta ambas, y el fixture
  -- usa uuids de solo dígitos donde may/min no distingue) no colisionan, y el
  -- LATERAL (LIMIT 1) elige una al azar. T5 (plan intacto) se cierra aquí
  -- mismo — todo se revierte al final.
  UPDATE public.tareas_bloque
     SET estado = 'completada'
   WHERE id = 'a1000000-0000-0000-0000-000000000005';

  SELECT consumidos INTO v_consumidos
  FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000005',
    ('[{"suministro_id":"50000000-0000-0000-0000-000000000002","cantidad":1},' ||
     '{"suministro_id":"' || replace('50000000-0000-0000-0000-000000000002', '-', '') || '","cantidad":3}]')::jsonb);
  IF v_consumidos <> 2 THEN
    RAISE EXCEPTION 'la vulnerabilidad ya no se reproduce: el par may/min no '
      'entró como duplicado silencioso (consumidos=%) — revisá el fixture '
      'antes de confiar en esta suite', v_consumidos;
  END IF;
  RAISE NOTICE 'NEGATIVA 3: el MISMO uuid en dos representaciones pasó el chequeo de duplicados y una de las dos ganó al azar';
END $$;

ROLLBACK;
