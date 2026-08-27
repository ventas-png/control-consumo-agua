\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Post-idempotencia: tras RE-APLICAR la serie 20260904000100 · 000200 · 000300
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

DO $$
DECLARE n int; v_tgtype smallint;
BEGIN
  -- Post-idempotencia de 20260904000400. Lo que hay que vigilar aquí es que la
  -- CUARTA migración sobreviva a la re-aplicación de las TRES anteriores: la
  -- 000200 vuelve a declarar el trigger como BEFORE INSERT, y es la 000400 —que
  -- corre después— la que tiene que dejarlo otra vez en su forma correcta. Si
  -- alguien reordenara la serie, esto lo caza.

  -- El ancla y la FK compuesta existen UNA vez, no duplicadas.
  SELECT count(*) INTO n FROM pg_constraint WHERE conname = 'areas_id_tenant_uq';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-6: quedaron % anclas areas_id_tenant_uq (esperado 1)', n; END IF;

  SELECT count(*) INTO n FROM pg_constraint WHERE conname = 'prog_limpieza_area_tenant_fk';
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-7: quedaron % FKs compuestas de área (esperado 1)', n; END IF;

  -- Y la FK simple no volvió a aparecer junto a la compuesta.
  SELECT count(*) INTO n FROM pg_constraint c
   WHERE c.conrelid = 'public.programacion_limpieza'::regclass
     AND c.contype  = 'f'
     AND array_length(c.conkey, 1) = 1
     AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.programacion_limpieza'::regclass
                              AND attname  = 'area_id' AND NOT attisdropped)];
  IF n <> 0 THEN
    RAISE EXCEPTION 'idem-8: la re-aplicación resucitó la FK simple de area_id'; END IF;

  -- El trigger es uno solo y sigue cubriendo INSERT y UPDATE OF cargo.
  -- tgtype: bit 0 = ROW, bit 1 = BEFORE, bit 2 = INSERT, bit 4 = UPDATE → 23.
  SELECT count(*), min(tgtype) INTO n, v_tgtype FROM pg_trigger
   WHERE tgrelid = 'public.plantillas_tarea_cargo'::regclass
     AND tgname  = 'trg_plantillas_cargo_controlado'
     AND NOT tgisinternal;
  IF n <> 1 THEN
    RAISE EXCEPTION 'idem-9: quedaron % triggers de cargo (esperado 1)', n; END IF;
  IF (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION 'idem-10: tras re-aplicar la serie el trigger de cargo dejó de cubrir UPDATE (tgtype=%)', v_tgtype; END IF;
  IF (v_tgtype & 4) = 0 THEN
    RAISE EXCEPTION 'idem-11: tras re-aplicar la serie el trigger de cargo dejó de cubrir INSERT (tgtype=%)', v_tgtype; END IF;

  RAISE NOTICE 'OK   la integridad final sobrevive a re-aplicar la serie entera';
END;
$$;
