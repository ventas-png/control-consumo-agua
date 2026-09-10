-- ════════════════════════════════════════════════════════════════════════════
-- El checklist de inspección deja de escribir el nombre del área a mano
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `checklist_areas.area` es el ÚLTIMO texto libre de área que quedaba en el
-- módulo: 20260904000100 vinculó `programacion_limpieza`, 20260910000000
-- vinculó `tareas_condominio` y creó el tab `areas_config` (único lugar de
-- alta), y la inspección se quedó con su `<input placeholder="Ej. Lobby,
-- Piscina, Gimnasio">`. Consecuencia conocida: "Piscina", " piscina " y
-- "PISCINA" son tres áreas para el checklist, y lo inspeccionado no se puede
-- cruzar con lo programado ni con lo que la ronda recorre en esa misma área.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `checklist_areas.area_id` (nullable) → `areas_condominio`, con ON DELETE
--      RESTRICT: un área con inspecciones no se borra, se desactiva.
--   2. `area` NO se toca — sigue NOT NULL y pasa a ser el SNAPSHOT del nombre
--      al capturar/vincular. Es también el render de lo legado que el backfill
--      no pudo vincular, que se queda con area_id NULL a propósito.
--   3. Backfill por nombre normalizado, en los mismos tres pasos que sus dos
--      predecesoras: coincidencia única → vincular; cero coincidencias → crear
--      el área y vincular; ambigua (≥2 áreas con el mismo nombre normalizado
--      en el proyecto) → NULL, pendiente de resolución manual.
--
-- LO QUE **NO** HACE, Y POR QUÉ
--   · NO toca las policies de `checklist_areas` (20260420000019, endurecidas en
--     20260518000010): la autorización del tab no cambia con esta columna.
--   · NO toca las de `areas_condominio`: `condominios.tab.checklist_areas` ya
--     era una de las claves que autorizan escribir el catálogo desde
--     20260904000100 §6.
--   · NO toca `items` (los ítems del checklist). Un ítem es una línea de texto
--     dentro del jsonb de su fila, sin identidad ni nada que lo referencie:
--     meterlo en el catálogo de actividades —que carga cargo, servicio,
--     duración, insumos y herramientas— le daría un peso que no necesita. Los
--     ÍTEMS no son ÁREAS aunque la lista de sugerencias del tab se parezca.
--
-- IDEMPOTENTE: ADD COLUMN / CREATE INDEX IF NOT EXISTS; el backfill solo toca
-- filas con area_id IS NULL y no crea áreas que ya existan por nombre
-- normalizado. Re-aplicarla es un no-op.
--
-- REVERSA: ALTER TABLE public.checklist_areas DROP COLUMN area_id;
-- Las áreas que el backfill haya creado NO se auto-revierten: son entradas de
-- catálogo válidas y ya pueden estar referenciadas por otras filas.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. checklist_areas.area_id → areas_condominio
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.checklist_areas
  ADD COLUMN IF NOT EXISTS area_id uuid
    REFERENCES public.areas_condominio(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.checklist_areas.area_id IS
  'Área del catálogo (areas_condominio). NULL = inspección legada que el backfill no pudo vincular (nombre ambiguo). `area` se conserva como snapshot del texto.';
COMMENT ON COLUMN public.checklist_areas.area IS
  'Snapshot del nombre del área al capturar/vincular (NOT NULL). Las inspecciones sin area_id se siguen mostrando con este texto.';

CREATE INDEX IF NOT EXISTS idx_checklist_areas_area
  ON public.checklist_areas(area_id)
  WHERE area_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill (mismo procedimiento que 20260904000100 §2 y 20260910000000 §5)
-- ────────────────────────────────────────────────────────────────────────────
-- 2a. Coincidencia ÚNICA por nombre normalizado dentro del proyecto → vincular.
--     El NOT EXISTS descarta los grupos ambiguos: atar a la piscina equivocada
--     es peor que no atar.
UPDATE public.checklist_areas c
SET area_id = a.id
FROM public.areas_condominio a
WHERE c.area_id IS NULL
  AND public.areas_normalizar_nombre(c.area) IS NOT NULL
  AND a.company_id = c.company_id
  AND a.project_id = c.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(c.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = c.company_id
      AND otra.project_id = c.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(c.area)
  );

-- 2b. CERO coincidencias → crear el área que falta: UNA por grupo normalizado,
--     con min(btrim(...)) para elegir un nombre determinista. El ícono 🗒️ las
--     distingue de las capturadas a mano y de las que crearon los backfills de
--     limpieza (🧹) y de tareas (📋).
INSERT INTO public.areas_condominio (company_id, project_id, nombre, icono, orden, activo)
SELECT p.company_id, p.project_id, p.nombre_original, '🗒️', 0, true
FROM (
  SELECT c.company_id, c.project_id,
         public.areas_normalizar_nombre(c.area) AS norm,
         min(btrim(c.area))                     AS nombre_original
  FROM public.checklist_areas c
  WHERE c.area_id IS NULL
    AND public.areas_normalizar_nombre(c.area) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.areas_condominio a
      WHERE a.company_id = c.company_id
        AND a.project_id = c.project_id
        AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(c.area)
    )
  GROUP BY c.company_id, c.project_id, public.areas_normalizar_nombre(c.area)
) p;

-- 2c. Vincular contra las recién creadas: mismo UPDATE que 2a. Los grupos
--     ambiguos siguen ambiguos y se quedan NULL — es la señal de "pendiente de
--     resolución manual" que la UI muestra como tal.
UPDATE public.checklist_areas c
SET area_id = a.id
FROM public.areas_condominio a
WHERE c.area_id IS NULL
  AND public.areas_normalizar_nombre(c.area) IS NOT NULL
  AND a.company_id = c.company_id
  AND a.project_id = c.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(c.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = c.company_id
      AND otra.project_id = c.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(c.area)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Guarda de postcondición
-- ────────────────────────────────────────────────────────────────────────────
-- Que la columna exista no prueba que la FK sea la correcta: sin RESTRICT, un
-- DELETE de área (que es de company_owner/admin) se llevaría por delante la
-- integridad del historial de inspecciones sin que nada avise. La guarda
-- convierte esa deriva en un fallo de despliegue ruidoso.
DO $$
DECLARE
  v_del char;
BEGIN
  SELECT confdeltype INTO v_del
  FROM pg_constraint
  WHERE conrelid  = 'public.checklist_areas'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.areas_condominio'::regclass;
  IF v_del IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'checklist_areas.area_id: se esperaba FK a areas_condominio con ON DELETE RESTRICT, hay confdeltype=%', coalesce(v_del, 'sin FK');
  END IF;
END;
$$;
