\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260904000500 sobre un esquema con la forma REAL de
-- producción. Cada bloque RAISE EXCEPTION si algo no se cumple.

DO $$
DECLARE
  CO_A         uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  AREA_PISCINA uuid := 'a0000000-0000-0000-0000-000000000001';
  AREA_GIMN    uuid := 'a0000000-0000-0000-0000-00000000000e';
  RUTA         uuid := 'a1000000-0000-0000-0000-000000000001';
  PROG_PISCINA uuid := 'b0000000-0000-0000-0000-000000000001';
  v_bool   boolean;
  v_txt    text;
  v_int    int;
  v_uuid   uuid;
  n        bigint;
BEGIN
  -- ══ A. La columna que reventó el apply ═════════════════════════════════════

  -- ── 1. areas_condominio.activo existe, NOT NULL y con default true ───────
  SELECT attnotnull INTO v_bool FROM pg_attribute
   WHERE attrelid = 'public.areas_condominio'::regclass AND attname = 'activo' AND NOT attisdropped;
  IF v_bool IS NULL THEN
    RAISE EXCEPTION '1a: areas_condominio.activo no existe — la reparación no hizo nada'; END IF;
  IF NOT v_bool THEN
    RAISE EXCEPTION '1b: areas_condominio.activo quedó nullable'; END IF;
  SELECT pg_get_expr(adbin, adrelid) INTO v_txt FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.areas_condominio'::regclass AND a.attname = 'activo';
  IF v_txt IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '1c: el default de activo quedó en % (se esperaba true)', coalesce(v_txt, 'ninguno'); END IF;
  RAISE NOTICE 'OK 1  areas_condominio.activo repuesta: NOT NULL, default true';

  -- ── 2. Las filas que ya existían quedaron vigentes ───────────────────────
  -- `true` no es un valor cualquiera: es lo que la UI asumía por ausencia del
  -- dato. Poner false habría desactivado todo el catálogo de un condominio.
  SELECT count(*) INTO n FROM public.areas_condominio WHERE activo IS NOT TRUE;
  IF n > 0 THEN
    RAISE EXCEPTION '2: % área(s) preexistentes NO quedaron activas', n; END IF;
  RAISE NOTICE 'OK 2  las % áreas preexistentes quedaron activas',
    (SELECT count(*) FROM public.areas_condominio);

  -- ── 3. rutas_ronda.activo, el mismo hueco de la misma migración ──────────
  SELECT attnotnull INTO v_bool FROM pg_attribute
   WHERE attrelid = 'public.rutas_ronda'::regclass AND attname = 'activo' AND NOT attisdropped;
  IF v_bool IS NULL THEN RAISE EXCEPTION '3a: rutas_ronda.activo no existe'; END IF;
  IF NOT v_bool THEN RAISE EXCEPTION '3b: rutas_ronda.activo quedó nullable'; END IF;
  SELECT activo INTO v_bool FROM public.rutas_ronda WHERE id = RUTA;
  IF v_bool IS NOT TRUE THEN RAISE EXCEPTION '3c: la ruta preexistente no quedó activa'; END IF;
  RAISE NOTICE 'OK 3  rutas_ronda.activo repuesta y la ruta preexistente sigue vigente';

  -- ── 4. icono/orden: se RELLENA y después se cierra ───────────────────────
  -- El orden importa: un SET NOT NULL a secas habría fallado contra la fila
  -- 'Gimnasio', que el esquema laxo de producción permitía guardar con huecos.
  SELECT icono, orden INTO v_txt, v_int FROM public.areas_condominio WHERE id = AREA_GIMN;
  IF v_txt IS DISTINCT FROM '📍' THEN
    RAISE EXCEPTION '4a: el icono NULL debía quedar en 📍 y quedó %', coalesce(v_txt, 'NULL'); END IF;
  IF v_int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '4b: el orden NULL debía quedar en 0 y quedó %', coalesce(v_int::text, 'NULL'); END IF;
  IF NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.areas_condominio'::regclass AND attname = 'icono') THEN
    RAISE EXCEPTION '4c: icono quedó nullable'; END IF;
  IF NOT (SELECT attnotnull FROM pg_attribute
           WHERE attrelid = 'public.areas_condominio'::regclass AND attname = 'orden') THEN
    RAISE EXCEPTION '4d: orden quedó nullable'; END IF;
  RAISE NOTICE 'OK 4  icono/orden rellenados (📍, 0) y cerrados a NOT NULL';

  -- ── 5. La FK de company_id que faltaba ───────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.areas_condominio'::regclass
       AND contype = 'f' AND confrelid = 'public.companies'::regclass) THEN
    RAISE EXCEPTION '5: no se creó la FK areas_condominio.company_id → companies'; END IF;
  RAISE NOTICE 'OK 5  FK areas_condominio.company_id → companies creada';

  -- ══ B. Y por fin, la serie que había fallado ═══════════════════════════════

  -- ── 6. 20260904000100 pudo reintentarse: area_id existe y el backfill corrió
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.programacion_limpieza'::regclass
                    AND attname = 'area_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION '6a: programacion_limpieza.area_id no existe — 000100 no llegó a aplicarse'; END IF;
  SELECT area_id INTO v_uuid FROM public.programacion_limpieza WHERE id = PROG_PISCINA;
  IF v_uuid IS DISTINCT FROM AREA_PISCINA THEN
    RAISE EXCEPTION '6b: el backfill no vinculó "  PISCINA " (quedó %) — se aplicó el esquema pero no los datos', v_uuid; END IF;
  RAISE NOTICE 'OK 6  000100 se aplicó ENTERA: area_id existe y el backfill vinculó';

  -- ── 7. La policy legacy se retiró ────────────────────────────────────────
  -- Es la prueba de que 000100 llegó hasta el final: su DROP está en la línea
  -- 273, muy por detrás del INSERT que reventaba en la 132. Si sigue viva, la
  -- migración volvió a cortarse por el camino.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'areas_condominio'
                AND policyname = 'company_rw_areas') THEN
    RAISE EXCEPTION '7: "company_rw_areas" sigue viva — 000100 no llegó a su línea 273'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = 'condominios.areas.manage') THEN
    RAISE EXCEPTION '7b: el permiso condominios.areas.manage no se sembró'; END IF;
  RAISE NOTICE 'OK 7  la legacy company_rw_areas se retiró y el permiso nuevo quedó sembrado';

  -- ── 8. 20260904000400: ancla, FK compuesta y RESTRICT ────────────────────
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'areas_id_tenant_uq') THEN
    RAISE EXCEPTION '8a: falta el ancla areas_id_tenant_uq'; END IF;
  SELECT confdeltype, array_length(conkey, 1) INTO v_txt, v_int
    FROM pg_constraint WHERE conname = 'prog_limpieza_area_tenant_fk';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '8b: falta prog_limpieza_area_tenant_fk — 000400 no se aplicó'; END IF;
  IF v_int <> 3 THEN
    RAISE EXCEPTION '8c: la FK del área tiene % columna(s), se esperaban 3', v_int; END IF;
  IF v_txt <> 'r' THEN
    RAISE EXCEPTION '8d: la FK del área no quedó en ON DELETE RESTRICT (confdeltype=%)', v_txt; END IF;
  RAISE NOTICE 'OK 8  000400 aplicada: ancla UNIQUE + FK compuesta por el trío con RESTRICT';

  -- ── 9. El trigger de cargo cubre INSERT y UPDATE OF cargo ────────────────
  SELECT (tgtype::int & 4) > 0 AND (tgtype::int & 16) > 0 INTO v_bool
    FROM pg_trigger WHERE tgname = 'trg_plantillas_cargo_controlado' AND NOT tgisinternal;
  IF v_bool IS NOT TRUE THEN
    RAISE EXCEPTION '9: el trigger de cargo no cubre INSERT + UPDATE'; END IF;
  RAISE NOTICE 'OK 9  el catálogo de cargos se valida en INSERT y en UPDATE';

  -- ── 10. Y la serie entera sigue siendo operable ──────────────────────────
  -- Un alta normal después de todo el arreglo: es el gesto que hoy da 400 en
  -- producción (AreasCatalog manda `activo` en el insert).
  INSERT INTO public.areas_condominio (company_id, project_id, nombre, icono, orden, activo)
  VALUES (CO_A, '11111111-0000-0000-0000-000000000001', 'Salón de eventos', '🎉', 9, true);
  UPDATE public.areas_condominio SET activo = false WHERE nombre = 'Salón de eventos';
  SELECT activo INTO v_bool FROM public.areas_condominio WHERE nombre = 'Salón de eventos';
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION '10: el toggle de activo no persistió'; END IF;
  RAISE NOTICE 'OK 10 alta y desactivación de un área funcionan (el gesto que hoy da 400)';
END;
$$;
