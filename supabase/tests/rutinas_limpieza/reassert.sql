\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: tras RE-APLICAR 20260905000200 sobre una base ya migrada
-- y con datos, nada debe duplicarse, perderse ni aflojarse.

DO $$
DECLARE
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  n  bigint;
BEGIN
  -- Las rutinas creadas por los asserts siguen ahí (la re-aplicación no
  -- recrea la tabla ni pierde filas).
  SELECT count(*) INTO n FROM public.rutinas_limpieza;
  IF n = 0 THEN
    RAISE EXCEPTION 'idem-1: la re-aplicación se llevó las rutinas'; END IF;

  -- Las policies no se duplican (DROP IF EXISTS antes de cada CREATE).
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename IN ('rutinas_limpieza', 'rutina_actividades');
  IF n <> 8 THEN
    RAISE EXCEPTION 'idem-2: quedaron % policies (esperadas 8)', n; END IF;

  -- Los triggers tampoco.
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal
    AND c.relname IN ('rutinas_limpieza', 'rutina_actividades');
  IF n <> 3 THEN
    RAISE EXCEPTION 'idem-3: quedaron % triggers (esperados 3: 2 de autor + 1 de coherencia)', n; END IF;

  -- Las anclas UNIQUE siguen siendo UNA cada una.
  SELECT count(*) INTO n FROM pg_constraint
  WHERE conname IN ('areas_id_tenant_uq', 'plantillas_horario_id_tenant_uq', 'rutinas_id_tenant_uq');
  IF n <> 3 THEN
    RAISE EXCEPTION 'idem-4: hay % anclas de tenant (esperadas 3)', n; END IF;

  -- El índice único por nombre normalizado sobrevive.
  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_rutinas_nombre_normalizado';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-5: el índice único de rutinas desapareció al re-aplicar'; END IF;

  -- Y las garantías siguen vivas: el duplicado sigue rechazado.
  BEGIN
    INSERT INTO public.rutinas_limpieza (company_id, project_id, nombre)
    VALUES (C1, P1, 'rutina matutina de piscina');
    RAISE EXCEPTION 'idem-6: tras re-aplicar se aceptó una rutina duplicada';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Y la actividad ajena también.
  BEGIN
    INSERT INTO public.rutina_actividades (company_id, project_id, rutina_id, plantilla_tarea_id)
    VALUES (C1, P1, '4a000000-0000-0000-0000-000000000001',
            'd0000000-0000-0000-0000-000000000004');
    RAISE EXCEPTION 'idem-7: tras re-aplicar se aceptó una actividad de otra empresa';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK   re-aplicar no duplica policies ni triggers, no pierde datos y conserva las garantías';
END;
$$;
