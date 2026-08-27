\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260906000200
-- ════════════════════════════════════════════════════════════════════════════
-- Todas CONDUCTUALES salvo la 1: la pregunta no es si las columnas están, sino
-- si el sellado vuelve a ocurrir y si la RPC vuelve a poder ejecutarse. Es
-- exactamente lo que ninguna guarda de esquema podía contestar.

DO $$
DECLARE v_def text;
BEGIN
  -- 1 · La estructura quedó igual en los dos mundos: la columna existe y el
  -- trigger nombra el hito que existe. Con los argumentos viejos el helper no
  -- falla, lee una clave inexistente y devuelve NULL — de ahí el fallo mudo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.tareas_bloque'::regclass
       AND attname = 'completado_por' AND attnum > 0 AND NOT attisdropped
  ) THEN RAISE EXCEPTION '1a: falta tareas_bloque.completado_por'; END IF;

  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.tareas_bloque'::regclass
     AND t.tgname = 'trg_sellar_cierre' AND NOT t.tgisinternal;

  IF v_def IS NULL THEN
    RAISE EXCEPTION '1b: trg_sellar_cierre no está sobre tareas_bloque'; END IF;
  IF position('''completada_en''' in v_def) = 0 THEN
    RAISE EXCEPTION '1c: el trigger no sella por completada_en: %', v_def; END IF;
  IF position('''completado_en''' in v_def) > 0 THEN
    RAISE EXCEPTION '1d: el trigger sigue nombrando el hito viejo: %', v_def; END IF;

  RAISE NOTICE 'OK 1  completado_por existe y el trigger sella por completada_en';
END;
$$;

-- ── Completar una tarea, como lo hace la app ────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000010', false);  -- Hugo
UPDATE public.tareas_bloque
   SET completada_en = TIMESTAMPTZ '2026-08-15 12:00Z', estado = 'completada'
 WHERE id = 'e3000000-0000-0000-0000-000000000002';

DO $$
DECLARE v_sello uuid;
BEGIN
  -- 2 · El gesto que dejó de funcionar el 2026-08-27: quién dio la tarea por
  -- hecha lo pone la BD, no la UI.
  SELECT completado_por INTO v_sello
    FROM public.tareas_bloque WHERE id = 'e3000000-0000-0000-0000-000000000002';
  IF v_sello IS NULL THEN
    RAISE EXCEPTION '2: completar la tarea NO selló completado_por (el fallo mudo)'; END IF;
  IF v_sello <> 'e0000000-0000-0000-0000-000000000010' THEN
    RAISE EXCEPTION '2: selló a % en vez de a quien completó', v_sello; END IF;

  RAISE NOTICE 'OK 2  completar una tarea vuelve a sellar quién la completó';
END;
$$;

-- ── Otra persona toca la misma tarea, ya completada ─────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', false);  -- Elio
UPDATE public.tareas_bloque
   SET notas_operativo = 'revisado'
 WHERE id = 'e3000000-0000-0000-0000-000000000002';

DO $$
DECLARE v_sello uuid;
BEGIN
  -- 3 · El sello es del cierre, no de la última edición. `sellar_cierre` sólo
  -- actúa en la transición nulo → no nulo del hito.
  SELECT completado_por INTO v_sello
    FROM public.tareas_bloque WHERE id = 'e3000000-0000-0000-0000-000000000002';
  IF v_sello <> 'e0000000-0000-0000-0000-000000000010' THEN
    RAISE EXCEPTION '3: editar una tarea ya completada re-selló el autor (ahora %)', v_sello; END IF;

  RAISE NOTICE 'OK 3  editar después no re-sella: el autor es el del cierre';
END;
$$;

-- ── La RPC, ejecutada de verdad ─────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', false);  -- Ana, admin

DO $$
DECLARE
  v_lim  bigint;
  v_nom  text;
  v_filas int;
BEGIN
  -- 4 · Es la invariante por la que existe este sandbox: si el cuerpo de la
  -- función menciona una columna que no está, esto revienta con 42703 aquí
  -- mismo. Ninguna comprobación estática lo habría visto.
  SELECT count(*) INTO v_filas
    FROM public.actividad_equipo('11111111-0000-0000-0000-000000000001',
                                 DATE '2026-08-01', DATE '2026-08-31');
  IF v_filas = 0 THEN
    RAISE EXCEPTION '4: actividad_equipo no devolvió ninguna fila'; END IF;

  SELECT a.limpiezas, a.usuario_nombre INTO v_lim, v_nom
    FROM public.actividad_equipo('11111111-0000-0000-0000-000000000001',
                                 DATE '2026-08-01', DATE '2026-08-31') a
   WHERE a.usuario_id = 'e0000000-0000-0000-0000-000000000010';

  IF v_lim IS NULL THEN
    RAISE EXCEPTION '4: quien completó la tarea no aparece en actividad_equipo'; END IF;
  IF v_lim <> 1 THEN
    RAISE EXCEPTION '4: se esperaba 1 limpieza para %, se contaron %', v_nom, v_lim; END IF;

  RAISE NOTICE 'OK 4  actividad_equipo se ejecuta y cuenta la tarea de turno';
END;
$$;

DO $$
DECLARE v_otros bigint;
BEGIN
  -- 5 · El conteo sale del SELLO, no de la fecha suelta. La tarea e3…01 tiene
  -- `completada_en` dentro de la ventana y `completado_por` nulo — es una fila
  -- histórica, de antes de que el trigger existiera, y no debe contarse.
  SELECT COALESCE(sum(a.limpiezas), 0) INTO v_otros
    FROM public.actividad_equipo('11111111-0000-0000-0000-000000000001',
                                 DATE '2026-08-01', DATE '2026-08-31') a;
  IF v_otros <> 1 THEN
    RAISE EXCEPTION '5: se contaron % limpiezas; la tarea sin sello no debía sumar', v_otros; END IF;

  RAISE NOTICE 'OK 5  la tarea completada sin sello no infla el conteo';
END;
$$;

DO $$
DECLARE v_anon boolean; v_auth boolean;
BEGIN
  -- 6 · Re-declarar una función reinicia sus permisos. Si la migración se
  -- olvidara del REVOKE/GRANT, `anon` estrenaría acceso a la actividad del
  -- personal de toda la empresa.
  v_anon := has_function_privilege('anon',
    'public.actividad_equipo(uuid, date, date)', 'EXECUTE');
  v_auth := has_function_privilege('authenticated',
    'public.actividad_equipo(uuid, date, date)', 'EXECUTE');

  IF v_anon THEN RAISE EXCEPTION '6: anon puede ejecutar actividad_equipo'; END IF;
  IF NOT v_auth THEN RAISE EXCEPTION '6: authenticated perdió el EXECUTE'; END IF;

  RAISE NOTICE 'OK 6  anon sigue sin poder ejecutarla; authenticated sí';
END;
$$;
