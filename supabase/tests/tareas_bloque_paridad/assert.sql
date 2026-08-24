\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de la paridad de tareas_bloque (20260905000100).

DO $$
DECLARE
  ADMIN_A  uuid := 'e0000000-0000-0000-0000-00000000000a';
  BLOQUE   uuid := 'e3000000-0000-0000-0000-000000000001';
  PLANTILLA uuid := 'd0000000-0000-0000-0000-000000000001';
  T_PENDIENTE uuid := 'e4000000-0000-0000-0000-000000000001';
  T_CERRADA   uuid := 'e4000000-0000-0000-0000-000000000002';
  v_uuid uuid;
  v_ts   timestamptz;
  n      bigint;
BEGIN
  PERFORM set_config('app.uid', ADMIN_A::text, false);

  -- ── 1. El par de cierre existe y cuelga del hito CORRECTO ────────────────
  -- El typo de 20260731000000 ('completado_en') impidió crear la columna y el
  -- trigger. Aquí se comprueba que ambos existen y que sellan de verdad.
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'tareas_bloque'
    AND column_name = 'completado_por';
  IF n <> 1 THEN
    RAISE EXCEPTION '1a: falta la columna completado_por'; END IF;

  UPDATE public.tareas_bloque
  SET estado = 'completada', completada_en = now()
  WHERE id = T_PENDIENTE;
  SELECT completado_por INTO v_uuid FROM public.tareas_bloque WHERE id = T_PENDIENTE;
  IF v_uuid IS DISTINCT FROM ADMIN_A THEN
    RAISE EXCEPTION '1b: completado_por = % (debía sellarlo la BD con el usuario de la sesión)', v_uuid; END IF;
  -- Y en la transición manda la SESIÓN, no lo que envíe el cliente: no se
  -- puede atribuir el cierre a otra persona. (Igual que
  -- ejecuciones_limpieza.completada_por, el helper sella en la transición; no
  -- convierte la columna en inmutable — eso es `sellar_actor('…','forzar')`,
  -- que es lo que protege `creado_por`.)
  INSERT INTO public.tareas_bloque (id, bloque_id, titulo)
  VALUES ('e4000000-0000-0000-0000-0000000000c1', BLOQUE, 'Cierre con actor falsificado');
  UPDATE public.tareas_bloque
  SET estado = 'completada', completada_en = now(),
      completado_por = 'e0000000-0000-0000-0000-00000000000c'  -- la vecina
  WHERE id = 'e4000000-0000-0000-0000-0000000000c1';
  SELECT completado_por INTO v_uuid FROM public.tareas_bloque
  WHERE id = 'e4000000-0000-0000-0000-0000000000c1';
  IF v_uuid IS DISTINCT FROM ADMIN_A THEN
    RAISE EXCEPTION '1c: el cliente logró atribuir el cierre a % ', v_uuid; END IF;
  RAISE NOTICE 'OK 1  el cierre de la tarea ya sabe QUIÉN, y lo impone la BD';

  -- ── 2. La rama de la RPC que reventaba ahora resuelve ────────────────────
  -- Era el bug vivo: `tb.completado_en` no existe (la real es `completada_en`)
  -- y `tb.completado_por` no se había creado. Este SELECT es exactamente el
  -- de la rama 'limpiezas' de actividad_equipo.
  SELECT count(*) INTO n
    FROM public.tareas_bloque tb
    JOIN public.bloques_turno bt ON bt.id = tb.bloque_id
   WHERE tb.completado_por IS NOT NULL
     AND tb.completada_en >= now() - interval '30 days';
  IF n < 1 THEN
    RAISE EXCEPTION '2: la rama de actividad del equipo no devolvió la tarea recién cerrada'; END IF;
  RAISE NOTICE 'OK 2  la consulta de actividad del equipo ya no revienta con 42703';

  -- ── 3. Estado y prioridad controlados ────────────────────────────────────
  BEGIN
    UPDATE public.tareas_bloque SET estado = 'inventado' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION '3a: se aceptó un estado fuera del dominio';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.tareas_bloque SET prioridad = 'urgentisima' WHERE id = T_PENDIENTE;
    RAISE EXCEPTION '3b: se aceptó una prioridad fuera del dominio';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.tareas_bloque
  SET novedad = 'La llave gotea', prioridad = 'alta', requiere_mantenimiento = true
  WHERE id = T_PENDIENTE;
  RAISE NOTICE 'OK 3  estado y prioridad controlados; el triaje de novedades existe';

  -- ── 4. Anulación lógica con motivo y autor sellado ───────────────────────
  BEGIN
    UPDATE public.tareas_bloque SET anulada_en = now() WHERE id = T_PENDIENTE;
    RAISE EXCEPTION '4a: se anuló sin motivo';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE public.tareas_bloque
  SET anulada_en = now(), motivo_anulacion = 'Cargada al bloque equivocado'
  WHERE id = T_PENDIENTE;
  SELECT anulada_por INTO v_uuid FROM public.tareas_bloque WHERE id = T_PENDIENTE;
  IF v_uuid IS DISTINCT FROM ADMIN_A THEN
    RAISE EXCEPTION '4b: anulada_por = % (debía sellarlo la BD)', v_uuid; END IF;
  -- Restaurar limpia el trío completo.
  UPDATE public.tareas_bloque
  SET anulada_en = NULL, anulada_por = NULL, motivo_anulacion = NULL
  WHERE id = T_PENDIENTE;
  RAISE NOTICE 'OK 4  anular exige motivo, sella al autor y es restaurable';

  -- ── 5. Cargar el checklist dos veces ya no lo duplica ────────────────────
  BEGIN
    INSERT INTO public.tareas_bloque (bloque_id, plantilla_id, titulo)
    VALUES (BLOQUE, PLANTILLA, 'Limpiar lobby');
    RAISE EXCEPTION '5a: se duplicó la misma plantilla en el mismo bloque';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  -- …pero las tareas ad-hoc (sin plantilla) sí pueden repetirse: el índice es
  -- parcial a propósito.
  INSERT INTO public.tareas_bloque (id, bloque_id, titulo) VALUES
    ('e4000000-0000-0000-0000-0000000000a1', BLOQUE, 'Tarea suelta'),
    ('e4000000-0000-0000-0000-0000000000a2', BLOQUE, 'Tarea suelta');
  DELETE FROM public.tareas_bloque
  WHERE id IN ('e4000000-0000-0000-0000-0000000000a1', 'e4000000-0000-0000-0000-0000000000a2');
  RAISE NOTICE 'OK 5  una tarea por plantilla y bloque; las ad-hoc no se ven afectadas';

  RAISE NOTICE '── 5 invariantes de datos OK ──';
