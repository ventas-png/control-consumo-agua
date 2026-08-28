\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Escenario del esquema DECLARADO: el CHECK ya era canónico pero NOT VALID y
-- una fila legacy anterior al constraint seguía viva. La reparación no debía
-- dropear nada — solo convertir y VALIDAR.

DO $$
DECLARE
  v_def_esperada text;
  v_def          text;
  v_convalidated boolean;
  v_estado       text;
  n              bigint;
BEGIN
  CREATE TEMP TABLE _def_esperada (
    estado text,
    CONSTRAINT _check_esperada
      CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
  );
  SELECT pg_get_constraintdef(oid) INTO v_def_esperada
    FROM pg_constraint WHERE conname = '_check_esperada';
  DROP TABLE _def_esperada;

  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';
  IF v_def IS DISTINCT FROM v_def_esperada THEN
    RAISE EXCEPTION 'limpio-1: la definición cambió y no debía — real: %', v_def; END IF;
  IF v_convalidated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'limpio-2: el NOT VALID sobrevivió — la reparación debía validar el histórico'; END IF;

  -- La fila legacy anterior al constraint quedó convertida (era el hueco que
  -- el NOT VALID perpetuaba) y el hito de cierre intacto. Exigía comentario y
  -- no lo traía: la conversión atravesó trg_exigir_evidencia por su excepción
  -- documentada, con el motivo estampado (la otra rama — foto — la ejercita
  -- el escenario de producción).
  SELECT estado INTO v_estado FROM public.tareas_bloque
   WHERE id = 'a1000000-0000-0000-0000-000000000002';
  IF v_estado <> 'completada' THEN
    RAISE EXCEPTION 'limpio-3: la fila legacy quedó en % (esperado completada)', v_estado; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE id = 'a1000000-0000-0000-0000-000000000002'
     AND motivo_sin_evidencia LIKE 'Cierre legacy%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'limpio-3b: la legacy sin comentario debía quedar con motivo_sin_evidencia estampado'; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE estado NOT IN ('pendiente', 'completada', 'con_observacion', 'omitida');
  IF n <> 0 THEN
    RAISE EXCEPTION 'limpio-4: quedaron % fila(s) fuera del dominio', n; END IF;

  -- Dominio operativo: los canónicos entran, el legacy no.
  UPDATE public.tareas_bloque SET estado = 'con_observacion'
   WHERE id = 'a1000000-0000-0000-0000-000000000001';
  UPDATE public.tareas_bloque SET estado = 'pendiente'
   WHERE id = 'a1000000-0000-0000-0000-000000000001';
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'en_curso'
     WHERE id = 'a1000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'limpio-5: ''en_curso'' entró con el constraint ya validado';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'OK   sobre el esquema declarado la reparación solo convierte y valida: convalidated=true';
END;
$$;
