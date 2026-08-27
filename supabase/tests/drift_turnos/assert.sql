\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260906000000 sobre las tres tablas con la forma REAL de
-- producción. Se prueban los CUATRO GESTOS que hoy están rotos, no sólo la
-- presencia de las columnas: que exista `cerrado_en` no dice que cerrar un
-- bloque funcione.

DO $$
DECLARE
  CO_A     uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  P1       uuid := '11111111-0000-0000-0000-000000000001';
  USR      uuid := 'e0000000-0000-0000-0000-00000000000a';
  AMENIDAD uuid := 'e1000000-0000-0000-0000-000000000001';
  BLOQUE   uuid := 'e2000000-0000-0000-0000-000000000001';
  T_FOTO   uuid := 'e3000000-0000-0000-0000-000000000001';
  T_SINF   uuid := 'e3000000-0000-0000-0000-000000000002';
  PLANT    uuid := 'd0000000-0000-0000-0000-000000000001';
  v_json   jsonb;
  v_ts     timestamptz;
  v_int    int;
  v_txt    text;
  n        bigint;
BEGIN
  -- ══ A. Los nombres quedaron alineados, sin perder datos ═══════════════════

  -- ── 1. bloques_turno: finalizado_en → cerrado_en ─────────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.bloques_turno'::regclass
                    AND attname = 'cerrado_en' AND NOT attisdropped) THEN
    RAISE EXCEPTION '1a: bloques_turno.cerrado_en no existe'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.bloques_turno'::regclass
                AND attname = 'finalizado_en' AND NOT attisdropped) THEN
    RAISE EXCEPTION '1b: `finalizado_en` sigue ahí — se copió en vez de renombrar, y ahora hay dos columnas para lo mismo'; END IF;
  RAISE NOTICE 'OK 1  bloques_turno: finalizado_en renombrada a cerrado_en (no duplicada)';

  -- ── 2. tareas_bloque: completado_en → completada_en, con su dato ─────────
  SELECT completada_en INTO v_ts FROM public.tareas_bloque WHERE id = T_FOTO;
  IF v_ts IS DISTINCT FROM TIMESTAMPTZ '2026-08-01 10:00Z' THEN
    RAISE EXCEPTION '2a: el renombre perdió el valor de completado_en (quedó %)', v_ts; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.tareas_bloque'::regclass
                AND attname = 'completado_en' AND NOT attisdropped) THEN
    RAISE EXCEPTION '2b: `completado_en` sigue ahí'; END IF;
  RAISE NOTICE 'OK 2  tareas_bloque: completado_en renombrada a completada_en conservando el dato';

  -- ── 3. foto_url (text) → foto_urls (jsonb): la evidencia sobrevive ───────
  SELECT foto_urls INTO v_json FROM public.tareas_bloque WHERE id = T_FOTO;
  IF v_json IS DISTINCT FROM '["p1/turnos/foto1.jpg"]'::jsonb THEN
    RAISE EXCEPTION '3a: la foto no se envolvió en un array (quedó %)', v_json; END IF;

  SELECT foto_urls INTO v_json FROM public.tareas_bloque WHERE id = T_SINF;
  IF v_json IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION '3b: la tarea sin foto debía quedar en [] y quedó %', v_json; END IF;

  -- La vieja SE CONSERVA a propósito: borrar la única copia de la evidencia en
  -- la misma migración que la convierte no deja a dónde volver.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.tareas_bloque'::regclass
                    AND attname = 'foto_url' AND NOT attisdropped) THEN
    RAISE EXCEPTION '3c: `foto_url` se borró; debía conservarse hasta el cierre posfusión'; END IF;
  SELECT foto_url INTO v_txt FROM public.tareas_bloque WHERE id = T_FOTO;
  IF v_txt IS DISTINCT FROM 'p1/turnos/foto1.jpg' THEN
    RAISE EXCEPTION '3d: el respaldo en foto_url se alteró'; END IF;
  RAISE NOTICE 'OK 3  la evidencia pasó a jsonb (["…"] y []) y el respaldo foto_url sigue intacto';

  -- ══ B. Los cuatro gestos que hoy están rotos ══════════════════════════════

  -- ── 4. Cerrar un bloque de turno ─────────────────────────────────────────
  -- TareasPersonalTab.cerrarBloque(): hoy falla EN SILENCIO porque el código no
  -- mira el error que devuelve updateCondominioRow.
  UPDATE public.bloques_turno
     SET estado = 'completado', cerrado_en = now(), puntaje_completitud = 80
   WHERE id = BLOQUE;
  SELECT puntaje_completitud, cerrado_en INTO v_int, v_ts
    FROM public.bloques_turno WHERE id = BLOQUE;
  IF v_int <> 80 OR v_ts IS NULL THEN
    RAISE EXCEPTION '4: cerrar el bloque no persistió (puntaje=%, cerrado_en=%)', v_int, v_ts; END IF;
  RAISE NOTICE 'OK 4  cerrar un bloque de turno persiste (hoy falla en silencio)';

  -- ── 5. Agregar una tarea a un bloque ─────────────────────────────────────
  INSERT INTO public.tareas_bloque (bloque_id, titulo, plantilla_id, requiere_foto, orden)
  VALUES (BLOQUE, 'Barrer el lobby', PLANT, true, 9);
  SELECT count(*) INTO n FROM public.tareas_bloque
   WHERE bloque_id = BLOQUE AND plantilla_id = PLANT AND requiere_foto;
  IF n <> 1 THEN RAISE EXCEPTION '5: el alta desde plantilla no quedó'; END IF;
  RAISE NOTICE 'OK 5  agregar una tarea desde plantilla funciona (hoy da 400)';

  -- ── 6. Completar una tarea con observación ───────────────────────────────
  UPDATE public.tareas_bloque
     SET estado = 'con_observacion', completada_en = now(), notas_operativo = 'Faltó jabón'
   WHERE id = T_SINF;
  SELECT notas_operativo INTO v_txt FROM public.tareas_bloque WHERE id = T_SINF;
  IF v_txt IS DISTINCT FROM 'Faltó jabón' THEN
    RAISE EXCEPTION '6: la observación no persistió'; END IF;
  RAISE NOTICE 'OK 6  completar una tarea con observación persiste (hoy falla en silencio)';

  -- ── 7. Crear un bloqueo de amenidad ──────────────────────────────────────
  INSERT INTO public.amenidades_bloqueos
    (company_id, project_id, amenidad_id, fecha_inicio, fecha_fin, motivo, notas, created_by)
  VALUES (CO_A, P1, AMENIDAD, DATE '2026-09-01', DATE '2026-09-02',
          'mantenimiento', 'Pintura del salón', USR);
  SELECT count(*) INTO n FROM public.amenidades_bloqueos
   WHERE notas = 'Pintura del salón' AND created_by = USR;
  IF n <> 1 THEN RAISE EXCEPTION '7: el bloqueo de amenidad no quedó'; END IF;
  RAISE NOTICE 'OK 7  crear un bloqueo de amenidad funciona (hoy da 400 visible)';

  -- ── 8. La premisa de #785 pasa a ser cierta ──────────────────────────────
  -- #785 declara el par de sellado ('completada_en', 'completado_por') y llama
  -- typo a `completado_en`. Contra el esquema de producción ese trigger
  -- apuntaría a una columna inexistente. Tras esta migración, no.
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.tareas_bloque'::regclass
                    AND attname = 'completada_en' AND NOT attisdropped) THEN
    RAISE EXCEPTION '8: `completada_en` no existe — #785 seguiría construido sobre una premisa falsa'; END IF;
  RAISE NOTICE 'OK 8  completada_en existe: la premisa de #785 ya es cierta';
END;
$$;
