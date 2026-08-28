\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260907000300 (materializar rutinas), verificadas EJECUTANDO
-- la RPC contra Postgres. Una RPC de 80 líneas con cinco JOINs, una ventana y
-- cuatro conteos no se valida leyéndola.

-- ════════════════════════════════════════════════════════════════════════════
-- A · LA MATERIALIZACIÓN
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  P1  uuid := '11111111-0000-0000-0000-000000000001';
  B1  uuid := '70000000-0000-0000-0000-000000000001';
  r   record;
  n   bigint;
  t   record;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  SELECT * INTO r FROM public.materializar_rutinas_turno(P1, '2026-09-01', '2026-09-30');

  -- Un solo bloque elegible (…001) × dos actividades ACTIVAS = 2 tareas. La
  -- tercera actividad está dada de baja y no cuenta.
  IF r.generadas <> 2 THEN
    RAISE EXCEPTION '1a: generó % tareas (esperadas 2)', r.generadas; END IF;

  -- La rutina sin jornada se reporta para que la UI pueda decirlo.
  IF r.rutinas_sin_jornada <> 1 THEN
    RAISE EXCEPTION '1b: reportó % rutinas sin jornada (esperada 1)', r.rutinas_sin_jornada; END IF;

  -- Los bloques terminados (completado …002 y cerrado …005) se omiten, con sus
  -- dos actividades cada uno.
  IF r.omitidas_bloque_cerrado <> 4 THEN
    RAISE EXCEPTION '1c: omitió % por bloque cerrado (esperadas 4)', r.omitidas_bloque_cerrado; END IF;

  -- Nada preexistía.
  IF r.omitidas_existente <> 0 THEN
    RAISE EXCEPTION '1d: reportó % existentes en la primera corrida', r.omitidas_existente; END IF;

  -- El bloque abierto quedó con la tarea manual + las dos generadas.
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = B1;
  IF n <> 3 THEN
    RAISE EXCEPTION '1e: el bloque quedó con % tareas (esperadas 3)', n; END IF;

  -- El bloque SIN jornada no recibió nada: no empareja con ninguna rutina.
  SELECT count(*) INTO n FROM public.tareas_bloque
  WHERE bloque_id = '70000000-0000-0000-0000-000000000004';
  IF n <> 0 THEN
    RAISE EXCEPTION '1f: el bloque sin jornada recibió % tareas', n; END IF;

  -- El de fuera de rango tampoco.
  SELECT count(*) INTO n FROM public.tareas_bloque
  WHERE bloque_id = '70000000-0000-0000-0000-000000000003';
  IF n <> 0 THEN
    RAISE EXCEPTION '1g: el bloque fuera de rango recibió % tareas', n; END IF;

  RAISE NOTICE 'OK 1  la rutina cae en el bloque de su jornada, y sólo en ése';
END;
$$;

DO $$
DECLARE
  B1 uuid := '70000000-0000-0000-0000-000000000001';
  t  record;
BEGIN
  -- 2 · La tarea COPIA lo que la actividad declaraba. Si esto fuese un JOIN,
  -- editar el catálogo reescribiría el pasado.
  SELECT * INTO t FROM public.tareas_bloque
  WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000001';

  IF t.duracion_estimada_min <> 20 THEN
    RAISE EXCEPTION '2a: la duración no se copió (quedó %)', t.duracion_estimada_min; END IF;
  IF t.checklist <> '["Quitar hojas", "Enjuagar"]'::jsonb THEN
    RAISE EXCEPTION '2b: el checklist no se copió (quedó %)', t.checklist; END IF;
  IF t.instrucciones_seguridad IS DISTINCT FROM 'Usar guantes' THEN
    RAISE EXCEPTION '2c: las instrucciones no se copiaron'; END IF;
  IF NOT t.requiere_comentario OR NOT t.requiere_checklist OR NOT t.requiere_foto THEN
    RAISE EXCEPTION '2d: las banderas de evidencia no se copiaron'; END IF;
  IF t.rutina_id IS DISTINCT FROM '4a000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION '2e: la tarea no recuerda de qué rutina salió'; END IF;
  IF t.estado <> 'pendiente' THEN
    RAISE EXCEPTION '2f: la tarea nació en estado %', t.estado; END IF;

  -- Editar el catálogo DESPUÉS no toca la tarea ya generada: eso es el snapshot.
  UPDATE public.plantillas_tarea_cargo
     SET duracion_estimada_min = 999, checklist = '["otra cosa"]'::jsonb
   WHERE id = 'd0000000-0000-0000-0000-000000000001';

  SELECT * INTO t FROM public.tareas_bloque
  WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000001';
  IF t.duracion_estimada_min <> 20 OR t.checklist <> '["Quitar hojas", "Enjuagar"]'::jsonb THEN
    RAISE EXCEPTION '2g: editar el catálogo reescribió una tarea ya generada'; END IF;

  -- Se restaura para no ensuciar los asserts siguientes.
  UPDATE public.plantillas_tarea_cargo
     SET duracion_estimada_min = 20, checklist = '["Quitar hojas", "Enjuagar"]'::jsonb
   WHERE id = 'd0000000-0000-0000-0000-000000000001';

  RAISE NOTICE 'OK 2  la tarea guarda lo que se le pidió; editar el catálogo no reescribe el pasado';
