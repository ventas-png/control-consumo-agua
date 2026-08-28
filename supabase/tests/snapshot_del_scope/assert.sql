\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260907000800: el UUID deja de ser una credencial. Todo lo
-- ofensivo corre como Ana (autenticada, compañía A, bloque en el proyecto A1)
-- — el mismo perfil de la NEGATIVA.

DO $$
DECLARE
  BLOQUE  constant uuid := '70000000-0000-0000-0000-000000000001';
  P_A1    constant uuid := '80000000-0000-0000-0000-000000000001';
  P_A2    constant uuid := '80000000-0000-0000-0000-000000000012';
  P_B     constant uuid := '80000000-0000-0000-0000-000000000013';
  P_NADIE constant uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  AREA_A1 constant uuid := '60000000-0000-0000-0000-000000000001';
  AREA_A2 constant uuid := '60000000-0000-0000-0000-000000000012';
  AREA_B  constant uuid := '60000000-0000-0000-0000-000000000013';
  R_A1    constant uuid := '30000000-0000-0000-0000-000000000021';
  R_A2    constant uuid := '30000000-0000-0000-0000-000000000022';
  R_B     constant uuid := '30000000-0000-0000-0000-000000000023';
  T_OK    constant uuid := 'b2000000-0000-0000-0000-000000000001';
  T_ADHOC constant uuid := 'b2000000-0000-0000-0000-000000000002';
  T_RUT   constant uuid := 'b2000000-0000-0000-0000-000000000003';
  v_msg_b     text;
  v_msg_nadie text;
  t record;
