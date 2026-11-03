\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes con la policy VIGENTE: la de 20261104000700 (#991, «escribir
-- exige la ACCIÓN del tab, también en la base»). Esa migración re-declaró
-- tareas_bloque_insert cambiando SÓLO el permiso —crear pide
-- condominios_puede_actuar('tareas_personal', 'create'); ver un tab ya no
-- basta— y tenía que dejar intacto el contrato de 000900 + 001100. Aquí se
-- comprueban las dos cosas contra la policy tal como la declara el repo.
--
-- run.sh, antes de esto: aplica condominios_puede_actuar (20260916221839) y el
-- DROP + CREATE de tareas_bloque_insert extraídos de 20261104000700 (dos veces:
-- es idempotente), y da a Beto la acción `condominios.tab.tareas_personal.create`
-- además de la visibilidad que ya tenía.

-- ── A1 · Una sola policy de INSERT, y es la de la acción ─────────────────────
DO $$
DECLARE
  n    bigint;
  v_wc text;
BEGIN
  SELECT count(*) INTO n FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'tareas_bloque' AND pol.polcmd = 'a';
  IF n <> 1 THEN
    RAISE EXCEPTION 'A1: hay % policies de INSERT sobre tareas_bloque (esperada 1): una de más se uniría con OR', n; END IF;

  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_wc
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'tareas_bloque' AND pol.polname = 'tareas_bloque_insert';
  IF v_wc NOT LIKE '%condominios_puede_actuar(''tareas_personal''::text, ''create''::text)%' THEN
    RAISE EXCEPTION 'A1: la policy no exige la acción de crear: %', v_wc; END IF;
  IF v_wc LIKE '%user_has_permission%' THEN
    RAISE EXCEPTION 'A1: la policy conserva la visibilidad como permiso de escritura: %', v_wc; END IF;
  RAISE NOTICE 'OK A1 una sola policy de INSERT, con la acción de crear y sin la visibilidad como permiso';
END;
$$;

-- ── A2 · Con la acción: cerradas y sellos fuera, pendiente limpia entra ─────
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
  v_estado text;
  n bigint;
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);  -- Beto

  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES (BLOQUE, 'Cerrada con la acción', 'completada');
    RAISE EXCEPTION 'A2a: con la acción de crear, el INSERT directo en completada entró';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
    VALUES (BLOQUE, 'Omitida con la acción', 'omitida');
    RAISE EXCEPTION 'A2b: con la acción de crear, el INSERT directo en omitida entró';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, completada_en, completado_por)
    VALUES (BLOQUE, 'Pre-sellada con la acción', now(),
            'e0000000-0000-0000-0000-00000000000a');
    RAISE EXCEPTION 'A2c: con la acción de crear, entraron sellos de cierre pre-cargados';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo, motivo_sin_evidencia)
    VALUES (BLOQUE, 'Bypass pre-armado con la acción', 'para después');
    RAISE EXCEPTION 'A2d: con la acción de crear, entró el sello de excepción pre-cargado';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO n FROM public.tareas_bloque WHERE titulo LIKE '%con la acción';
  IF n <> 0 THEN
    RAISE EXCEPTION 'A2e: % fila(s) rechazadas quedaron insertadas', n; END IF;

  INSERT INTO public.tareas_bloque (id, bloque_id, titulo)
  VALUES ('e5000000-0000-0000-0000-0000000000c1', BLOQUE, 'Pendiente limpia (acción de crear)');
  SELECT estado INTO v_estado FROM public.tareas_bloque
   WHERE id = 'e5000000-0000-0000-0000-0000000000c1';
  IF v_estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'A2f: la pendiente limpia quedó en %', v_estado; END IF;

  RAISE NOTICE 'OK A2 con la acción de crear: cerradas y sellos rechazados (42501), pendiente limpia entra';
END;
$$;