END;
$$;

DO $$
DECLARE
  B1 uuid := '70000000-0000-0000-0000-000000000001';
  v_area uuid;
  o1 int; o2 int;
BEGIN
  -- 3 · El paso sin área propia hereda la de la rutina; el orden entra DETRÁS
  -- de lo que ya había y es denso pese al hueco del `orden` de la receta.
  SELECT area_id INTO v_area FROM public.tareas_bloque
  WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000002';
  IF v_area IS DISTINCT FROM 'e0000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION '3a: el paso sin área no heredó la de la rutina (quedó %)', v_area; END IF;

  SELECT orden INTO o1 FROM public.tareas_bloque
  WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000001';
  SELECT orden INTO o2 FROM public.tareas_bloque
  WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000002';

  -- La manual tenía orden 7: las nuevas van 8 y 9, consecutivas.
  IF o1 <> 8 OR o2 <> 9 THEN
    RAISE EXCEPTION '3b: el orden quedó %/% (esperados 8/9, detrás de la manual)', o1, o2; END IF;

  -- Y la manual no se movió.
  IF (SELECT orden FROM public.tareas_bloque
      WHERE id = '80000000-0000-0000-0000-000000000001') <> 7 THEN
    RAISE EXCEPTION '3c: materializar reordenó la tarea puesta a mano'; END IF;

  RAISE NOTICE 'OK 3  hereda el área de la rutina y entra detrás sin reordenar lo manual';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · IDEMPOTENCIA Y RESPETO POR LAS DECISIONES
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  B1 uuid := '70000000-0000-0000-0000-000000000001';
  r  record;
  n  bigint;
BEGIN
  -- `set_config(…, true)` es local a la transacción, y en psql cada bloque DO es
  -- la suya: la identidad se vuelve a declarar en cada uno que invoque la RPC.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  -- 4 · La segunda corrida no duplica nada.
  SELECT * INTO r FROM public.materializar_rutinas_turno(P1, '2026-09-01', '2026-09-30');

  IF r.generadas <> 0 THEN
    RAISE EXCEPTION '4a: la segunda corrida generó % tareas', r.generadas; END IF;
  IF r.omitidas_existente <> 2 THEN
    RAISE EXCEPTION '4b: reportó % existentes (esperadas 2)', r.omitidas_existente; END IF;

  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = B1;
  IF n <> 3 THEN
    RAISE EXCEPTION '4c: tras re-correr el bloque tiene % tareas (esperadas 3)', n; END IF;

  RAISE NOTICE 'OK 4  volver a materializar no duplica';
END;
$$;

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  B1 uuid := '70000000-0000-0000-0000-000000000001';
  r  record;
  v  timestamptz;
  n  int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  -- 5 · Una tarea ANULADA no resucita. Anular es una decisión; repetirla en
  -- cada corrida sería desautorizar a quien la tomó. Un `NOT EXISTS` que sólo
  -- mirara las vigentes se comería esto.
  UPDATE public.tareas_bloque
     SET anulada_en = now(), anulada_por = 'a0000000-0000-0000-0000-00000000000a',
         motivo_anulacion = 'no aplica en temporada baja'
   WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000002';

  SELECT * INTO r FROM public.materializar_rutinas_turno(P1, '2026-09-01', '2026-09-30');
  IF r.generadas <> 0 THEN
    RAISE EXCEPTION '5a: la materialización resucitó % tareas anuladas', r.generadas; END IF;

  SELECT anulada_en INTO v FROM public.tareas_bloque
  WHERE bloque_id = B1 AND plantilla_id = 'd0000000-0000-0000-0000-000000000002';
  IF v IS NULL THEN
    RAISE EXCEPTION '5b: la anulación se perdió al re-materializar'; END IF;

  -- 5c y 5d NO son adorno: `generadas = 0` sale igual aunque el EXISTS ignore
  -- las anuladas, porque `uq_tareas_bloque_plantilla` bloquea el INSERT y el
  -- ON CONFLICT se lo traga en silencio. Lo que SÍ cambia es el informe: la
  -- fila deja de contarse como existente y desaparece de todos los buckets —ni
  -- generada, ni omitida—, así que la UI dice que no pasó nada con ella. Sin
  -- estas dos comprobaciones, agregar `AND tb.anulada_en IS NULL` al EXISTS
  -- deja este sandbox entero en verde.
  IF r.omitidas_existente <> 2 THEN
    RAISE EXCEPTION '5c: reportó % existentes (esperadas 2): la anulada dejó de contarse',
      r.omitidas_existente; END IF;

  SELECT count(*) INTO n FROM public.tareas_bloque WHERE bloque_id = B1;
  IF n <> 3 THEN
    RAISE EXCEPTION '5d: el bloque quedó con % tareas (esperadas 3)', n; END IF;

  RAISE NOTICE 'OK 5  la tarea anulada no revive ni se cae del informe';
