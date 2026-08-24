\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: tras RE-APLICAR la serie completa (20260904000000 ·
-- 000100 · 000200 · 20260905000000) sobre una base ya migrada y ya fusionada,
-- nada debe duplicarse, revivir ni volver a fusionarse.

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  v_area uuid;
  n  bigint;
  t  text;
BEGIN
  -- El grupo Terraza BBQ no se re-crea.
  SELECT count(*) INTO n FROM public.areas_condominio
  WHERE project_id = P1 AND public.areas_normalizar_nombre(nombre) = 'terrazabbq';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: la re-aplicación dejó % áreas terrazabbq (esperada 1)', n; END IF;

  -- P1 conserva las 5 que dejó la fusión: Piscina, Jardín, Lobby (superviviente),
  -- Terraza (backfill) y Caseta (assert 25). Re-aplicar no resucita las
  -- perdedoras ni fusiona de más.
  SELECT count(*) INTO n FROM public.areas_condominio WHERE project_id = P1;
  IF n <> 5 THEN
    RAISE EXCEPTION 'idem-2: P1 debía seguir con 5 áreas y tiene %', n; END IF;

  -- El dedupe es idempotente: sigue habiendo UNA sola área lobby.
  SELECT count(*) INTO n FROM public.areas_condominio
  WHERE project_id = P1 AND public.areas_normalizar_nombre(nombre) = 'lobby';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-2b: re-aplicar dejó % áreas lobby en P1', n; END IF;

  -- La vacía sigue sin vincular (no hay nombre que comparar). La que era
  -- ambigua ya NO lo está: la cerró la fusión, y debe seguir cerrada.
  SELECT area_id INTO v_area FROM public.programacion_limpieza
  WHERE id = 'b0000000-0000-0000-0000-000000000006';
  IF v_area IS NOT NULL THEN
    RAISE EXCEPTION 'idem-3a: la re-aplicación vinculó la programación con área en blanco'; END IF;
  SELECT area_id INTO v_area FROM public.programacion_limpieza
  WHERE id = 'b0000000-0000-0000-0000-000000000003';
  IF v_area IS NULL THEN
    RAISE EXCEPTION 'idem-3b: la programación que la fusión cerró volvió a quedar sin vincular'; END IF;

  -- El cargo ambiguo sigue sin servicio.
  SELECT servicio INTO t FROM public.plantillas_tarea_cargo
  WHERE id = 'd0000000-0000-0000-0000-000000000003';
  IF t IS NOT NULL THEN
    RAISE EXCEPTION 'idem-4: la re-aplicación clasificó el cargo ambiguo como %', t; END IF;

  -- Las legacy no renacen.
  SELECT count(*) INTO n FROM pg_policies
  WHERE policyname IN ('company_rw_areas', 'company_rw_plantillas_cargo');
  IF n <> 0 THEN
    RAISE EXCEPTION 'idem-5: la re-aplicación revivió una policy legacy'; END IF;

  -- El índice único sobrevive a la re-aplicación.
  SELECT count(*) INTO n FROM pg_indexes
  WHERE schemaname = 'public' AND indexname = 'uq_areas_nombre_normalizado';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-6: el índice único de áreas desapareció al re-aplicar'; END IF;

  RAISE NOTICE 'OK   re-aplicar la serie no duplica ni resucita áreas, no revive policies y conserva el UNIQUE';
END;
$$;
