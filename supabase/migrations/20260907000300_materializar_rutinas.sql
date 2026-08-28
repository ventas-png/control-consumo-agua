-- ════════════════════════════════════════════════════════════════════════════
-- Materializar rutinas: de la receta al trabajo del día
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ CIERRA ESTA MIGRACIÓN
-- 20260907000200 dejó la receta (rutinas_limpieza + rutina_actividades) pero no
-- la ejecuta nadie: había que seguir armando el turno a mano. Aquí se cierra el
-- ciclo con una RPC que convierte las rutinas activas en tareas concretas de
-- `tareas_bloque`, el mismo motor que ya usan Turnos y Tareas de personal.
--
-- LA REGLA DE EMPAREJAMIENTO. Una rutina cae en un bloque cuando comparten
-- `plantilla_horario_id` —la jornada— dentro del proyecto y del rango de
-- fechas. La rutina que no declara jornada NO se materializa sola: no hay forma
-- de adivinar en qué turno va, y meterla en todos sería peor que no meterla en
-- ninguno. La RPC devuelve cuántas quedaron así para que la UI lo diga en vez
-- de que el usuario se pregunte por qué no pasó nada.
--
-- SNAPSHOT, NO REFERENCIA — y por qué importa.
-- La tarea copia de la actividad lo que gobierna su ejecución y conserva
-- `plantilla_id` para el linaje. Es el molde que ya usaba `agregarDesdePlantillas`
-- (TareasPersonalTab) con titulo/descripcion/area_id/requiere_foto, extendido a
-- lo que 20260904000200 agregó al catálogo.
--
-- Si en vez de copiar se leyera todo por JOIN, editar el catálogo reescribiría
-- el pasado: una tarea cerrada en marzo con tres pasos de checklist pasaría a
-- mostrar los cinco de hoy, y la evidencia dejaría de decir qué se pidió de
-- verdad. La serie entera está construida sobre lo contrario (la anulación
-- lógica de 20260907000100, el snapshot `area` de 20260904000100), así que aquí
-- se copia.
--
-- ORDEN. Los pasos entran DETRÁS de lo que el bloque ya tenga, en el orden de
-- la rutina. Materializar nunca reordena ni pisa lo que alguien puso a mano.
--
-- IDEMPOTENCIA REAL. La segunda corrida no duplica: lo impide
-- `uq_tareas_bloque_plantilla (bloque_id, plantilla_id)` de 20260907000100, y el
-- INSERT lleva ON CONFLICT DO NOTHING. Y —esto es lo que un `NOT EXISTS` ingenuo
-- se comería— una tarea ANULADA sigue siendo una fila, así que re-materializar
-- NO la resucita. Anular es una decisión; repetirla en cada corrida sería
-- desautorizar a quien la tomó.
--
-- LO QUE NO TOCA: bloques ya cerrados. Agregarle tareas a un turno terminado
-- falsea el registro de lo que se pidió ese día.
--
-- RBAC: la RPC es SECURITY DEFINER (escribe en tablas de dos módulos), así que
-- hace su propio control como `generar_bloques_turno` (20260820000200): guard de
-- scope por empresa MÁS el permiso del tab. Acepta `prog_limpieza` (de quien es
-- la rutina) o `turnos` (de quien administra el turno) — exactamente el mismo
-- par que ya acepta el INSERT de tareas_bloque en 20260907000100.
--
-- IDEMPOTENTE (la migración): sí — ADD COLUMN IF NOT EXISTS, DO $$ guardado por
-- pg_constraint y CREATE OR REPLACE.
--
-- REVERSA: DROP FUNCTION public.materializar_rutinas_turno(uuid, date, date);
-- ALTER TABLE public.tareas_bloque
--   DROP COLUMN rutina_id, DROP COLUMN duracion_estimada_min,
--   DROP COLUMN checklist, DROP COLUMN instrucciones_seguridad,
--   DROP COLUMN requiere_comentario, DROP COLUMN requiere_checklist;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. La tarea guarda lo que se le pidió, no lo que el catálogo diga después
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_bloque
  ADD COLUMN IF NOT EXISTS duracion_estimada_min  int,
  ADD COLUMN IF NOT EXISTS checklist              jsonb   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS instrucciones_seguridad text,
  ADD COLUMN IF NOT EXISTS requiere_comentario    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_checklist     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rutina_id              uuid;