END;
$$;

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  B5 uuid := '70000000-0000-0000-0000-000000000005';
  n  bigint;
BEGIN
  -- 6 · Los bloques terminados siguen intactos tras tres corridas.
  SELECT count(*) INTO n FROM public.tareas_bloque
  WHERE bloque_id IN ('70000000-0000-0000-0000-000000000002', B5);
  IF n <> 0 THEN
    RAISE EXCEPTION '6a: un bloque terminado recibió % tareas', n; END IF;

  RAISE NOTICE 'OK 6  al turno terminado no se le agrega trabajo después';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · RANGO Y ARGUMENTOS
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  r  record;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  -- 7 · Rango invertido y rango absurdo: se rechazan con el código correcto.
  BEGIN
    PERFORM public.materializar_rutinas_turno(P1, '2026-09-30', '2026-09-01');
    RAISE EXCEPTION '7a: se aceptó un rango que termina antes de empezar';
  EXCEPTION WHEN invalid_datetime_format THEN NULL;
  END;

  BEGIN
    PERFORM public.materializar_rutinas_turno(P1, '2026-01-01', '2028-01-01');
    RAISE EXCEPTION '7b: se aceptó un rango de más de 400 días';
  EXCEPTION WHEN numeric_value_out_of_range THEN NULL;
  END;

  BEGIN
    PERFORM public.materializar_rutinas_turno(
      '00000000-0000-0000-0000-0000000000ff', '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '7c: se aceptó un proyecto inexistente';
  EXCEPTION WHEN undefined_object THEN NULL;
  END;

  RAISE NOTICE 'OK 7  rango invertido, rango absurdo y proyecto fantasma, rechazados';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · AUTORIZACIÓN (la RPC es SECURITY DEFINER: este control ES el control)
-- ════════════════════════════════════════════════════════════════════════════

SET ROLE authenticated;

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  r  record;
BEGIN
  -- 8 · Con el permiso de Limpieza funciona (aunque no genere nada nuevo).
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.materializar_rutinas_turno(P1, '2026-09-01', '2026-09-30');
  IF r.generadas IS NULL THEN
    RAISE EXCEPTION '8a: prog_limpieza no pudo ejecutar la RPC'; END IF;

  RAISE NOTICE 'OK 8  prog_limpieza materializa sin permisos del módulo Seguridad';
END;
$$;

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
BEGIN
  -- 9 · Sin permiso, no. Y la empresa vecina tampoco, aunque SÍ tenga permiso:
  -- el guard de scope corre antes que el de permiso.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  BEGIN
    PERFORM public.materializar_rutinas_turno(P1, '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '9a: un usuario sin permiso materializó';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000c', true);
  BEGIN
    PERFORM public.materializar_rutinas_turno(P1, '2026-09-01', '2026-09-30');
    RAISE EXCEPTION '9b: la empresa vecina materializó en un proyecto ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 9  sin permiso no; y la vecina, con permiso y todo, tampoco';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  -- 10 · anon no puede ni invocarla.
  IF has_function_privilege('anon',
       'public.materializar_rutinas_turno(uuid, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '10a: anon puede ejecutar la RPC'; END IF;
  IF NOT has_function_privilege('authenticated',
       'public.materializar_rutinas_turno(uuid, date, date)', 'EXECUTE') THEN
    RAISE EXCEPTION '10b: authenticated NO puede ejecutar la RPC'; END IF;

  -- Y la rutina que ya generó trabajo es historia: no se borra.
  BEGIN
    DELETE FROM public.rutinas_limpieza WHERE id = '4a000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '10c: se borró una rutina que ya generó tareas';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK 10 anon fuera; y la rutina que ya generó trabajo no se borra';
END;
$$;
