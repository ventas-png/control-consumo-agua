\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: tras RE-APLICAR 20260905000300 sobre una base ya migrada y
-- con tareas ya materializadas, nada se duplica, pierde ni afloja.

DO $$
DECLARE
  B1 uuid := '70000000-0000-0000-0000-000000000001';
  n  bigint;
BEGIN
  -- Las tareas generadas siguen ahí y no se duplicaron.
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = B1;
  IF n <> 3 THEN
    RAISE EXCEPTION 'idem-1: el bloque quedó con % tareas (esperadas 3)', n; END IF;

  -- El snapshot sobrevive.
  IF (SELECT duracion_estimada_min FROM public.tareas_bloque
      WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000001') <> 20 THEN
    RAISE EXCEPTION 'idem-2: la re-aplicación perdió el snapshot de duración'; END IF;

  -- La anulación también.
  IF (SELECT anulada_en FROM public.tareas_bloque
      WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000002') IS NULL THEN
    RAISE EXCEPTION 'idem-3: la re-aplicación revivió una tarea anulada'; END IF;

  -- La FK de linaje sigue siendo UNA y sigue siendo RESTRICT.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname = 'tareas_bloque_rutina_fk' AND confdeltype = 'r';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-4: la FK de rutina no es única o dejó de ser RESTRICT'; END IF;

  -- La RPC sigue existiendo una sola vez, y anon sigue fuera.
  SELECT count(*) INTO n FROM pg_proc WHERE proname = 'materializar_rutinas_turno';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-5: hay % versiones de la RPC', n; END IF;
  IF has_function_privilege('anon',
       'public.materializar_rutinas_turno(uuid, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'idem-6: re-aplicar le devolvió EXECUTE a anon'; END IF;

  RAISE NOTICE 'OK   re-aplicar no duplica tareas ni la RPC, conserva snapshot y anulación, y deja anon fuera';
END;
$$;