BEGIN
  SET LOCAL ROLE scope_tester;
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);

  -- ── 1. Plantilla de OTRA COMPAÑÍA: rechazada, sin fila y sin fuga ────────
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo)
    VALUES (BLOQUE, P_B, 'Robo B');
    RAISE EXCEPTION '1a: la plantilla de otra compañía entró';
  EXCEPTION WHEN foreign_key_violation THEN
    v_msg_b := SQLERRM;
  END;
  IF v_msg_b NOT LIKE '%FUERA DE ALCANCE%' THEN
    RAISE EXCEPTION '1b: el rechazo vino de otro control, no del guard: %', v_msg_b; END IF;
  -- El mensaje jamás lleva datos de la fila ajena (título, pasos, nada).
  IF v_msg_b ILIKE '%SECRETO%' THEN
    RAISE EXCEPTION '1c: el mensaje de error filtra datos de la plantilla ajena: %', v_msg_b; END IF;
  RAISE NOTICE 'OK 1  la plantilla de otra compañía se rechaza sin filtrar nada de ella';

  -- ── 2. MISMA compañía, OTRO proyecto: igual de rechazada ─────────────────
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo)
    VALUES (BLOQUE, P_A2, 'Robo A2');
    RAISE EXCEPTION '2: la plantilla de otro proyecto de la misma compañía entró';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  RAISE NOTICE 'OK 2  el scope es compañía Y proyecto: el proyecto vecino tampoco entra';

  -- ── 3. Sin oráculo de existencia: «ajena» e «inexistente» responden igual ─
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo)
    VALUES (BLOQUE, P_NADIE, 'Sonda');
    RAISE EXCEPTION '3a: un UUID inexistente entró';
  EXCEPTION WHEN foreign_key_violation THEN
    v_msg_nadie := SQLERRM;
  END;
  IF replace(v_msg_b, P_B::text, '?') IS DISTINCT FROM replace(v_msg_nadie, P_NADIE::text, '?') THEN
    RAISE EXCEPTION '3b: los mensajes distinguen «ajena» de «inexistente» — oráculo de existencia: [%] vs [%]',
      v_msg_b, v_msg_nadie; END IF;
  RAISE NOTICE 'OK 3  el error no revela si el UUID existe en otro tenant';

  -- ── 4. La plantilla del scope correcto entra CON su snapshot ─────────────
  INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo, area_id)
  VALUES (T_OK, BLOQUE, P_A1, 'Limpiar la piscina', AREA_A1);
  SELECT * INTO t FROM public.tareas_bloque WHERE id = T_OK;
  IF t.instrucciones_seguridad IS DISTINCT FROM 'Usar guantes y gafas; no mezclar productos'
     OR jsonb_array_length(t.checklist) <> 3
     OR t.duracion_estimada_min IS DISTINCT FROM 25
     OR NOT (t.requiere_foto AND t.requiere_comentario AND t.requiere_checklist) THEN
    RAISE EXCEPTION '4: la plantilla legítima perdió su snapshot (instr=%, pasos=%)',
      t.instrucciones_seguridad, jsonb_array_length(t.checklist); END IF;
  RAISE NOTICE 'OK 4  la plantilla del scope conserva su comportamiento: snapshot completo';

  -- ── 5. La tarea ad-hoc (plantilla_id NULL) sigue entrando, sin snapshot ──
  INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo)
  VALUES (T_ADHOC, BLOQUE, NULL, 'Fuga vista de paso');
  SELECT * INTO t FROM public.tareas_bloque WHERE id = T_ADHOC;
  IF t.instrucciones_seguridad IS NOT NULL
     OR jsonb_array_length(t.checklist) <> 0
     OR t.requiere_foto OR t.requiere_comentario OR t.requiere_checklist THEN
    RAISE EXCEPTION '5: la ad-hoc recibió snapshot de algún lado'; END IF;
  RAISE NOTICE 'OK 5  la ad-hoc entra limpia: sin plantilla no hay receta ni error';

  -- ── 6. area_id: la FK simple ya no permite cruzar tenant ni proyecto ─────
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, area_id)
    VALUES (BLOQUE, 'Área ajena', AREA_B);
    RAISE EXCEPTION '6a: el área de otra compañía entró';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, area_id)
    VALUES (BLOQUE, 'Área del proyecto vecino', AREA_A2);
    RAISE EXCEPTION '6b: el área de otro proyecto entró';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  -- La propia ya entró en el invariante 4 (T_OK lleva AREA_A1).
  RAISE NOTICE 'OK 6  area_id queda dentro del scope del bloque';

  -- ── 7. rutina_id: lo mismo ───────────────────────────────────────────────
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, rutina_id)
    VALUES (BLOQUE, 'Rutina ajena', R_B);
    RAISE EXCEPTION '7a: la rutina de otra compañía entró';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, rutina_id)
    VALUES (BLOQUE, 'Rutina del proyecto vecino', R_A2);
    RAISE EXCEPTION '7b: la rutina de otro proyecto entró';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  INSERT INTO public.tareas_bloque (id, bloque_id, titulo, rutina_id)
  VALUES (T_RUT, BLOQUE, 'De la rutina propia', R_A1);
  RAISE NOTICE 'OK 7  rutina_id queda dentro del scope; la propia entra';

  -- ── 8. El UPDATE es la misma puerta, no la de atrás ──────────────────────
  BEGIN
    UPDATE public.tareas_bloque SET plantilla_id = P_B WHERE id = T_ADHOC;
    RAISE EXCEPTION '8a: editar la tarea coló la plantilla ajena';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET area_id = AREA_A2 WHERE id = T_OK;
    RAISE EXCEPTION '8b: editar la tarea coló el área del proyecto vecino';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET rutina_id = R_B WHERE id = T_RUT;
    RAISE EXCEPTION '8c: editar la tarea coló la rutina ajena';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  -- Editar SIN tocar referencias no paga validación ni se bloquea.
  UPDATE public.tareas_bloque SET notas_operativo = 'sin tocar referencias'
   WHERE id = T_OK;
  -- Y quitar una referencia (NULL) es legítimo.
  UPDATE public.tareas_bloque SET area_id = NULL WHERE id = T_ADHOC;
  RAISE NOTICE 'OK 8  el UPDATE valida igual que el INSERT, y editar sin tocar referencias fluye';

  -- ── 9. Tras cada intento fallido, la fila legítima sigue intacta ─────────
  SELECT * INTO t FROM public.tareas_bloque WHERE id = T_OK;
  IF t.plantilla_id IS DISTINCT FROM P_A1
     OR t.instrucciones_seguridad IS DISTINCT FROM 'Usar guantes y gafas; no mezclar productos'
     OR t.checklist::text ILIKE '%SECRETO%' THEN
    RAISE EXCEPTION '9: un intento fallido dejó rastro en la fila legítima'; END IF;
  RAISE NOTICE 'OK 9  los rechazos no dejan rastro en las filas legítimas';

  RAISE NOTICE '── 9 invariantes del scope OK (como usuaria autenticada de la compañía A) ──';
