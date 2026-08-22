\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: tras RE-APLICAR la serie 20260904000000 · 000100 · 000200
-- sobre una base ya migrada (y con los datos que los asserts dejaron), nada
-- debe duplicarse ni resolverse solo.

DO $$
DECLARE
  P1 uuid := '11111111-0000-0000-0000-000000000001';
  n  bigint;
  t  text;
BEGIN
  -- El grupo Terraza BBQ no se re-crea.
  SELECT count(*) INTO n FROM public.areas_condominio
  WHERE project_id = P1 AND public.areas_normalizar_nombre(nombre) = 'terrazabbq';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-1: la re-aplicación dejó % áreas terrazabbq (esperada 1)', n; END IF;

  -- P1 conserva sus 6 áreas: 4 del fixture + Terraza (backfill) + Caseta (assert 21).
  SELECT count(*) INTO n FROM public.areas_condominio WHERE project_id = P1;
  IF n <> 6 THEN
    RAISE EXCEPTION 'idem-2: P1 debía seguir con 6 áreas y tiene %', n; END IF;

  -- La ambigua y la vacía siguen pendientes: re-correr no las resuelve solo.
  SELECT count(*) INTO n FROM public.programacion_limpieza
  WHERE id IN ('b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000006')
    AND area_id IS NULL;
  IF n <> 2 THEN
    RAISE EXCEPTION 'idem-3: la re-aplicación vinculó una programación ambigua o vacía'; END IF;

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

  RAISE NOTICE 'OK   re-aplicar la serie no duplica áreas, no resuelve ambiguos y no revive policies';
END;
$$;
