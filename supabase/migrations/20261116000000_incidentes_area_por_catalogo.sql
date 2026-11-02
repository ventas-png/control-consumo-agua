-- ════════════════════════════════════════════════════════════════════════════
-- Incidentes de seguridad: el área se ELIGE del catálogo de áreas
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `incidentes_seguridad.area` es texto libre (placeholder «Ej. Lobby, Parqueo
-- 3»), mientras el condominio ya tiene su catálogo canónico de áreas
-- (`areas_condominio`, administrado en el tab Áreas). Cada incidente escribía
-- su propia versión del lugar, y no se podía saber cuántos incidentes hubo en
-- un área ni cruzarlos con lo que la ronda recorre allí. Es el mismo hueco que
-- 20261111000000 cerró en contra incendio y 20261114000000 en el inventario.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `incidentes_seguridad.area_id` (nullable) → `areas_condominio`, con FK
--      COMPUESTA (area_id, company_id, project_id) contra el ancla
--      `areas_id_tenant_uq` (20260904000400): un incidente no puede quedar en
--      un área de otro condominio. ON DELETE RESTRICT: un área con incidentes
--      registrados no se borra, se desactiva (es historial).
--   2. `area` NO se toca — sigue nullable y pasa a ser el SNAPSHOT del nombre
--      del área al guardar. Es también el render de lo legado que el backfill
--      no pudo vincular, que se queda con area_id NULL.
--   3. Backfill SOLO por coincidencia única de nombre normalizado. NO crea
--      áreas para lo que no coincide: sembrar el catálogo con cada texto libre
--      lo ensuciaría. Lo que no casa queda «sin vincular» y se vincula cuando
--      alguien edita el incidente y elige el área.
--
-- LO QUE **NO** HACE: no toca las policies de `incidentes_seguridad` ni las de
-- `areas_condominio`: la autorización no cambia con
-- esta columna, y la UI solo LEE el catálogo.
--
-- IDEMPOTENTE: ADD COLUMN / CREATE INDEX IF NOT EXISTS, la FK se crea solo si
-- no existe, y el backfill solo toca filas con area_id IS NULL. Re-aplicarla
-- es un no-op.
--
-- REVERSA: ALTER TABLE public.incidentes_seguridad DROP COLUMN area_id;
-- (arrastra la FK y el índice).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. incidentes_seguridad.area_id → areas_condominio (por tenant)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.incidentes_seguridad
  ADD COLUMN IF NOT EXISTS area_id uuid;

-- Con MATCH SIMPLE (el default) la FK compuesta no se evalúa cuando area_id es
-- NULL —company_id y project_id son NOT NULL—: se salta exactamente en las
-- filas legadas sin área y muerde en todas las demás.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'areas_id_tenant_uq') THEN
    RAISE EXCEPTION 'incidentes_area: falta el ancla areas_id_tenant_uq en areas_condominio (¿se aplicó 20260904000400?)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidentes_area_tenant_fk') THEN
    ALTER TABLE public.incidentes_seguridad
      ADD CONSTRAINT incidentes_area_tenant_fk
      FOREIGN KEY (area_id, company_id, project_id)
      REFERENCES public.areas_condominio (id, company_id, project_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

COMMENT ON COLUMN public.incidentes_seguridad.area_id IS
  'Área del catálogo (areas_condominio) donde ocurrió el incidente. NULL = sin área, o incidente legado que el backfill no pudo vincular. `area` se conserva como snapshot del nombre.';
COMMENT ON COLUMN public.incidentes_seguridad.area IS
  'Snapshot del nombre del área al guardar. Los incidentes sin area_id se siguen mostrando con este texto.';

CREATE INDEX IF NOT EXISTS idx_incidentes_area
  ON public.incidentes_seguridad(area_id)
  WHERE area_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill: coincidencia ÚNICA por nombre normalizado → vincular
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo UPDATE que 20261114000000 §2. El NOT EXISTS descarta los grupos
-- ambiguos: atar un incidente al área equivocada es peor que no atarlo.
UPDATE public.incidentes_seguridad i
SET area_id = a.id
FROM public.areas_condominio a
WHERE i.area_id IS NULL
  AND public.areas_normalizar_nombre(i.area) IS NOT NULL
  AND a.company_id = i.company_id
  AND a.project_id = i.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(i.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = i.company_id
      AND otra.project_id = i.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(i.area)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Que la columna exista no prueba que la FK sea la correcta: sin RESTRICT, un
-- DELETE de área se llevaría el historial de incidentes; con una FK simple,
-- un incidente podría quedar en un área de otro condominio. La guarda convierte cualquiera de las
-- dos derivas en un fallo de despliegue ruidoso.
DO $$
DECLARE
  v_del  char;
  v_cols int;
BEGIN
  SELECT confdeltype, array_length(conkey, 1) INTO v_del, v_cols
  FROM pg_constraint
  WHERE conrelid  = 'public.incidentes_seguridad'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.areas_condominio'::regclass;
  IF v_del IS DISTINCT FROM 'r' OR v_cols IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'incidentes_seguridad.area_id: se esperaba FK compuesta (3 columnas) a areas_condominio con ON DELETE RESTRICT, hay confdeltype=%, columnas=%',
      coalesce(v_del, 'sin FK'), coalesce(v_cols, 0);
  END IF;
END;
$$;