END;
$$;

-- ── 10 · La materialización (la tercera ruta) sigue funcionando con el guard ─
DO $$
DECLARE
  t record;
  n bigint;
BEGIN
  -- Como Carla (prog_limpieza), igual que en snapshot_al_crear: la RPC es
  -- SECURITY DEFINER y sus referencias vienen de JOINs del propio scope — el
  -- guard tiene que dejarla pasar sin cambiarle el resultado.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000c', true);
  PERFORM public.materializar_rutinas_turno(
    '11111111-0000-0000-0000-000000000001', '2026-09-21', '2026-09-21');

  SELECT * INTO t FROM public.tareas_bloque
   WHERE bloque_id = '70000000-0000-0000-0000-000000000031';
  IF t.id IS NULL THEN
    RAISE EXCEPTION '10a: la materialización no generó la tarea con el guard instalado'; END IF;
  IF t.plantilla_id IS DISTINCT FROM '80000000-0000-0000-0000-000000000001'
     OR t.rutina_id IS DISTINCT FROM '30000000-0000-0000-0000-000000000021'
     OR jsonb_array_length(t.checklist) <> 3
     OR NOT (t.requiere_foto AND t.requiere_comentario AND t.requiere_checklist) THEN
    RAISE EXCEPTION '10b: el guard le cambió el resultado a la materialización'; END IF;
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE bloque_id = '70000000-0000-0000-0000-000000000031';
  IF n <> 1 THEN
    RAISE EXCEPTION '10c: la materialización generó % tareas (esperada 1)', n; END IF;

  RAISE NOTICE 'OK 10 la RPC de materialización pasa el guard con sus referencias del scope';
END;
$$;

-- ── El barrido definitivo, como superusuario y sin RLS ──────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  -- Ninguna fila de tareas referencia NADA de otro scope…
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE plantilla_id IN ('80000000-0000-0000-0000-000000000012',
                          '80000000-0000-0000-0000-000000000013')
      OR area_id      IN ('60000000-0000-0000-0000-000000000012',
                          '60000000-0000-0000-0000-000000000013')
      OR rutina_id    IN ('30000000-0000-0000-0000-000000000022',
                          '30000000-0000-0000-0000-000000000023');
  IF n <> 0 THEN
    RAISE EXCEPTION 'barrido-1: % fila(s) referencian catálogos de otro scope', n; END IF;

  -- …y ninguna columna del snapshot ajeno quedó copiada en ninguna parte.
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE instrucciones_seguridad ILIKE '%SECRETO%'
      OR checklist::text         ILIKE '%SECRETO%'
      OR titulo                  ILIKE '%SECRETO%';
  IF n <> 0 THEN
    RAISE EXCEPTION 'barrido-2: % fila(s) conservan columnas del snapshot ajeno', n; END IF;

  -- El guard corre ANTES que la copia (orden alfabético del mismo evento).
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgrelid = 'public.tareas_bloque'::regclass AND NOT tgisinternal
     AND tgname IN ('trg_referencias_del_scope', 'trg_tarea_copiar_snapshot');
  IF n <> 2 THEN
    RAISE EXCEPTION 'barrido-3: faltan triggers (hay % de 2)', n; END IF;
  IF 'trg_referencias_del_scope' >= 'trg_tarea_copiar_snapshot' THEN
    RAISE EXCEPTION 'barrido-4: el guard ya no ordena antes que la copia'; END IF;

  RAISE NOTICE 'OK barrido  sin RLS de por medio: cero referencias y cero columnas ajenas en toda la tabla';
END;
$$;