END;
$$;

-- ══ RLS ══════════════════════════════════════════════════════════════════════
CREATE ROLE paridad_tester;
GRANT authenticated TO paridad_tester;
GRANT USAGE ON SCHEMA public TO paridad_tester;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paridad_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO paridad_tester;

DO $$
DECLARE
  BLOQUE      uuid := 'e3000000-0000-0000-0000-000000000001';
  T_CERRADA   uuid := 'e4000000-0000-0000-0000-000000000002';
  T_PENDIENTE uuid := 'e4000000-0000-0000-0000-000000000001';
  n bigint;
BEGIN
  SET LOCAL ROLE paridad_tester;

  -- ── 6. Los consumidores REALES conservan su acceso tras dropear la legada ─
  -- El gate anterior era `panel_turno`, que no lo trae ningún consumidor real.
  -- Beto solo tiene tareas_personal: es quien de verdad usa el tab.
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000b', true);
  SELECT count(*) INTO n FROM public.tareas_bloque;
  IF n = 0 THEN
    RAISE EXCEPTION '6a: tareas_personal debía seguir viendo las tareas y vio 0'; END IF;
  INSERT INTO public.tareas_bloque (id, bloque_id, titulo)
  VALUES ('e4000000-0000-0000-0000-0000000000b1', BLOQUE, 'Alta desde tareas_personal');
  RAISE NOTICE 'OK 6  el re-gateo conserva el acceso de quien de verdad usa la tabla';

  -- ── 7. Limpieza también entra (materializará sus rutinas aquí) ───────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT count(*) INTO n FROM public.tareas_bloque;
  IF n = 0 THEN
    RAISE EXCEPTION '7: prog_limpieza debía poder leer las tareas de bloque y vio 0'; END IF;
  RAISE NOTICE 'OK 7  prog_limpieza accede sin permisos del módulo Seguridad';

  -- ── 8. Sin permiso no hay nada, y la vecina tampoco ──────────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000e', true);
  SELECT count(*) INTO n FROM public.tareas_bloque;
  IF n <> 0 THEN
    RAISE EXCEPTION '8a: sin permisos se vieron % tareas (la legada seguía viva)', n; END IF;
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000c', true);
  SELECT count(*) INTO n FROM public.tareas_bloque
  WHERE bloque_id = BLOQUE;
  IF n <> 0 THEN
    RAISE EXCEPTION '8b: la empresa vecina vio % tareas ajenas', n; END IF;
  RAISE NOTICE 'OK 8  sin permiso no hay tareas; el aislamiento por empresa se sostiene';

  -- ── 9. La tarea CERRADA no se borra ni siendo admin ──────────────────────
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000a', true);
  DELETE FROM public.tareas_bloque WHERE id = T_CERRADA;
  SELECT count(*) INTO n FROM public.tareas_bloque WHERE id = T_CERRADA;
  IF n <> 1 THEN
    RAISE EXCEPTION '9a: el admin borró físicamente una tarea ya ejecutada'; END IF;
  -- La corrección legítima es anular.
  UPDATE public.tareas_bloque
  SET anulada_en = now(), motivo_anulacion = 'Duplicada'
  WHERE id = T_CERRADA;
  SELECT count(*) INTO n FROM public.tareas_bloque
  WHERE id = T_CERRADA AND anulada_en IS NOT NULL;
  IF n <> 1 THEN
    RAISE EXCEPTION '9b: el admin no pudo anular la tarea cerrada'; END IF;
  -- La pendiente sí se puede quitar del checklist (aún no es evidencia).
  DELETE FROM public.tareas_bloque WHERE id = 'e4000000-0000-0000-0000-0000000000b1';
  RAISE NOTICE 'OK 9  la tarea ejecutada es evidencia: se anula, no se borra';

  RESET ROLE;

  -- ── 10. Las policies legadas ya no existen ──────────────────────────────
  SELECT count(*) INTO n FROM pg_policies
  WHERE policyname IN ('company_rw_tareas_bloque', 'company_rw_revisiones_tarea');
  IF n <> 0 THEN
    RAISE EXCEPTION '10a: siguen vivas % policies company_rw_* que anulan el gate RBAC', n; END IF;
  -- Y revisiones_tarea, que nunca tuvo RBAC, ahora tiene sus cuatro.
  SELECT count(*) INTO n FROM pg_policies
  WHERE tablename = 'revisiones_tarea' AND policyname LIKE 'revisiones_tarea_%';
  IF n <> 4 THEN
    RAISE EXCEPTION '10b: revisiones_tarea debía quedar con 4 policies RBAC y tiene %', n; END IF;
  RAISE NOTICE 'OK 10 las legadas se retiraron y revisiones_tarea estrena gate RBAC';

  RAISE NOTICE '── 5 invariantes de RLS OK ──';
END;
$$;
