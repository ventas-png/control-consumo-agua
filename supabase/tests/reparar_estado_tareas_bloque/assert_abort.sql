\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Tras el ABORTO por 'en_curso': la transacción se revirtió ENTERA. Ni
-- conversiones a medias, ni constraint dropeado, ni definición cambiada — el
-- peor resultado posible sería un aborto que deja la base a medio migrar.

DO $$
DECLARE
  v_def          text;
  v_convalidated boolean;
  n              bigint;
BEGIN
  -- El homónimo LEGACY sigue ahí, validado, con su definición original.
  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'abort-1: el aborto se llevó el constraint (quedó la tabla sin CHECK)'; END IF;
  IF v_def NOT LIKE '%''en_curso''%' OR v_def LIKE '%''con_observacion''%' THEN
    RAISE EXCEPTION 'abort-2: la definición cambió pese al aborto: %', v_def; END IF;
  IF v_convalidated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'abort-3: el constraint quedó des-validado pese al aborto'; END IF;

  -- Ningún andamiaje huérfano.
  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check_esperada';
  IF n <> 0 THEN
    RAISE EXCEPTION 'abort-4: quedó vivo el constraint de andamiaje'; END IF;

  -- Y los datos, byte a byte como antes: nada se convirtió.
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE estado = 'completado';
  IF n <> 2 THEN RAISE EXCEPTION 'abort-5: completado = % (esperado 2: la conversión debía revertirse)', n; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE estado = 'omitido';
  IF n <> 1 THEN RAISE EXCEPTION 'abort-6: omitido = % (esperado 1)', n; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE estado = 'en_curso';
  IF n <> 1 THEN RAISE EXCEPTION 'abort-7: en_curso = % (esperado 1)', n; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE estado IN ('completada', 'omitida', 'con_observacion');
  IF n <> 0 THEN RAISE EXCEPTION 'abort-8: % fila(s) quedaron convertidas pese al aborto', n; END IF;
  -- El estampado de motivo_sin_evidencia también se revirtió con el rollback.
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE motivo_sin_evidencia IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'abort-9: % motivo(s) estampados sobrevivieron al aborto', n; END IF;

  RAISE NOTICE 'OK   el aborto por en_curso no dejó rastro: constraint, definición y datos intactos';
END;
$$;
