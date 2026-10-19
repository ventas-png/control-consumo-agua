-- ════════════════════════════════════════════════════════════════════════════
-- Rutinas como RECORRIDO: primero las áreas, en orden; dentro de cada una, sus
-- actividades
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ FALTABA
-- 20260907000200 modeló la rutina como una lista plana de actividades con UN
-- área opcional en la cabecera. Así no se puede escribir la rutina que de
-- verdad se trabaja: «Apartamento 1AB → Apartamento 1C → Gradas», cada parada
-- con sus actividades (barrer el pasillo, limpiar vidrios…) y en ESE orden, que
-- es el que va a seguir quien la reciba en su turno. Y la misma actividad del
-- catálogo se repite en muchas áreas —barrer se barre en todos los pasillos—,
-- cosa que el UNIQUE (rutina_id, plantilla_tarea_id) prohibía.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `rutina_areas` — las PARADAS del recorrido: qué área, en qué orden. Una
--      parada puede existir sin actividades todavía (se arma primero el orden
--      de las áreas y después se les asignan actividades).
--   2. `rutina_actividades.rutina_area_id` — a qué parada pertenece cada paso.
--      NULL = paso legado (sin área), como los de las rutinas que ya existen:
--      siguen funcionando exactamente igual.
--   3. La misma actividad puede estar en varias paradas: el UNIQUE pasa a ser
--      (rutina, parada, actividad).
--   4. `tareas_bloque`: una plantilla, una tarea POR ÁREA y bloque. Sin esto,
--      materializar «barrer» en diez apartamentos daría una tarea y nueve
--      conflictos silenciosos.
--   5. `guardar_recorrido_rutina` — guarda el recorrido COMPLETO en una sola
--      transacción. El editor es de arrastrar y soltar: reordenar una parada
--      mueve el `orden` de todas, y hacerlo fila por fila desde el cliente deja
--      el recorrido a medio reordenar si una de las escrituras falla.
--   6. `materializar_rutinas_turno` — el área de la tarea es la de su parada, y
--      el orden de las tareas en el turno sigue el del recorrido.
--
-- ES DEFINICIÓN, NO EJECUCIÓN — igual que 20260907000200. Aquí no hay fechas
-- ni personal; la ocurrencia del día la sigue creando la materialización.
--
-- POR QUÉ UNA TABLA DE PARADAS Y NO UN `area_id` EN CADA PASO
-- Con el área en el paso, una parada sin actividades no existe, y el orden de
-- las áreas no tiene dónde vivir: habría que deducirlo del menor `orden` de sus
-- pasos, y mover un área sería renumerar todos sus pasos. La parada es la
-- unidad que el usuario arrastra; merece su fila.
--
-- TENANT — el molde de 20260907000200, sin reinventarlo:
--   · `rutina_areas` → rutina y → área por FKs COMPUESTAS
--     (id, company_id, project_id): el motor sostiene la coherencia toda la
--     vida de la fila.
--   · Un trigger BEFORE sella company_id/project_id desde la rutina e ignora
--     lo que mande el cliente; aborta legible si el área es de otro tenant.
--   · `rutina_actividades` → parada por FK COMPUESTA (rutina_area_id,
--     rutina_id) hacia el ancla UNIQUE (id, rutina_id): un paso no puede
--     colgar de la parada de OTRA rutina, aunque sea del mismo proyecto.
--     MATCH SIMPLE: con rutina_area_id NULL (paso legado) no se verifica, que
--     es lo que se quiere.
--
-- BORRADO:
--   · parada → rutina: CASCADE. Es parte de la definición.
--   · paso → parada: CASCADE. Quitar un área del recorrido se lleva sus pasos;
--     las actividades del catálogo no se tocan.
--   · parada → área: RESTRICT, el mismo criterio que rutinas_limpieza → área.
--     La baja de un área es activo=false, y la parada de un área inactiva deja
--     de materializarse (ver §6) sin perder la definición.
--
-- UNA PARADA POR ÁREA. El recorrido no pasa dos veces por la misma área. No es
-- capricho: la tarea materializada se identifica por (bloque, actividad, área),
-- así que una segunda pasada por el mismo sitio con la misma actividad sería
-- la misma tarea y desaparecería en silencio.
--
-- RBAC: el mismo gate `condominios.tab.prog_limpieza` de 20260907000200, en las
-- cuatro policies de la tabla nueva. La RPC de guardado es SECURITY INVOKER: no
-- se salta nada, escribe bajo la RLS de quien la llama.
--
-- SIN bitácora: catálogo, no hechos (criterio de 20260731000100:178-182).
--
-- IDEMPOTENTE: sí — CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DO $$ guardado por pg_constraint, DROP … IF EXISTS antes de cada
-- trigger/policy y CREATE OR REPLACE en las funciones.
--
-- IMPACTO EN DATOS: ninguno. No se reescribe ninguna fila: los pasos existentes
-- quedan con rutina_area_id NULL y se materializan como hasta hoy
-- (área de la actividad, o la de la rutina). El índice nuevo de tareas_bloque
-- es MÁS permisivo que el que reemplaza, así que se construye sin conflictos
-- sobre los datos actuales; si aun así hubiera duplicados (una base donde la
-- unicidad vieja no existiera), el pre-vuelo de §4 aborta TODA la migración
-- con el conteo, antes de tocar nada.
--
-- DRIFT DECLARADO. `tabla:tareas_bloque/indices` difiere entre producción y el
-- repositorio desde antes de esta migración (#826), y §4 tiene que tocarlo: es
-- la única forma de que la misma actividad exista en dos áreas de un turno. El
-- auditor de tres vías lo marca CAMBIO AMBIGUO hasta que se mida producción;
-- por eso §4 identifica la unicidad vieja por sus COLUMNAS y no por su nombre.
--
-- REVERSA: scripts/reversion-rutinas-recorrido.sql (restaura la RPC de
-- 20260907000300 y los dos UNIQUE originales; aborta si ya hay datos que sólo
-- el modelo nuevo admite, en vez de borrarlos).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. rutina_areas — las paradas del recorrido
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rutina_areas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  rutina_id   uuid        NOT NULL,
  area_id     uuid        NOT NULL,
  orden       int         NOT NULL DEFAULT 0,
  notas       text,
  creado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Una parada por área (ver cabecera: la tarea se identifica por área).
  CONSTRAINT rutina_areas_unica UNIQUE (rutina_id, area_id),
  -- Ancla de la FK compuesta de rutina_actividades: el paso y su parada son de
  -- la MISMA rutina.
  CONSTRAINT rutina_areas_id_rutina_uq UNIQUE (id, rutina_id),
  CONSTRAINT rutina_areas_rutina_fk
    FOREIGN KEY (rutina_id, company_id, project_id)
    REFERENCES public.rutinas_limpieza(id, company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT rutina_areas_area_fk
    FOREIGN KEY (area_id, company_id, project_id)
    REFERENCES public.areas_condominio(id, company_id, project_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.rutina_areas IS
  'Paradas del recorrido de una rutina: qué área se interviene y en qué orden. Sus actividades cuelgan de rutina_actividades.rutina_area_id.';
COMMENT ON COLUMN public.rutina_areas.orden IS
  'Posición de la parada en el recorrido. Lo reescribe guardar_recorrido_rutina en una sola transacción.';
COMMENT ON COLUMN public.rutina_areas.company_id IS
  'Denormalizado de la rutina. Lo sella la BD (rutina_area_coherente); lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.rutina_areas.project_id IS
  'Denormalizado de la rutina. Lo sella la BD (rutina_area_coherente); lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.rutina_areas.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

-- El UNIQUE (rutina_id, area_id) ya indexa por rutina; falta el área (para el
-- RESTRICT) y el par project/company (loaders).
CREATE INDEX IF NOT EXISTS idx_rutina_areas_area    ON public.rutina_areas(area_id);
CREATE INDEX IF NOT EXISTS idx_rutina_areas_project ON public.rutina_areas(project_id, company_id);

-- Gemela de rutina_actividad_coherente (20260907000200), con el área en vez de
-- la actividad. SECURITY DEFINER por el mismo motivo: con INVOKER, la RLS del
-- área ajena haría que «no exista» y el error mentiría.
CREATE OR REPLACE FUNCTION public.rutina_area_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rutina       record;
  v_area_company uuid;
  v_area_project uuid;
BEGIN
  SELECT company_id, project_id INTO v_rutina
  FROM public.rutinas_limpieza
  WHERE id = NEW.rutina_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUTINA_AREA: la rutina % no existe', NEW.rutina_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- El tenant lo define la rutina; lo que mande el cliente se ignora.
  NEW.company_id := v_rutina.company_id;
  NEW.project_id := v_rutina.project_id;

  SELECT company_id, project_id INTO v_area_company, v_area_project
  FROM public.areas_condominio
  WHERE id = NEW.area_id;

  IF v_area_company IS NULL THEN
    RAISE EXCEPTION 'RUTINA_AREA: el área % no existe', NEW.area_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_area_company IS DISTINCT FROM v_rutina.company_id
     OR v_area_project IS DISTINCT FROM v_rutina.project_id THEN
    RAISE EXCEPTION 'RUTINA_AREA: el área % pertenece a otra empresa o a otro proyecto que la rutina %',
      NEW.area_id, NEW.rutina_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
-- Solo la invoca el trigger; nadie la llama directo.
REVOKE EXECUTE ON FUNCTION public.rutina_area_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rutina_area_coherente ON public.rutina_areas;
CREATE TRIGGER trg_rutina_area_coherente
  BEFORE INSERT OR UPDATE OF rutina_id, area_id, company_id, project_id
  ON public.rutina_areas
  FOR EACH ROW EXECUTE FUNCTION public.rutina_area_coherente();

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.rutina_areas;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.rutina_areas
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- RLS: el mismo gate y la misma forma que rutina_actividades (20260907000200),
-- incluido el DELETE con el permiso del tab: quitar una parada es edición de
-- catálogo, no destrucción de historial.
ALTER TABLE public.rutina_areas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rutina_areas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rutina_areas TO authenticated;
GRANT ALL ON public.rutina_areas TO service_role;

DROP POLICY IF EXISTS "rutina_areas_select" ON public.rutina_areas;
CREATE POLICY "rutina_areas_select" ON public.rutina_areas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutina_areas_insert" ON public.rutina_areas;
CREATE POLICY "rutina_areas_insert" ON public.rutina_areas
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutina_areas_update" ON public.rutina_areas;
CREATE POLICY "rutina_areas_update" ON public.rutina_areas
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutina_areas_delete" ON public.rutina_areas;
CREATE POLICY "rutina_areas_delete" ON public.rutina_areas
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2-3. rutina_actividades: el paso cuelga de su parada
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rutina_actividades
  ADD COLUMN IF NOT EXISTS rutina_area_id uuid;

COMMENT ON COLUMN public.rutina_actividades.rutina_area_id IS
  'Parada del recorrido (rutina_areas) donde se hace el paso. NULL = paso legado sin parada: se materializa con el área de la actividad o, si no tiene, la de la rutina.';
COMMENT ON COLUMN public.rutina_actividades.orden IS
  'Posición del paso DENTRO de su parada (o entre los pasos sin parada).';

DO $RECORRIDO$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rutina_act_parada_fk') THEN
    ALTER TABLE public.rutina_actividades
      ADD CONSTRAINT rutina_act_parada_fk
      FOREIGN KEY (rutina_area_id, rutina_id)
      REFERENCES public.rutina_areas(id, rutina_id) ON DELETE CASCADE;
  END IF;

  -- La misma actividad en dos paradas es lo normal (se barre en cada pasillo);
  -- dos veces en la MISMA parada sigue siendo un duplicado. NULLS NOT DISTINCT:
  -- entre los pasos legados (sin parada) la regla vieja se conserva tal cual.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rutina_act_unica_parada') THEN
    ALTER TABLE public.rutina_actividades
      ADD CONSTRAINT rutina_act_unica_parada
      UNIQUE NULLS NOT DISTINCT (rutina_id, rutina_area_id, plantilla_tarea_id);
  END IF;

  -- Se retira DESPUÉS de crear el nuevo: el nuevo lo implica para los pasos
  -- legados y nunca hay un instante sin unicidad.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rutina_act_unica') THEN
    ALTER TABLE public.rutina_actividades DROP CONSTRAINT rutina_act_unica;
  END IF;
END;
$RECORRIDO$;

-- Para el CASCADE desde la parada.
CREATE INDEX IF NOT EXISTS idx_rutina_act_parada
  ON public.rutina_actividades(rutina_area_id) WHERE rutina_area_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. tareas_bloque: una plantilla, una tarea POR ÁREA y bloque
-- ────────────────────────────────────────────────────────────────────────────
-- uq_tareas_bloque_plantilla (20260907000100) existía para que «Cargar tareas
-- del cargo» dos veces no duplicara el checklist. Esa garantía se conserva: la
-- segunda carga trae la misma actividad con la misma área (la de la actividad)
-- y choca igual. Lo que cambia es que «barrer» en el Apartamento 1AB y
-- «barrer» en el 1C dejan de ser la misma tarea. NULLS NOT DISTINCT: dos
-- cargas de una actividad sin área siguen siendo un duplicado.
DO $PREVUELO$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT 1 FROM public.tareas_bloque
    WHERE plantilla_id IS NOT NULL
    GROUP BY bloque_id, plantilla_id, area_id
    HAVING count(*) > 1
  ) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'RUTINAS_RECORRIDO (pre-vuelo): % combinación(es) (bloque, actividad, área) ya están repetidas en tareas_bloque; no se toca nada. Depurarlas antes de reintentar.', v_n
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$PREVUELO$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_bloque_plantilla_area
  ON public.tareas_bloque(bloque_id, plantilla_id, area_id) NULLS NOT DISTINCT
  WHERE plantilla_id IS NOT NULL;

COMMENT ON INDEX public.uq_tareas_bloque_plantilla_area IS
  'Una tarea por plantilla, ÁREA y bloque (20261102000000): cargar el checklist dos veces no lo duplica, y la misma actividad en dos áreas del recorrido son dos tareas. Parcial: las tareas ad-hoc (plantilla_id NULL) no se ven afectadas.';

-- La unicidad vieja (bloque_id, plantilla_id) se retira POR SUS COLUMNAS, no
-- por su nombre. Los índices de tareas_bloque tienen drift declarado contra
-- producción (scripts/schema-drift/drift-conocido.json, #826): allá no
-- coinciden con los del repositorio, y un `DROP INDEX IF EXISTS
-- uq_tareas_bloque_plantilla` que no encontrara su nombre dejaría viva una
-- unicidad equivalente con otro — y la segunda área de cada actividad se
-- perdería en silencio en el ON CONFLICT DO NOTHING de la materialización.
-- Se retira ya sea índice o constraint, y el aviso queda en el log del deploy.
-- Va DESPUÉS de crear el índice nuevo: nunca hay un instante sin unicidad.
DO $UNICIDAD$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT ic.relname AS indice, con.conname AS restriccion
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid AND con.conrelid = i.indrelid
    WHERE i.indrelid = 'public.tareas_bloque'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND i.indnkeyatts = 2
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
             FROM unnest(i.indkey::int2[]) AS k(attnum)
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
          = ARRAY['bloque_id', 'plantilla_id']
  LOOP
    IF v.restriccion IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.tareas_bloque DROP CONSTRAINT %I', v.restriccion);
    ELSE
      EXECUTE format('DROP INDEX public.%I', v.indice);
    END IF;
    RAISE NOTICE 'RUTINAS_RECORRIDO: retirada la unicidad (bloque_id, plantilla_id) de tareas_bloque: «%»',
      COALESCE(v.restriccion, v.indice);
  END LOOP;
END;
$UNICIDAD$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. guardar_recorrido_rutina — el recorrido completo, en una transacción
-- ────────────────────────────────────────────────────────────────────────────
-- p_recorrido es la foto COMPLETA del recorrido, en orden:
--   [ { "area_id": "<uuid>" | null,
--       "actividades": [ { "plantilla_tarea_id": "<uuid>", "obligatoria": true }, … ] },
--     … ]
-- La posición en el arreglo ES el orden. `area_id: null` es el grupo de pasos
-- legados (sin parada); como mucho uno.
--
-- La identidad es NATURAL —(área) para la parada, (parada, actividad) para el
-- paso— y no el id de fila: el editor arma el recorrido sin conocer ids y la
-- función decide qué se conserva, qué se crea y qué se va. Lo que se conserva
-- conserva su fila (y sus `notas`); lo que no viene en la foto se borra.
--
-- SECURITY INVOKER, a propósito. Todo lo que hace es lo que el editor podría
-- hacer fila por fila bajo la RLS de 20260907000200 y de §1; agruparlo en una
-- transacción no necesita ningún privilegio extra, así que no se le da.
--
-- Concurrencia: la rutina se bloquea con FOR UPDATE antes de leer nada. Dos
-- pestañas guardando a la vez se serializan y gana la última foto completa, en
-- vez de mezclar las dos.
CREATE OR REPLACE FUNCTION public.guardar_recorrido_rutina(
  p_rutina_id  uuid,
  p_recorrido  jsonb
)
RETURNS TABLE (paradas int, pasos int)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rutina   record;
  v_dup      text;
BEGIN
  IF p_recorrido IS NULL OR jsonb_typeof(p_recorrido) <> 'array' THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: el recorrido debe ser un arreglo de paradas'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_recorrido) e
    WHERE jsonb_typeof(e) <> 'object'
       OR (e ? 'actividades' AND jsonb_typeof(e->'actividades') NOT IN ('array', 'null'))
  ) THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: cada parada es un objeto con un arreglo «actividades»'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- La RLS decide si la rutina «existe» para quien llama: sin permiso, o de otra
  -- empresa, no hay fila que bloquear y la respuesta es la misma.
  SELECT r.id, r.company_id, r.project_id INTO v_rutina
  FROM public.rutinas_limpieza r
  WHERE r.id = p_rutina_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: la rutina % no existe', p_rutina_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Errores de forma ANTES de escribir nada, con un mensaje que se puede
  -- accionar (el 23505 crudo no dice qué área está repetida).
  SELECT e->>'area_id' INTO v_dup
  FROM jsonb_array_elements(p_recorrido) e
  GROUP BY e->>'area_id'
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: el área % aparece dos veces en el recorrido',
      COALESCE(v_dup, '(sin área)')
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT a->>'plantilla_tarea_id' INTO v_dup
  FROM jsonb_array_elements(p_recorrido) WITH ORDINALITY AS z(e, n)
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(z.e->'actividades', 'null'::jsonb), '[]'::jsonb)) a
  GROUP BY z.n, a->>'plantilla_tarea_id'
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'RUTINA_RECORRIDO: la actividad % aparece dos veces en la misma parada', v_dup
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 1 · Paradas que ya no están: se van, y por CASCADE sus pasos.
  DELETE FROM public.rutina_areas ra
  WHERE ra.rutina_id = p_rutina_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_recorrido) e
      WHERE (e->>'area_id')::uuid = ra.area_id
    );

  -- 2 · Paradas nuevas o que cambian de lugar. company/project los sella el
  -- trigger desde la rutina; van igual porque son NOT NULL.
  INSERT INTO public.rutina_areas (company_id, project_id, rutina_id, area_id, orden)
  SELECT v_rutina.company_id, v_rutina.project_id, p_rutina_id,
         (z.e->>'area_id')::uuid, (z.n - 1)::int
  FROM jsonb_array_elements(p_recorrido) WITH ORDINALITY AS z(e, n)
  WHERE z.e->>'area_id' IS NOT NULL
  ON CONFLICT ON CONSTRAINT rutina_areas_unica
  DO UPDATE SET orden = EXCLUDED.orden
  WHERE public.rutina_areas.orden IS DISTINCT FROM EXCLUDED.orden;

  -- 3 · Pasos que ya no están (en su parada): se van.
  DELETE FROM public.rutina_actividades ra
  WHERE ra.rutina_id = p_rutina_id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_recorrido) e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(e->'actividades', 'null'::jsonb), '[]'::jsonb)) a
      LEFT JOIN public.rutina_areas rz
        ON rz.rutina_id = p_rutina_id AND rz.area_id = (e->>'area_id')::uuid
      WHERE (a->>'plantilla_tarea_id')::uuid = ra.plantilla_tarea_id
        AND rz.id IS NOT DISTINCT FROM ra.rutina_area_id
    );

  -- 4 · Pasos nuevos, o que cambian de lugar o de obligatoriedad.
  INSERT INTO public.rutina_actividades (
    company_id, project_id, rutina_id, rutina_area_id, plantilla_tarea_id, orden, obligatoria
  )
  SELECT v_rutina.company_id, v_rutina.project_id, p_rutina_id, rz.id,
         (a.e->>'plantilla_tarea_id')::uuid, (a.n - 1)::int,
         COALESCE((a.e->>'obligatoria')::boolean, true)
  FROM jsonb_array_elements(p_recorrido) z
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(NULLIF(z->'actividades', 'null'::jsonb), '[]'::jsonb))
    WITH ORDINALITY AS a(e, n)
  LEFT JOIN public.rutina_areas rz
    ON rz.rutina_id = p_rutina_id AND rz.area_id = (z->>'area_id')::uuid
  ON CONFLICT ON CONSTRAINT rutina_act_unica_parada
  DO UPDATE SET orden = EXCLUDED.orden, obligatoria = EXCLUDED.obligatoria
  WHERE (public.rutina_actividades.orden, public.rutina_actividades.obligatoria)
        IS DISTINCT FROM (EXCLUDED.orden, EXCLUDED.obligatoria);

  RETURN QUERY
  SELECT (SELECT count(*) FROM public.rutina_areas WHERE rutina_id = p_rutina_id)::int,
         (SELECT count(*) FROM public.rutina_actividades WHERE rutina_id = p_rutina_id)::int;
