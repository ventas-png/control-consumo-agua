\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260905000600 (snapshot al crear la tarea), verificadas
-- EJECUTANDO los INSERT contra Postgres. Lo que importa aquí sólo se ve
-- corriendo: que la tarea manual llegue armada, que el trigger no pueda AFLOJAR
-- una exigencia, y —el que cierra el círculo— que después de la copia el gate de
-- evidencia SÍ muerda donde hoy no muerde.

-- ════════════════════════════════════════════════════════════════════════════
-- A · LA COPIA
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t record;
BEGIN
  -- 1 · La ruta manual llega COMPLETA. Es el agujero entero de este PR: hoy
  -- estas cinco columnas se pierden y la tarea queda indistinguible de una
  -- materializada, pero sin instrucciones y sin exigencias.
  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'b1000000-0000-0000-0000-000000000001';

  IF t.instrucciones_seguridad IS DISTINCT FROM 'Usar guantes y gafas; no mezclar productos' THEN
    RAISE EXCEPTION '1a: se perdieron las instrucciones de seguridad (%)', t.instrucciones_seguridad; END IF;
  IF jsonb_array_length(t.checklist) <> 3 THEN
    RAISE EXCEPTION '1b: el checklist llegó con % pasos, se esperaban 3', jsonb_array_length(t.checklist); END IF;
  IF t.duracion_estimada_min IS DISTINCT FROM 25 THEN
    RAISE EXCEPTION '1c: la duración estimada llegó como %', t.duracion_estimada_min; END IF;
  IF NOT (t.requiere_foto AND t.requiere_comentario AND t.requiere_checklist) THEN
    RAISE EXCEPTION '1d: las exigencias no subieron (foto=%, com=%, chk=%)',
      t.requiere_foto, t.requiere_comentario, t.requiere_checklist; END IF;

  RAISE NOTICE 'OK 1  la tarea manual llega con checklist, instrucciones y exigencias';
END;
$$;

DO $$
DECLARE t record;
BEGIN
  -- 2 · Lo que el llamador YA trajo no se pisa. Un COALESCE al revés —o una
  -- asignación directa— borraría los pasos que alguien puso a propósito.
  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'b1000000-0000-0000-0000-000000000002';

  IF jsonb_array_length(t.checklist) <> 1
     OR (t.checklist -> 0) <> '"Sólo revisar el filtro"'::jsonb THEN
    RAISE EXCEPTION '2: el checklist propio se pisó con el de la plantilla (%)', t.checklist; END IF;

  -- Y lo que NO trajo sí se completa: llenar un hueco y pisar un valor son
  -- cosas distintas.
  IF t.instrucciones_seguridad IS NULL THEN
    RAISE EXCEPTION '2b: no se completaron las instrucciones que faltaban'; END IF;

  RAISE NOTICE 'OK 2  el checklist propio manda, y lo que falta igual se completa';
END;
$$;