COMMENT ON COLUMN public.tareas_bloque.duracion_estimada_min IS
  'Minutos que la actividad declaraba AL MATERIALIZAR. Copia, no join: editar el catálogo no reescribe lo que se pidió aquel día.';
COMMENT ON COLUMN public.tareas_bloque.checklist IS
  'Pasos que la actividad declaraba al materializar. Copia por la misma razón que duracion_estimada_min.';
COMMENT ON COLUMN public.tareas_bloque.rutina_id IS
  'Rutina que generó la tarea (linaje). NULL = alta manual o carga suelta de plantillas.';

DO $MAT$
BEGIN
  -- RESTRICT, no SET NULL: una rutina que ya generó trabajo es historia. Su
  -- baja es `activa = false`, que la UI ya ofrece. Es además coherente con
  -- `tareas_bloque.plantilla_id`, cuya FK sin ON DELETE (20260424000060) ya
  -- impide borrar una actividad que produjo tareas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tareas_bloque_rutina_fk') THEN
    ALTER TABLE public.tareas_bloque
      ADD CONSTRAINT tareas_bloque_rutina_fk
      FOREIGN KEY (rutina_id) REFERENCES public.rutinas_limpieza(id) ON DELETE RESTRICT;
  END IF;
END;
$MAT$;

