\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260905000100 sobre una base ya migrada no
-- puede revivir las legadas, duplicar policies ni perder las garantías.

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE policyname IN ('company_rw_tareas_bloque', 'company_rw_revisiones_tarea');
  IF n <> 0 THEN
    RAISE EXCEPTION 'idem-1: la re-aplicación revivió una policy legada'; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'tareas_bloque';
  IF n <> 4 THEN
    RAISE EXCEPTION 'idem-2: tareas_bloque debía quedar con 4 policies y tiene %', n; END IF;

  SELECT count(*) INTO n FROM pg_policies WHERE tablename = 'revisiones_tarea';
  IF n <> 4 THEN
    RAISE EXCEPTION 'idem-3: revisiones_tarea debía quedar con 4 policies y tiene %', n; END IF;

  -- Los constraints e índices siguen ahí (uno solo de cada, sin duplicar).
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('tareas_bloque_estado_check', 'tareas_bloque_prioridad_check',
                    'tareas_bloque_anulacion_check');
  IF n <> 3 THEN
    RAISE EXCEPTION 'idem-4: faltan CHECKs de tareas_bloque (hay %)', n; END IF;

  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_tareas_bloque_plantilla';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-5: el índice único de plantilla por bloque desapareció'; END IF;

  -- Y los triggers de sellado no se duplicaron.
  SELECT count(*) INTO n FROM pg_trigger
  WHERE tgrelid = 'public.tareas_bloque'::regclass AND NOT tgisinternal;
  IF n <> 2 THEN
    RAISE EXCEPTION 'idem-6: tareas_bloque debía tener 2 triggers de sellado y tiene %', n; END IF;

  RAISE NOTICE 'OK   re-aplicar no revive legadas, no duplica policies ni triggers y conserva las garantías';
END;
$$;