END;
$$;

COMMENT ON FUNCTION public.guardar_recorrido_rutina(uuid, jsonb) IS
  'Guarda el recorrido COMPLETO de una rutina (paradas en orden y las actividades de cada una) en una transacción: conserva lo que sigue, crea lo nuevo y borra lo que ya no viene. SECURITY INVOKER: escribe bajo la RLS de quien llama. Devuelve cuántas paradas y pasos quedaron.';

REVOKE EXECUTE ON FUNCTION public.guardar_recorrido_rutina(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.guardar_recorrido_rutina(uuid, jsonb) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. materializar_rutinas_turno — el área y el orden salen del recorrido
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma, mismo control y mismos cuatro buckets que 20260907000300; lo
-- que cambia está marcado con «(recorrido)»:
--   · el área de la tarea es la de su parada; el paso legado conserva la regla
--     vieja (la de la actividad o, si no tiene, la de la rutina);
--   · el orden dentro del turno sigue el del recorrido: rutina → parada →
--     paso. Los pasos legados van antes que las paradas;
--   · la parada de un área dada de baja no genera trabajo nuevo, igual que la
--     actividad dada de baja;
--   · «ya existe» compara también el área: es la identidad del índice de §4.
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
      -- (recorrido) El área de la parada. El paso legado (sin parada): la de
      -- la actividad y, si no declara ninguna, la de la rutina. Las tres son
      -- del mismo proyecto por construcción (FKs compuestas de 20260907000200
      -- y de rutina_areas), así que no puede colarse un área ajena.
      COALESCE(rz.area_id, p.area_id, r.area_id) AS area_id,
      p.requiere_foto,
      p.duracion_estimada_min,
      COALESCE(p.checklist, '[]'::jsonb) AS checklist,
      p.instrucciones_seguridad,
      p.requiere_comentario,
      p.requiere_checklist,
      b.estado        AS bloque_estado,
      b.cerrado_en    AS bloque_cerrado_en,
      -- Denso y determinista: el `orden` de la rutina puede tener huecos, y dos
      -- rutinas pueden caer en el mismo bloque. (recorrido) Dentro de la
      -- rutina, primero los pasos legados y después las paradas en su orden.
      row_number() OVER (
        PARTITION BY b.id
        ORDER BY r.orden, r.nombre, r.id,
                 rz.orden NULLS FIRST, rz.id NULLS FIRST,
                 ra.orden, p.titulo, p.id
      ) AS pos,
      -- La fila ya existente cuenta AUNQUE esté anulada: anular es una decisión
      -- y re-materializar no la desautoriza. (recorrido) La identidad incluye
      -- el área, igual que uq_tareas_bloque_plantilla_area.
      EXISTS (
        SELECT 1 FROM public.tareas_bloque tb
        WHERE tb.bloque_id = b.id AND tb.plantilla_id = p.id
          AND tb.area_id IS NOT DISTINCT FROM COALESCE(rz.area_id, p.area_id, r.area_id)
      ) AS ya_existe
    FROM public.rutinas_limpieza  r
    JOIN public.rutina_actividades ra ON ra.rutina_id = r.id
    LEFT JOIN public.rutina_areas  rz ON rz.id = ra.rutina_area_id
    LEFT JOIN public.areas_condominio za ON za.id = rz.area_id
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
      -- (recorrido) Lo mismo para la parada de un área dada de baja.
      AND (rz.id IS NULL OR za.activo)
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
  'Convierte las rutinas activas de un proyecto en tareas de bloques_turno para el rango dado (por defecto 30 días desde hoy), emparejando por jornada. Sigue el recorrido de la rutina: el área de cada tarea es la de su parada y el orden es rutina → parada → paso. Copia lo que la actividad declara; no pisa lo existente ni resucita lo anulado; no toca bloques cerrados ni áreas o actividades dadas de baja. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. La cabecera deja de ser el lugar del área
-- ────────────────────────────────────────────────────────────────────────────
COMMENT ON COLUMN public.rutinas_limpieza.area_id IS
  'LEGADO (20261102000000): el área vive en las paradas del recorrido (rutina_areas). Sólo la usan los pasos sin parada, como área por defecto al materializar. NULL = sin área por defecto.';