DO $$
DECLARE t record;
BEGIN
  -- 3 · Sin plantilla no hay receta, y el alta no falla. Una tarea suelta
  -- («vi una fuga de paso») tiene que poder crearse.
  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'b1000000-0000-0000-0000-000000000003';

  IF t.id IS NULL THEN
    RAISE EXCEPTION '3a: la tarea ad-hoc no se creó'; END IF;
  IF jsonb_array_length(t.checklist) <> 0 OR t.instrucciones_seguridad IS NOT NULL THEN
    RAISE EXCEPTION '3b: una tarea sin plantilla recibió snapshot de algún lado'; END IF;
  IF t.requiere_foto OR t.requiere_comentario OR t.requiere_checklist THEN
    RAISE EXCEPTION '3c: una tarea sin plantilla ganó exigencias de la nada'; END IF;

  RAISE NOTICE 'OK 3  la tarea ad-hoc se crea y no recibe snapshot';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · SÓLO APRIETA
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t record;
BEGIN
  -- 4 · El trigger NO puede bajar una exigencia. La tarea pidió foto y
  -- comentario; la plantilla P2 no pide nada. Si esto se convierte en una
  -- asignación en vez de un OR, las dos se caen a false y el gate de evidencia
  -- deja de exigir lo que alguien puso a mano.
  SELECT * INTO t FROM public.tareas_bloque
   WHERE id = 'b1000000-0000-0000-0000-000000000004';

  IF NOT t.requiere_foto THEN
    RAISE EXCEPTION '4a: el trigger aflojó requiere_foto'; END IF;
  IF NOT t.requiere_comentario THEN
    RAISE EXCEPTION '4b: el trigger aflojó requiere_comentario'; END IF;

  -- Y no inventa lo que la plantilla no pide.
  IF t.requiere_checklist THEN
    RAISE EXCEPTION '4c: el trigger inventó una exigencia de checklist'; END IF;

  RAISE NOTICE 'OK 4  el trigger sube exigencias y nunca las baja';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · LO QUE NO DEBE CAMBIAR
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t record; v_n int;
BEGIN
  -- 5 · La materialización da EXACTAMENTE lo mismo que antes. Esa RPC ya escribe
  -- el snapshot, así que los COALESCE deben ser no-ops y los OR deben operar
  -- sobre valores iguales. Si este trigger le cambiara el resultado, sería un
  -- cambio de conducta encubierto en el camino por el que entran casi todas las
  -- tareas.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000c', true);
  PERFORM public.materializar_rutinas_turno(
    '11111111-0000-0000-0000-000000000001', '2026-09-20', '2026-09-20');

  SELECT * INTO t FROM public.tareas_bloque
   WHERE bloque_id = '70000000-0000-0000-0000-000000000003';
  IF t.id IS NULL THEN
    RAISE EXCEPTION '5a: la materialización no generó la tarea'; END IF;

  IF jsonb_array_length(t.checklist) <> 3
     OR t.duracion_estimada_min <> 25
     OR t.instrucciones_seguridad IS NULL
     OR NOT (t.requiere_foto AND t.requiere_comentario AND t.requiere_checklist) THEN
    RAISE EXCEPTION '5b: el trigger le cambió el resultado a la materialización'; END IF;

  -- Y no duplicó filas por correr en cada INSERT.
  SELECT count(*) INTO v_n FROM public.tareas_bloque
   WHERE bloque_id = '70000000-0000-0000-0000-000000000003';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '5c: la materialización generó % tareas', v_n; END IF;

  RAISE NOTICE 'OK 5  materializar sigue dando el mismo resultado';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · EL CÍRCULO SE CIERRA
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 6 · Con el checklist copiado, el gate de evidencia (20260905000400) SÍ
  -- muerde sobre la tarea manual. HOY, sin este trigger, esa misma tarea cierra
  -- sin nada — y ése es el daño real de perder el snapshot: no es que falte un
  -- dato bonito, es que el control se desarma solo.
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'completada',
           foto_urls = '["evidencia/1.jpg"]'::jsonb, evidencia_texto = 'listo'
     WHERE id = 'b1000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '6a: se cerró una tarea manual con el checklist sin marcar';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Y con todo aportado, cierra.
  UPDATE public.tareas_bloque SET estado = 'completada',
         foto_urls = '["evidencia/1.jpg"]'::jsonb, evidencia_texto = 'listo',
         checklist_completado = '[0,1,2]'::jsonb
   WHERE id = 'b1000000-0000-0000-0000-000000000001';

  IF (SELECT estado FROM public.tareas_bloque
       WHERE id = 'b1000000-0000-0000-0000-000000000001') <> 'completada' THEN
    RAISE EXCEPTION '6b: con la evidencia completa tampoco dejó cerrar'; END IF;

  RAISE NOTICE 'OK 6  tras la copia, el gate de evidencia exige de verdad';
END;
$$;

DO $$
DECLARE v_id uuid;
BEGIN
  -- 7 · El privilegio del trigger no es decorativo: `tareas_bloque_insert`
  -- acepta `turnos`, pero `plantillas_tarea_cargo_select` NO. Con INVOKER, quien
  -- sólo tiene `turnos` crearía la tarea y la copia fallaría en silencio.
  -- Se comprueba insertando COMO ese usuario y verificando que igual llega
  -- armada.
  INSERT INTO public.user_roles (user_id, role_id) VALUES
    ('a0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000d')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permissions (role_id, permission_key) VALUES
    ('d0000000-0000-0000-0000-00000000000d', 'condominios.tab.turnos')
  ON CONFLICT DO NOTHING;
  DELETE FROM public.role_permissions
   WHERE role_id = 'd0000000-0000-0000-0000-00000000000b';

  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  SET LOCAL ROLE authenticated;

  -- Bloque 0004, libre: los otros ya tienen P1 y `uq_tareas_bloque_plantilla`
  -- lo rechazaría antes de llegar al trigger.
  INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo, orden)
  VALUES ('70000000-0000-0000-0000-000000000004',
          '80000000-0000-0000-0000-000000000001', 'Alta con sólo turnos', 0)
  RETURNING id INTO v_id;

  RESET ROLE;

  IF (SELECT jsonb_array_length(checklist) FROM public.tareas_bloque WHERE id = v_id) <> 3 THEN
    RAISE EXCEPTION '7: con permiso de turnos la copia falló en silencio'; END IF;

  RAISE NOTICE 'OK 7  la copia funciona aunque el que inserta no vea el catálogo';
END;
$$;
