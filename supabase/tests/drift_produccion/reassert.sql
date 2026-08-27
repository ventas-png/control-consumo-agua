\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Idempotencia: tras re-aplicar 20260904000500 y la serie entera, nada se
-- duplica y ningún dato se pisa. Es la garantía que necesita el modo
-- reconciliar de apply-migrations-prod, que re-ejecuta por diseño.

DO $$
DECLARE n bigint; v_bool boolean;
BEGIN
  -- ── idem-1. Constraints únicas, no acumuladas ────────────────────────────
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.areas_condominio'::regclass
     AND contype = 'f' AND confrelid = 'public.companies'::regclass;
  IF n <> 1 THEN RAISE EXCEPTION 'idem-1: % FK(s) de company_id (se esperaba 1)', n; END IF;

  SELECT count(*) INTO n FROM pg_constraint WHERE conname = 'areas_id_tenant_uq';
  IF n <> 1 THEN RAISE EXCEPTION 'idem-1b: % ancla(s) areas_id_tenant_uq', n; END IF;

  SELECT count(*) INTO n FROM pg_constraint WHERE conname = 'prog_limpieza_area_tenant_fk';
  IF n <> 1 THEN RAISE EXCEPTION 'idem-1c: % FK(s) compuesta(s) del área', n; END IF;
  RAISE NOTICE 'OK idem-1  las constraints siguen siendo una sola de cada';

  -- ── idem-2. La columna reparada no se degrada al re-aplicar ──────────────
  IF NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.areas_condominio'::regclass AND attname = 'activo') THEN
    RAISE EXCEPTION 'idem-2: activo volvió a ser nullable'; END IF;
  IF NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.rutas_ronda'::regclass AND attname = 'activo') THEN
    RAISE EXCEPTION 'idem-2b: rutas_ronda.activo volvió a ser nullable'; END IF;
  RAISE NOTICE 'OK idem-2  activo sigue NOT NULL en las dos tablas';

  -- ── idem-3. Los datos no se pisan ────────────────────────────────────────
  -- El área desactivada en el assert 10 tiene que seguir desactivada: una
  -- reparación que "rellenara" de nuevo pondría todo en true y desharía el
  -- trabajo del operador sin avisar.
  SELECT activo INTO v_bool FROM public.areas_condominio WHERE nombre = 'Salón de eventos';
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION 'idem-3: re-aplicar reactivó un área que estaba desactivada'; END IF;

  SELECT count(*) INTO n FROM public.areas_condominio WHERE nombre = 'Salón de eventos';
  IF n <> 1 THEN RAISE EXCEPTION 'idem-3b: el área se duplicó (% filas)', n; END IF;
  RAISE NOTICE 'OK idem-3  re-aplicar no reactiva ni duplica áreas';

  -- ── idem-4. Un solo trigger de cargo, con el tipo correcto ───────────────
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname = 'trg_plantillas_cargo_controlado' AND NOT tgisinternal;
  IF n <> 1 THEN RAISE EXCEPTION 'idem-4: % trigger(s) de cargo', n; END IF;
  RAISE NOTICE 'OK idem-4  un único trigger de cargo tras re-aplicar';
END;
$$;