CREATE INDEX IF NOT EXISTS idx_tareas_bloque_rutina
  ON public.tareas_bloque(rutina_id) WHERE rutina_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. La RPC
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.materializar_rutinas_turno(
  p_project_id uuid,
  p_desde      date DEFAULT NULL,
  p_hasta      date DEFAULT NULL
)
RETURNS TABLE (
  generadas               int,
  omitidas_existente      int,
  omitidas_bloque_cerrado int,
  rutinas_sin_jornada     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_desde   date := COALESCE(p_desde, CURRENT_DATE);
  v_hasta   date;
BEGIN
  v_hasta := COALESCE(p_hasta, v_desde + 30);

  IF v_hasta < v_desde THEN
    RAISE EXCEPTION 'el rango termina antes de empezar' USING ERRCODE = '22007';
  END IF;

  -- Mismo techo duro que generar_bloques_turno: una rutina de 10 pasos sobre
  -- 20 bloques diarios a un año son 73.000 filas en una sola llamada.
  IF v_hasta - v_desde > 400 THEN
    RAISE EXCEPTION 'el rango no puede exceder 400 días' USING ERRCODE = '22003';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  -- Guard de scope (20260729000200) + permiso del tab. La SECURITY DEFINER se
  -- salta la RLS, así que este control ES el control.
  PERFORM public.assert_company_scope(v_company);

  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.prog_limpieza')
          OR public.user_has_permission('condominios.tab.turnos')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  WITH candidatas AS (
    SELECT
      b.id            AS bloque_id,
      r.id            AS rutina_id,
      p.id            AS plantilla_id,
      p.titulo,
      p.descripcion,
      -- El área del paso; si la actividad no declara ninguna, la de la rutina.
      -- Ambas son del mismo proyecto por construcción (FKs compuestas de
      -- 20260907000200), así que no puede colarse un área ajena.
      COALESCE(p.area_id, r.area_id) AS area_id,
      p.requiere_foto,
      p.duracion_estimada_min,
      COALESCE(p.checklist, '[]'::jsonb) AS checklist,
      p.instrucciones_seguridad,
      p.requiere_comentario,
      p.requiere_checklist,
      b.estado        AS bloque_estado,
      b.cerrado_en    AS bloque_cerrado_en,
      -- Denso y determinista: el `orden` de la rutina puede tener huecos, y dos
      -- rutinas pueden caer en el mismo bloque.
      row_number() OVER (
        PARTITION BY b.id
        ORDER BY r.orden, r.nombre, r.id, ra.orden, p.titulo, p.id
      ) AS pos,
      -- La fila ya existente cuenta AUNQUE esté anulada: anular es una decisión
      -- y re-materializar no la desautoriza.
      EXISTS (
        SELECT 1 FROM public.tareas_bloque tb
        WHERE tb.bloque_id = b.id AND tb.plantilla_id = p.id
      ) AS ya_existe
    FROM public.rutinas_limpieza  r
    JOIN public.rutina_actividades ra ON ra.rutina_id = r.id
    JOIN public.plantillas_tarea_cargo p ON p.id = ra.plantilla_tarea_id
    JOIN public.bloques_turno      b  ON b.plantilla_horario_id = r.plantilla_horario_id
                                     AND b.project_id = r.project_id
    WHERE r.project_id = p_project_id
      AND r.company_id = v_company
      AND r.activa
      AND r.plantilla_horario_id IS NOT NULL
      -- La actividad dada de baja no se materializa: sigue en la rutina para no
      -- perder la definición, pero no genera trabajo nuevo.
      AND p.activo
      AND b.fecha BETWEEN v_desde AND v_hasta
  ),
  -- El desplazamiento por bloque: lo nuevo entra DETRÁS de lo que ya había.
  base AS (
    SELECT c.bloque_id, COALESCE(MAX(tb.orden), -1) AS max_orden
    FROM (SELECT DISTINCT bloque_id FROM candidatas) c
    LEFT JOIN public.tareas_bloque tb ON tb.bloque_id = c.bloque_id
    GROUP BY c.bloque_id
  ),
  insertadas AS (
    INSERT INTO public.tareas_bloque (
      bloque_id, plantilla_id, rutina_id, titulo, descripcion, area_id,
      requiere_foto, duracion_estimada_min, checklist, instrucciones_seguridad,
      requiere_comentario, requiere_checklist, orden, estado
    )
    SELECT
      c.bloque_id, c.plantilla_id, c.rutina_id, c.titulo, c.descripcion, c.area_id,
      c.requiere_foto, c.duracion_estimada_min, c.checklist, c.instrucciones_seguridad,
      c.requiere_comentario, c.requiere_checklist, bs.max_orden + c.pos, 'pendiente'
    FROM candidatas c
    JOIN base bs ON bs.bloque_id = c.bloque_id
    WHERE NOT c.ya_existe
      -- Un turno terminado no recibe tareas nuevas.
      AND c.bloque_cerrado_en IS NULL
      AND c.bloque_estado NOT IN ('completado', 'incompleto')
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM insertadas)::int,
    (SELECT count(*) FROM candidatas WHERE ya_existe)::int,
    (SELECT count(*) FROM candidatas
      WHERE NOT ya_existe
        AND (bloque_cerrado_en IS NOT NULL
             OR bloque_estado IN ('completado', 'incompleto')))::int,
    (SELECT count(*) FROM public.rutinas_limpieza r2
      WHERE r2.project_id = p_project_id
        AND r2.company_id = v_company
        AND r2.activa
        AND r2.plantilla_horario_id IS NULL)::int
  INTO generadas, omitidas_existente, omitidas_bloque_cerrado, rutinas_sin_jornada;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) IS
  'Convierte las rutinas activas de un proyecto en tareas de bloques_turno para el rango dado (por defecto 30 días desde hoy), emparejando por jornada. Copia lo que la actividad declara; no pisa lo existente ni resucita lo anulado; no toca bloques cerrados. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) TO authenticated, service_role;
