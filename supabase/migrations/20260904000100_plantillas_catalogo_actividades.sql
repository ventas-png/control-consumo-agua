-- ════════════════════════════════════════════════════════════════════════════
-- Plantillas de tarea → catálogo de actividades operativas
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `plantillas_tarea_cargo` (20260424000060) ya funciona como plantilla de
-- tareas por cargo, pero para servir de catálogo de actividades del nuevo
-- flujo de limpieza le faltan las propiedades operativas: a qué familia de
-- servicio pertenece la actividad, cuánto dura, qué pasos tiene, qué medidas
-- de seguridad exige y qué evidencias son obligatorias al ejecutarla.
--
-- SERVICIO ≠ CARGO. `servicio` es la familia funcional de la ACTIVIDAD
-- (limpieza, mantenimiento, seguridad…); `cargo` es el PUESTO del personal que
-- puede desempeñarla y se queda tal cual está: texto histórico que NO se
-- reescribe (hay valores libres capturados por datalist y adivinar sería
-- corromper datos). Las capturas nuevas de `servicio` van con opciones
-- controladas (CHECK); las filas legadas quedan NULL = "pendiente de
-- clasificar", salvo el backfill conservador de abajo.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. Columnas nuevas: servicio, duracion_estimada_min, checklist,
--      instrucciones_seguridad, requiere_comentario, requiere_checklist.
--      `requiere_foto` YA existía (20260424000060) y se reutiliza tal cual.
--   2. CHECKs de dominio y de positividad (la UI también valida, pero la BD es
--      la que manda).
--   3. Backfill conservador de `servicio` SOLO donde lower(btrim(cargo)) es un
--      nombre de familia inequívoco (limpieza, mantenimiento, seguridad,
--      guardia, jardinería/jardinero). Todo lo demás queda NULL a propósito.
--   4. Retira la policy legacy "company_rw_plantillas_cargo" (20260424000060:70),
--      que neutralizaba el gate RBAC de 20260519000002, y re-declara las
--      cuatro policies. El SELECT acepta también `tareas_personal`: ese tab
--      lee las plantillas para heredarlas a tareas de bloque y el rol semilla
--      Seguridad/Guardia lo trae; sin el OR ese flujo dependería solo de que
--      el rol traiga `plantillas_cargo`.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CHECKs dentro de DO $$ con guardia
-- por conname, backfill con WHERE servicio IS NULL, DROP POLICY IF EXISTS
-- antes de cada CREATE POLICY.
--
-- REVERSA: DROP de las 6 columnas nuevas (los CHECKs y el índice caen con
-- ellas); recrear "company_rw_plantillas_cargo" y las policies de
-- 20260519000002. El backfill de `servicio` desaparece con la columna.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.plantillas_tarea_cargo
  ADD COLUMN IF NOT EXISTS servicio                text,
  ADD COLUMN IF NOT EXISTS duracion_estimada_min   int,
  ADD COLUMN IF NOT EXISTS checklist               jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS instrucciones_seguridad text,
  ADD COLUMN IF NOT EXISTS requiere_comentario     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_checklist      boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.plantillas_tarea_cargo.servicio IS
  'Familia operativa de la ACTIVIDAD: limpieza | mantenimiento | seguridad | jardineria | administracion | otro. NULL = fila legada pendiente de clasificar. No confundir con `cargo` (puesto del personal).';
COMMENT ON COLUMN public.plantillas_tarea_cargo.duracion_estimada_min IS
  'Duración estimada en minutos (> 0). NULL = fila legada sin estimación.';
COMMENT ON COLUMN public.plantillas_tarea_cargo.checklist IS
  'Pasos esperados de la actividad: array JSON de strings, en orden. [] = sin checklist.';
COMMENT ON COLUMN public.plantillas_tarea_cargo.instrucciones_seguridad IS
  'Medidas de seguridad para ejecutar la actividad (EPP, bloqueo de área, químicos, etc.).';
