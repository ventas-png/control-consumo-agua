\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260907000700 sobre el escenario de PRODUCCIÓN: el homónimo
-- incompatible fue reemplazado, los legacy con equivalencia se convirtieron, y
-- el dominio canónico quedó validado.

DO $$
DECLARE
  T_PENDIENTE  uuid := 'a1000000-0000-0000-0000-000000000001';
  T_COMPLETADA uuid := 'a1000000-0000-0000-0000-000000000002';
  T_OMITIDA    uuid := 'a1000000-0000-0000-0000-000000000003';
  v_def_esperada text;
  v_def          text;
  v_convalidated boolean;
  v_estado       text;
  n              bigint;
BEGIN
  -- ── 1. El constraint es UNO, canónico y VALIDADO ─────────────────────────
  -- La definición esperada se calcula en este mismo servidor (tabla temporal
  -- con la misma columna), igual que hace la migración: comparar contra un
  -- string a mano acoplaría el assert a una versión de Postgres.
  CREATE TEMP TABLE _def_esperada (
    estado text,
    CONSTRAINT _check_esperada
      CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
  );
  SELECT pg_get_constraintdef(oid) INTO v_def_esperada
    FROM pg_constraint WHERE conname = '_check_esperada';
  DROP TABLE _def_esperada;

  SELECT count(*) INTO n
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';
  IF n <> 1 THEN
    RAISE EXCEPTION '1a: debía quedar exactamente UN tareas_bloque_estado_check y hay %', n; END IF;

  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';
  IF v_def IS DISTINCT FROM v_def_esperada THEN
    RAISE EXCEPTION '1b: la definición no es la canónica — real: % · esperada: %', v_def, v_def_esperada; END IF;
  IF v_convalidated IS DISTINCT FROM true THEN
    RAISE EXCEPTION '1c: el constraint quedó NOT VALID (convalidated=%): el histórico sigue sin garantía', v_convalidated; END IF;
  RAISE NOTICE 'OK 1  el homónimo fue reemplazado: definición canónica y convalidated=true';

  -- ── 2. La conversión explícita alcanzó todas las filas y solo a ellas ────
  SELECT estado INTO v_estado FROM public.tareas_bloque WHERE id = T_COMPLETADA;
  IF v_estado <> 'completada' THEN
    RAISE EXCEPTION '2a: completado→completada no se aplicó (quedó %)', v_estado; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE estado = 'completada' AND completada_en IS NOT NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION '2b: debían quedar 2 completadas con su hito intacto y hay %', n; END IF;
  SELECT estado INTO v_estado FROM public.tareas_bloque WHERE id = T_OMITIDA;
  IF v_estado <> 'omitida' THEN
    RAISE EXCEPTION '2c: omitido→omitida no se aplicó (quedó %)', v_estado; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE estado NOT IN ('pendiente', 'completada', 'con_observacion', 'omitida');
  IF n <> 0 THEN
    RAISE EXCEPTION '2d: quedaron % fila(s) fuera del dominio canónico', n; END IF;
  RAISE NOTICE 'OK 2  completado→completada y omitido→omitida, con el hito de cierre intacto';

  -- ── 3. La tarea pendiente puede pasar a CADA estado canónico ─────────────
  -- (y volver: el dominio completo se ejercita sobre la misma fila)
  UPDATE public.tareas_bloque SET estado = 'completada'      WHERE id = T_PENDIENTE;
  UPDATE public.tareas_bloque SET estado = 'pendiente'       WHERE id = T_PENDIENTE;
  UPDATE public.tareas_bloque SET estado = 'con_observacion' WHERE id = T_PENDIENTE;
  UPDATE public.tareas_bloque SET estado = 'pendiente'       WHERE id = T_PENDIENTE;
  UPDATE public.tareas_bloque SET estado = 'omitida'         WHERE id = T_PENDIENTE;
  UPDATE public.tareas_bloque SET estado = 'pendiente'       WHERE id = T_PENDIENTE;
  RAISE NOTICE 'OK 3  pendiente → completada / con_observacion / omitida: los cuatro valores canónicos entran';

  -- ── 4. Los legacy quedan RECHAZADOS después de la migración ──────────────
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completado' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION '4a: se aceptó el legacy ''completado''';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'omitido' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION '4b: se aceptó el legacy ''omitido''';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'en_curso' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION '4c: se aceptó el legacy ''en_curso''';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES ('b1000000-0000-0000-0000-000000000001', 'Alta legacy', 'completado');
    RAISE EXCEPTION '4d: un INSERT con ''completado'' entró';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 4  completado / omitido / en_curso rechazados con 23514, también en INSERT';

  RAISE NOTICE '── 4 invariantes del escenario de producción OK ──';
END;
$$;
