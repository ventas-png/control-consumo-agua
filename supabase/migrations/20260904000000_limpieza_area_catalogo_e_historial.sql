-- ════════════════════════════════════════════════════════════════════════════
-- Limpieza: el área deja de ser texto libre y el historial deja de ser borrable
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `programacion_limpieza.area` es texto libre ("Ej. Piscina, Lobby, Gimnasio")
-- mientras el condominio ya tiene un catálogo canónico de áreas
-- (`areas_condominio`, 20260424000059) que usan rondas, plantillas de tarea y
-- tareas de bloque. Dos consecuencias: "Piscina" y " piscina " son áreas
-- distintas para limpieza, y nada de lo que se programe o ejecute se puede
-- cruzar con el resto del módulo. Además `ejecuciones_limpieza.programacion_id`
-- nació ON DELETE CASCADE (20260807130000:96): borrar una programación borra
-- su historial de ejecuciones con fotos y novedades — la UI hasta lo advierte.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `programacion_limpieza.area_id` (nullable) → `areas_condominio`, con
--      ON DELETE RESTRICT: un área con programaciones no se puede borrar, se
--      desactiva. `area` NO se elimina: queda como snapshot del texto y como
--      render de los registros legados que el backfill no pudo vincular.
--   2. Backfill por nombre normalizado (espacios/mayúsculas/acentos), por
--      (company_id, project_id): coincidencia única → vincula; ninguna → crea
--      el área y vincula; ambigua (≥2 áreas con el mismo nombre normalizado en
--      el proyecto) → se queda NULL a propósito, pendiente de resolución
--      manual. Atar al área equivocada es peor que no atar.
--   3. `ejecuciones_limpieza.programacion_id` pasa de CASCADE a RESTRICT: el
--      historial operativo (fotos, novedades, reportes) sobrevive; borrar una
--      programación con ejecuciones falla y la UI ofrece desactivarla.
--   4. Se retira la policy legacy "company_rw_areas" (20260424000059:57), que
--      nunca se dropeó y neutralizaba el gate RBAC de 20260519000002 (cualquier
--      authenticated de la empresa escribía áreas). La escritura se re-declara
--      aceptando cualquiera de los tres tabs que legítimamente administran
--      áreas — checklist_areas (el gate original), rutas_ronda (donde vive el
--      CRUD) y prog_limpieza (que con esta migración también selecciona áreas
--      del catálogo) — porque el rol semilla Seguridad/Guardia (20260518000006)
--      tiene rutas_ronda pero no checklist_areas: sin el OR perdería el alta de
--      áreas que hoy le funciona gracias a la legacy.
--
-- POR QUÉ SIN unaccent: la extensión no está instalada en el proyecto y no se
-- quiere depender de ella (mismo criterio que conta_normalizar_nombre,
-- 20260823000100). Se usa translate() con el alfabeto español.
--
-- IDEMPOTENTE: ADD COLUMN/CREATE INDEX IF NOT EXISTS; el backfill solo toca
-- filas con area_id IS NULL y no crea áreas que ya existan por nombre
-- normalizado; el cambio de FK solo actúa si la FK sigue en CASCADE; las
-- policies van con DROP POLICY IF EXISTS antes de cada CREATE.
--
-- REVERSA: ALTER TABLE public.programacion_limpieza DROP COLUMN area_id;
-- recrear la FK de ejecuciones_limpieza con ON DELETE CASCADE; recrear
-- "company_rw_areas" y las policies de 20260519000002. Las áreas que el
-- backfill haya creado NO se auto-revierten: son entradas de catálogo válidas
-- (borrarlas exigiría verificar que nada más las referencia ya).

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Normalizador de nombres de área
-- ────────────────────────────────────────────────────────────────────────────
-- Solo para COMPARAR, nunca para reescribir: minúsculas, sin espacios ni
-- signos, sin acentos. 'Terraza BBQ ' → 'terrazabbq'. NULL si no queda nada.
-- El mapa de translate incluye los acentos TAMBIÉN en mayúscula: con lc_ctype=C,
-- lower() solo minusculiza ASCII y una 'Í' sobreviviría hasta el regexp, que la
-- descartaría — 'JARDÍN' normalizaría distinto que 'jardín' y el backfill
-- crearía un duplicado. (El espejo en cliente, domain/condominios/areas.ts,
-- usa toLowerCase() de JS, que sí maneja todos los casos.)
CREATE OR REPLACE FUNCTION public.areas_normalizar_nombre(p_nombre text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(
    regexp_replace(
      translate(lower(btrim(coalesce(p_nombre, ''))),
                'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'),
      '[^a-z0-9]+', '', 'g'),
    '')
$$;

REVOKE EXECUTE ON FUNCTION public.areas_normalizar_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.areas_normalizar_nombre(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.areas_normalizar_nombre(text) IS
  'Normaliza un nombre de área para compararlo (minúsculas, sin espacios/signos/acentos). Solo comparación: el texto original nunca se reescribe.';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. programacion_limpieza.area_id → areas_condominio
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.programacion_limpieza
  ADD COLUMN IF NOT EXISTS area_id uuid
    REFERENCES public.areas_condominio(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.programacion_limpieza.area_id IS
  'Área del catálogo (areas_condominio). NULL = registro legado pendiente de vincular (o ambiguo en el backfill). `area` se conserva como snapshot del texto capturado.';
COMMENT ON COLUMN public.programacion_limpieza.area IS
  'Snapshot del nombre del área al capturar/vincular. Los registros legados sin area_id se siguen mostrando con este texto.';

CREATE INDEX IF NOT EXISTS idx_prog_limpieza_area
  ON public.programacion_limpieza(area_id)
  WHERE area_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Backfill
-- ────────────────────────────────────────────────────────────────────────────
-- 2a. Coincidencia ÚNICA por nombre normalizado dentro del proyecto → vincular.
--     El NOT EXISTS descarta los grupos ambiguos (patrón 20260820000100).
UPDATE public.programacion_limpieza pl
SET area_id = a.id
FROM public.areas_condominio a
WHERE pl.area_id IS NULL
  AND public.areas_normalizar_nombre(pl.area) IS NOT NULL
  AND a.company_id = pl.company_id
  AND a.project_id = pl.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(pl.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = pl.company_id
      AND otra.project_id = pl.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(pl.area)
  );

-- 2b. CERO coincidencias → crear el área que falta: UNA por grupo normalizado
--     (min() del texto btrim para elegir un nombre determinista), con el ícono
--     de limpieza para distinguirlas de las capturadas a mano.
INSERT INTO public.areas_condominio (company_id, project_id, nombre, icono, orden, activo)
SELECT p.company_id, p.project_id, p.nombre_original, '🧹', 0, true
FROM (
  SELECT pl.company_id, pl.project_id,
         public.areas_normalizar_nombre(pl.area) AS norm,
         min(btrim(pl.area))                     AS nombre_original
  FROM public.programacion_limpieza pl
  WHERE pl.area_id IS NULL
    AND public.areas_normalizar_nombre(pl.area) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.areas_condominio a
      WHERE a.company_id = pl.company_id
        AND a.project_id = pl.project_id
        AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(pl.area)
    )
  GROUP BY pl.company_id, pl.project_id, public.areas_normalizar_nombre(pl.area)
) p;

-- 2c. Vincular contra las recién creadas: mismo UPDATE que 2a. Los grupos de 2b
--     ahora tienen exactamente una coincidencia; los ambiguos siguen ambiguos y
--     se quedan NULL — es la señal de "pendiente de resolución manual" que la
--     UI muestra como tal.
UPDATE public.programacion_limpieza pl
SET area_id = a.id
FROM public.areas_condominio a
WHERE pl.area_id IS NULL
  AND public.areas_normalizar_nombre(pl.area) IS NOT NULL
  AND a.company_id = pl.company_id
  AND a.project_id = pl.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(pl.area)
  AND NOT EXISTS (
    SELECT 1 FROM public.areas_condominio otra
    WHERE otra.company_id = pl.company_id
      AND otra.project_id = pl.project_id
      AND otra.id <> a.id
      AND public.areas_normalizar_nombre(otra.nombre) = public.areas_normalizar_nombre(pl.area)
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. ejecuciones_limpieza.programacion_id: CASCADE → RESTRICT
-- ────────────────────────────────────────────────────────────────────────────
-- La FK se localiza por catálogo y no por nombre: nació inline
-- (20260807130000:96) con nombre autogenerado y no hay garantía de que prod no
-- haya derivado. Solo se actúa si sigue en CASCADE (confdeltype = 'c'), así la
-- re-aplicación es un no-op.
DO $$
DECLARE
  v_con text;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid  = 'public.ejecuciones_limpieza'::regclass
    AND contype   = 'f'
    AND confrelid = 'public.programacion_limpieza'::regclass
    AND confdeltype = 'c';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.ejecuciones_limpieza DROP CONSTRAINT %I', v_con);
    ALTER TABLE public.ejecuciones_limpieza
      ADD CONSTRAINT ejecuciones_limpieza_programacion_id_fkey
      FOREIGN KEY (programacion_id)
      REFERENCES public.programacion_limpieza(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. areas_condominio: retirar la legacy y re-declarar la escritura
-- ────────────────────────────────────────────────────────────────────────────
-- "company_rw_areas" (FOR ALL, solo company_id) sobrevivió al hardening RBAC:
-- el loop de 20260519000002 solo dropea nombres con sufijo _select/_insert/…
-- Como las policies permisivas se OR-ean, el gate por permiso era letra muerta.
-- Precedente de esta limpieza: company_rw_bloques_turno en 20260820000000:453.
DROP POLICY IF EXISTS "company_rw_areas" ON public.areas_condominio;

-- SELECT queda como estaba (empresa completa): es un catálogo transversal que
-- alimenta joins de rondas, plantillas, tareas y ahora limpieza.
DROP POLICY IF EXISTS "areas_condominio_select" ON public.areas_condominio;
CREATE POLICY "areas_condominio_select" ON public.areas_condominio
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "areas_condominio_insert" ON public.areas_condominio;
CREATE POLICY "areas_condominio_insert" ON public.areas_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.checklist_areas')
             OR public.user_has_permission('condominios.tab.rutas_ronda')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "areas_condominio_update" ON public.areas_condominio;
CREATE POLICY "areas_condominio_update" ON public.areas_condominio
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.checklist_areas')
             OR public.user_has_permission('condominios.tab.rutas_ronda')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.checklist_areas')
             OR public.user_has_permission('condominios.tab.rutas_ronda')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

-- DELETE sigue reservado a los roles de empresa: borrar un área es destructivo
-- para todo el módulo (y con esta migración, además, RESTRICT lo bloquea si
-- tiene programaciones).
DROP POLICY IF EXISTS "areas_condominio_delete" ON public.areas_condominio;
CREATE POLICY "areas_condominio_delete" ON public.areas_condominio
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );
