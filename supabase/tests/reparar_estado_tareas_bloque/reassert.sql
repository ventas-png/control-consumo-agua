\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260907000700 sobre la base ya reparada no
-- puede duplicar el constraint, des-validarlo ni tocar una fila.

DO $$
DECLARE
  v_convalidated boolean;
  n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname LIKE 'tareas_bloque_estado_check%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: la re-aplicación dejó % constraints de estado (esperado: 1, sin andamiajes)', n; END IF;

  SELECT convalidated INTO v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';
  IF v_convalidated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'idem-2: la re-aplicación des-validó el constraint'; END IF;

  -- El reparto de estados que dejó assert.sql: 1 pendiente, 2 completadas,
  -- 1 omitida. Una re-aplicación que "re-convierta" algo lo cambiaría.
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE estado = 'pendiente';
  IF n <> 1 THEN RAISE EXCEPTION 'idem-3: pendientes = % (esperado 1)', n; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE estado = 'completada';
  IF n <> 2 THEN RAISE EXCEPTION 'idem-4: completadas = % (esperado 2)', n; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE estado = 'omitida';
  IF n <> 1 THEN RAISE EXCEPTION 'idem-5: omitidas = % (esperado 1)', n; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque;
  IF n <> 4 THEN RAISE EXCEPTION 'idem-6: hay % filas (esperado 4): la re-aplicación insertó o borró', n; END IF;

  -- La re-aplicación no re-estampó motivos (la conversión no encontró filas):
  -- sigue habiendo exactamente uno, el de la primera pasada.
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE motivo_sin_evidencia IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-6b: la re-aplicación cambió los motivos estampados (hay %)', n; END IF;

  -- Y sigue rechazando lo legacy.
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'en_curso'
     WHERE id = 'a1000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'idem-7: tras re-aplicar, ''en_curso'' volvió a entrar';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'OK   re-aplicar es no-op: un solo constraint, validado, datos intactos, legacy rechazado';
END;
$$;