-- ── A3 · Ver no basta: quien sólo ve un tab ya no crea, ni pendiente ───────
-- Tomás ve Turnos y Hugo ve Programación de limpieza: con 001100 creaban; con
-- la acción, no. Es el cambio que 20261104000700 vino a hacer.
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
  sololectores constant uuid[] := ARRAY[
    'e0000000-0000-0000-0000-00000000000f',   -- Tomás · ve turnos
    'e0000000-0000-0000-0000-00000000000d',   -- Hugo  · ve prog_limpieza
    'e0000000-0000-0000-0000-00000000000e'    -- Elio  · sin permisos
  ]::uuid[];
  u uuid;
BEGIN
  SET LOCAL ROLE insert_tester;
  FOREACH u IN ARRAY sololectores LOOP
    PERFORM set_config('app.uid', u::text, true);
    BEGIN
      INSERT INTO public.tareas_bloque (bloque_id, titulo)
      VALUES (BLOQUE, 'Pendiente de quien sólo ve');
      RAISE EXCEPTION 'A3: % creó una tarea sin la acción de crear', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RAISE NOTICE 'OK A3 ver Turnos o Limpieza (o nada) ya no autoriza a crear tareas';
END;
$$;

-- ── A4 · Exentos del permiso, no del contrato ───────────────────────────────
-- Ana (admin de la empresa) pasa condominios_puede_actuar porque
-- user_has_permission la trata como omnipotente; Silvia (super_admin) entra
-- por su rama. Ninguna de las dos se salta el «nace pendiente y sin sellos».
DO $$
DECLARE
  BLOQUE constant uuid := 'e3000000-0000-0000-0000-000000000001';
  exentas constant uuid[] := ARRAY[
    'e0000000-0000-0000-0000-00000000000a',   -- Ana    · admin
    'e0000000-0000-0000-0000-000000000010'    -- Silvia · super_admin
  ]::uuid[];
  ids constant uuid[] := ARRAY[
    'e5000000-0000-0000-0000-0000000000c2',
    'e5000000-0000-0000-0000-0000000000c3'
  ]::uuid[];
  i int;
  v_estado text;
BEGIN
  SET LOCAL ROLE insert_tester;
  FOR i IN 1..2 LOOP
    PERFORM set_config('app.uid', exentas[i]::text, true);
    BEGIN
      INSERT INTO public.tareas_bloque (bloque_id, titulo, estado)
      VALUES (BLOQUE, 'Cerrada por una exenta', 'completada');
      RAISE EXCEPTION 'A4a: % insertó una tarea ya cerrada', exentas[i];
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      INSERT INTO public.tareas_bloque (bloque_id, titulo, anulada_en)
      VALUES (BLOQUE, 'Pre-anulada por una exenta', now());
      RAISE EXCEPTION 'A4b: % insertó una tarea pre-anulada', exentas[i];
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    INSERT INTO public.tareas_bloque (id, bloque_id, titulo)
    VALUES (ids[i], BLOQUE, 'Pendiente limpia (exenta)');
    SELECT estado INTO v_estado FROM public.tareas_bloque WHERE id = ids[i];
    IF v_estado IS DISTINCT FROM 'pendiente' THEN
      RAISE EXCEPTION 'A4c: la pendiente limpia de % quedó en %', exentas[i], v_estado; END IF;
  END LOOP;
  RAISE NOTICE 'OK A4 admin y super_admin: cerradas y sellos fuera, pendiente limpia entra';
END;
$$;

-- ── A5 · La empresa vecina sigue fuera ─────────────────────────────────────
DO $$
BEGIN
  SET LOCAL ROLE insert_tester;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);  -- Caro
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, titulo)
    VALUES ('e3000000-0000-0000-0000-000000000001', 'Desde la vecina, con la acción');
    RAISE EXCEPTION 'A5: la vecina insertó en un bloque ajeno';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK A5 la vecina sigue sin crear en un bloque ajeno';
END;
$$;