COMMENT ON COLUMN public.plantillas_tarea_cargo.requiere_comentario IS
  'Si es true, la ejecución exigirá un comentario para cerrarse (se aplica al materializar, en PRs posteriores).';
COMMENT ON COLUMN public.plantillas_tarea_cargo.requiere_checklist IS
  'Si es true, la ejecución exigirá completar el checklist para cerrarse (se aplica al materializar, en PRs posteriores).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. CHECKs e índice
-- ────────────────────────────────────────────────────────────────────────────
-- text + CHECK y no enum, como el resto del módulo (frecuencia, estado, turno):
-- agregar un valor no debe exigir migración de tipo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plantillas_cargo_servicio_check') THEN
    ALTER TABLE public.plantillas_tarea_cargo
      ADD CONSTRAINT plantillas_cargo_servicio_check
      CHECK (servicio IS NULL OR servicio IN
        ('limpieza', 'mantenimiento', 'seguridad', 'jardineria', 'administracion', 'otro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plantillas_cargo_duracion_check') THEN
    ALTER TABLE public.plantillas_tarea_cargo
      ADD CONSTRAINT plantillas_cargo_duracion_check
      CHECK (duracion_estimada_min IS NULL OR duracion_estimada_min > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plantillas_cargo_checklist_check') THEN
    ALTER TABLE public.plantillas_tarea_cargo
      ADD CONSTRAINT plantillas_cargo_checklist_check
      CHECK (jsonb_typeof(checklist) = 'array');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_plantillas_cargo_servicio
  ON public.plantillas_tarea_cargo(project_id, servicio)
  WHERE servicio IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Backfill conservador de `servicio`
-- ────────────────────────────────────────────────────────────────────────────
-- Solo los cargos cuyo nombre ES una familia inequívoca. 'conserje',
-- 'polivalente' o cualquier texto libre ambiguo se queda NULL: la UI los
-- muestra como "pendiente de clasificar" y alguien con contexto los resuelve.
-- `cargo` no se toca.
UPDATE public.plantillas_tarea_cargo
SET servicio = CASE lower(btrim(cargo))
  WHEN 'limpieza'      THEN 'limpieza'
  WHEN 'mantenimiento' THEN 'mantenimiento'
  WHEN 'seguridad'     THEN 'seguridad'
  WHEN 'guardia'       THEN 'seguridad'
  WHEN 'jardineria'    THEN 'jardineria'
  WHEN 'jardinería'    THEN 'jardineria'
  WHEN 'jardinero'     THEN 'jardineria'
END
WHERE servicio IS NULL
  AND lower(btrim(cargo)) IN
    ('limpieza', 'mantenimiento', 'seguridad', 'guardia', 'jardineria', 'jardinería', 'jardinero');

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Policies: retirar la legacy y re-declarar las cuatro
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo caso que "company_rw_areas" (ver 20260904000000): el loop de
-- 20260519000002 no la dropeó por el sufijo del nombre y su OR anulaba el gate.
DROP POLICY IF EXISTS "company_rw_plantillas_cargo" ON public.plantillas_tarea_cargo;

DROP POLICY IF EXISTS "plantillas_tarea_cargo_select" ON public.plantillas_tarea_cargo;
CREATE POLICY "plantillas_tarea_cargo_select" ON public.plantillas_tarea_cargo
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')
             OR public.user_has_permission('condominios.tab.tareas_personal')))
  );

DROP POLICY IF EXISTS "plantillas_tarea_cargo_insert" ON public.plantillas_tarea_cargo;
CREATE POLICY "plantillas_tarea_cargo_insert" ON public.plantillas_tarea_cargo
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  );

DROP POLICY IF EXISTS "plantillas_tarea_cargo_update" ON public.plantillas_tarea_cargo;
CREATE POLICY "plantillas_tarea_cargo_update" ON public.plantillas_tarea_cargo
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  );

DROP POLICY IF EXISTS "plantillas_tarea_cargo_delete" ON public.plantillas_tarea_cargo;
CREATE POLICY "plantillas_tarea_cargo_delete" ON public.plantillas_tarea_cargo
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );
