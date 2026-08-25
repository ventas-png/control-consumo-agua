\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: re-aplicar 20260905000600 no duplica el trigger, no
-- reescribe lo ya copiado y sigue sin poder aflojar.

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relname = 'tareas_bloque'
    AND t.tgname = 'trg_tarea_copiar_snapshot';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: quedaron % triggers de snapshot (esperado 1)', n; END IF;

  -- Lo ya copiado sigue igual: el trigger es BEFORE INSERT, así que re-aplicar
  -- la migración no puede tocar filas existentes.
  IF (SELECT jsonb_array_length(checklist) FROM public.tareas_bloque
       WHERE id = 'b1000000-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION 'idem-2: se pisó el checklist propio al re-aplicar'; END IF;

  IF (SELECT estado FROM public.tareas_bloque
       WHERE id = 'b1000000-0000-0000-0000-000000000001') <> 'completada' THEN
    RAISE EXCEPTION 'idem-3: la re-aplicación revirtió un cierre válido'; END IF;
END;
$$;

DO $$
DECLARE v_id uuid;
BEGIN
  -- Turnos limpios: `uq_tareas_bloque_plantilla` no deja repetir plantilla en un
  -- bloque, y los sembrados ya tienen las dos.
  INSERT INTO public.bloques_turno
    (id, company_id, project_id, personal_id, fecha, estado) VALUES
    ('70000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-000000000001',
     '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
     '2026-09-13', 'en_curso'),
    ('70000000-0000-0000-0000-00000000000f', 'c0000000-0000-0000-0000-000000000001',
     '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
     '2026-09-14', 'en_curso');

  -- Y sobre altas NUEVAS el control sigue funcionando en las dos direcciones:
  -- no afloja lo que el llamador pidió…
  INSERT INTO public.tareas_bloque
    (bloque_id, plantilla_id, titulo, requiere_comentario, orden)
  VALUES ('70000000-0000-0000-0000-00000000000e',
          '80000000-0000-0000-0000-000000000002', 'Post-reaplicación', true, 0)
  RETURNING id INTO v_id;

  IF NOT (SELECT requiere_comentario FROM public.tareas_bloque WHERE id = v_id) THEN
    RAISE EXCEPTION 'idem-4: tras re-aplicar, el trigger aflojó una exigencia'; END IF;

  -- …y sigue copiando lo que la plantilla sí declara.
  INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo, orden)
  VALUES ('70000000-0000-0000-0000-00000000000f',
          '80000000-0000-0000-0000-000000000001', 'Post-reaplicación 2', 0)
  RETURNING id INTO v_id;

  IF (SELECT jsonb_array_length(checklist) FROM public.tareas_bloque WHERE id = v_id) <> 3 THEN
    RAISE EXCEPTION 'idem-5: tras re-aplicar, dejó de copiar el checklist'; END IF;

  RAISE NOTICE 'OK   re-aplicar no duplica el trigger, conserva lo copiado y sigue apretando';
END;
$$;
