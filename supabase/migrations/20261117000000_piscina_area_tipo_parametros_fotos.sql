-- ════════════════════════════════════════════════════════════════════════════
-- Piscina: también jacuzzi, área del catálogo, los parámetros de las tiras y fotos
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `control_piscina` guarda pH, cloro y temperatura de «una piscina» nombrada a
-- mano. El mismo control se hace al jacuzzi, las tiras de prueba miden más
-- cosas (dureza, cloro libre y total, bromo, ácido cianúrico, alcalinidad,
-- cobre, sal) y hoy no hay dónde anotarlas; tampoco hay dónde dejar la foto de
-- la muestra, la de la tira con su resultado ni las del área, y «Registrado
-- por» es texto libre que no dice qué cuenta lo capturó.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `tipo` ('piscina' | 'jacuzzi'): el mismo registro sirve para los dos.
--   2. `area_id` (nullable) → `areas_condominio`, con FK COMPUESTA
--      (area_id, company_id, project_id) contra el ancla `areas_id_tenant_uq`
--      (20260904000400) y ON DELETE RESTRICT, igual que inventario, incendio e
--      incidentes: un cuerpo de agua no puede quedar en un área de otro
--      condominio, y un área con registros no se borra, se desactiva.
--      `piscina` (el nombre: «Principal», «Infantil») NO se toca; no hay
--      backfill por nombre porque el nombre de la piscina no es el del área.
--   3. Los parámetros de las tiras, todos opcionales, en ppm:
--      cloro_total, bromo, dureza_total, acido_cianurico, alcalinidad_total,
--      cobre y sal. `cloro` (ya existente) pasa a leerse como cloro LIBRE.
--   4. Tres juegos de fotos en el bucket `condominios-media` (ruta
--      `<project_id>/piscina/<archivo>.jpg`, el formato de incendio y novedades):
--      `fotos_muestra` (la muestra de agua), `fotos_resultado` (la tira con su
--      resultado) y `fotos_area` (el área inspeccionada). NOT NULL DEFAULT '{}'
--      para que la UI no distinga «sin fotos» de NULL, con CHECK de máximo
--      (2, 2 y 4) para que ningún otro camino de escritura llene la fila.
--   5. Quién lo registra ya queda en `creado_por` (sellado por 20260731000000);
--      `registrado_por` sigue siendo el nombre que se muestra y la UI lo
--      propone con el usuario que captura.
--
-- LO QUE **NO** HACE: no toca las policies de `control_piscina`
-- (20261104000300) ni las de `areas_condominio` ni las del bucket.
--
-- IDEMPOTENTE: ADD COLUMN / CREATE INDEX IF NOT EXISTS; la FK y los CHECK se
-- crean solo si no existen. Re-aplicarla es un no-op.
--
-- REVERSA:
--   ALTER TABLE public.control_piscina
--     DROP COLUMN tipo, DROP COLUMN area_id,
--     DROP COLUMN cloro_total, DROP COLUMN bromo, DROP COLUMN dureza_total,
--     DROP COLUMN acido_cianurico, DROP COLUMN alcalinidad_total,
--     DROP COLUMN cobre, DROP COLUMN sal,
--     DROP COLUMN fotos_muestra, DROP COLUMN fotos_resultado, DROP COLUMN fotos_area;
--   (arrastra la FK, el índice y los CHECK). Los archivos del bucket no se
--   borran solos.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tipo de cuerpo de agua
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.control_piscina
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'piscina';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_piscina_tipo_check') THEN
    ALTER TABLE public.control_piscina
      ADD CONSTRAINT control_piscina_tipo_check CHECK (tipo IN ('piscina', 'jacuzzi'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.control_piscina.tipo IS
  'piscina | jacuzzi. El mismo registro de calidad de agua sirve para los dos.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. control_piscina.area_id → areas_condominio (por tenant)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.control_piscina
  ADD COLUMN IF NOT EXISTS area_id uuid;

-- Con MATCH SIMPLE (el default) la FK compuesta no se evalúa cuando area_id es
-- NULL —company_id y project_id son NOT NULL—: se salta en las filas legadas
-- sin área y muerde en todas las demás.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'areas_id_tenant_uq') THEN
    RAISE EXCEPTION 'piscina_area: falta el ancla areas_id_tenant_uq en areas_condominio (¿se aplicó 20260904000400?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'piscina_area_tenant_fk') THEN
    ALTER TABLE public.control_piscina
      ADD CONSTRAINT piscina_area_tenant_fk
      FOREIGN KEY (area_id, company_id, project_id)
      REFERENCES public.areas_condominio (id, company_id, project_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

COMMENT ON COLUMN public.control_piscina.area_id IS
  'Área del catálogo (areas_condominio) donde está la piscina o el jacuzzi. NULL = registro legado o sin área. `piscina` es el nombre del cuerpo de agua, no del área.';

CREATE INDEX IF NOT EXISTS idx_piscina_area
  ON public.control_piscina(area_id)
  WHERE area_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Los parámetros de las tiras de prueba (ppm), todos opcionales
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.control_piscina
  ADD COLUMN IF NOT EXISTS cloro_total       numeric(6,2),
  ADD COLUMN IF NOT EXISTS bromo             numeric(6,2),
  ADD COLUMN IF NOT EXISTS dureza_total      numeric(7,2),
  ADD COLUMN IF NOT EXISTS acido_cianurico   numeric(7,2),
  ADD COLUMN IF NOT EXISTS alcalinidad_total numeric(7,2),
  ADD COLUMN IF NOT EXISTS cobre             numeric(5,2),
  ADD COLUMN IF NOT EXISTS sal               numeric(8,2);

COMMENT ON COLUMN public.control_piscina.cloro IS
  'Cloro LIBRE (ppm). Ideal 0.5–3 según la tira.';
COMMENT ON COLUMN public.control_piscina.cloro_total IS 'Cloro total (ppm). Ideal 1–3.';
COMMENT ON COLUMN public.control_piscina.bromo IS 'Bromo (ppm). Ideal 2–6.';
COMMENT ON COLUMN public.control_piscina.dureza_total IS 'Dureza total (ppm). Ideal 250–500.';
COMMENT ON COLUMN public.control_piscina.acido_cianurico IS 'Ácido cianúrico (ppm). Ideal 30–100.';
COMMENT ON COLUMN public.control_piscina.alcalinidad_total IS 'Alcalinidad total (ppm). Ideal 80–120.';
COMMENT ON COLUMN public.control_piscina.cobre IS 'Cobre (ppm). Ideal 0.2–0.4.';
COMMENT ON COLUMN public.control_piscina.sal IS 'Sal (ppm). Sólo informativo; piscinas de sal suelen ir en 2700–3400.';

-- Ninguno puede ser negativo. Sólo valida lo nuevo: no hay filas con estas columnas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_piscina_parametros_no_negativos') THEN
    ALTER TABLE public.control_piscina
      ADD CONSTRAINT control_piscina_parametros_no_negativos CHECK (
        (cloro_total IS NULL OR cloro_total >= 0) AND (bromo IS NULL OR bromo >= 0)
        AND (dureza_total IS NULL OR dureza_total >= 0) AND (acido_cianurico IS NULL OR acido_cianurico >= 0)
        AND (alcalinidad_total IS NULL OR alcalinidad_total >= 0) AND (cobre IS NULL OR cobre >= 0)
        AND (sal IS NULL OR sal >= 0));
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Fotos: muestra, resultado de la tira, área
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.control_piscina
  ADD COLUMN IF NOT EXISTS fotos_muestra   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fotos_resultado text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS fotos_area      text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_piscina_fotos_max') THEN
    ALTER TABLE public.control_piscina
      ADD CONSTRAINT control_piscina_fotos_max CHECK (
        cardinality(fotos_muestra) <= 2 AND cardinality(fotos_resultado) <= 2 AND cardinality(fotos_area) <= 4);
  END IF;
END;
$$;

COMMENT ON COLUMN public.control_piscina.fotos_muestra IS
  'Rutas de las fotos de la muestra de agua en condominios-media (<project_id>/piscina/...). Máximo 2.';
COMMENT ON COLUMN public.control_piscina.fotos_resultado IS
  'Rutas de las fotos de la tira con su resultado en condominios-media (<project_id>/piscina/...). Máximo 2.';
COMMENT ON COLUMN public.control_piscina.fotos_area IS
  'Rutas de las fotos del área inspeccionada en condominios-media (<project_id>/piscina/...). Máximo 4.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Que la columna exista no prueba que la FK sea la correcta: sin RESTRICT, un
-- DELETE de área se llevaría el historial del agua; con una FK simple, una
-- piscina podría quedar en un área de otro condominio.
DO $$
DECLARE
  v_del  char;
  v_cols int;
BEGIN
  SELECT confdeltype, array_length(conkey, 1) INTO v_del, v_cols
  FROM pg_constraint
  WHERE conrelid  = 'public.control_piscina'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.areas_condominio'::regclass;
  IF v_del IS DISTINCT FROM 'r' OR v_cols IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'control_piscina.area_id: se esperaba FK compuesta (3 columnas) a areas_condominio con ON DELETE RESTRICT, hay confdeltype=%, columnas=%',
      coalesce(v_del, 'sin FK'), coalesce(v_cols, 0);
  END IF;
END;
$$;
