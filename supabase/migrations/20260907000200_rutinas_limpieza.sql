-- ════════════════════════════════════════════════════════════════════════════
-- Rutinas de limpieza: la receta que se materializa en el motor de turnos
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ FALTABA
-- El catálogo de actividades (plantillas_tarea_cargo, 20260904000200) dice QUÉ
-- se hace y con qué recursos (20260904000300), pero no había forma de agrupar
-- varias actividades en una unidad de trabajo repetible — "la rutina matutina
-- de la piscina" — ni de decir en qué jornada corre. Sin eso, cada turno se
-- arma a mano eligiendo actividades sueltas, y lo que se armó ayer no se
-- puede repetir mañana.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   · rutinas_limpieza   — la cabecera: nombre, área opcional, servicio y la
--     jornada (plantillas_horario) en la que corre.
--   · rutina_actividades — las actividades que la componen, ordenadas, cada
--     una obligatoria o no.
--
-- ES DEFINICIÓN, NO EJECUCIÓN. Aquí no hay fechas, ni personal asignado, ni
-- tareas hechas. La materialización rutina → tareas_bloque llega en el PR
-- siguiente; esta migración solo deja la receta y sus garantías.
--
-- POR QUÉ AHORA VALE LA PENA MATERIALIZAR. Hasta 20260907000100,
-- `tareas_bloque` perdía todo lo que el catálogo sabe: no tenía dónde poner
-- duración, checklist, instrucciones de seguridad ni quién cerró. Con la
-- paridad ya puesta, una rutina materializada conserva
-- `duracion_estimada_min`, `checklist`, `instrucciones_seguridad`,
-- `requiere_comentario`, `requiere_checklist` y los recursos planificados.
--
-- TENANT — el mismo molde de 20260904000300, sin reinventarlo:
--   · FKs COMPUESTAS (id, company_id, project_id) hacia área, jornada,
--     rutina y actividad. El motor sostiene la coherencia DURANTE TODA LA VIDA
--     de la fila: mover a otra empresa/proyecto algo ya relacionado viola la FK
--     y se bloquea — cosa que un trigger sobre la hija no puede ver.
--   · Un trigger BEFORE sella company_id/project_id de la hija desde su rutina
--     e ignora lo que mande el cliente, y aborta con error legible si la
--     actividad es de otra empresa u otro proyecto.
--   Las anclas UNIQUE de plantillas_tarea_cargo viven en 20260904000200; las de
--   areas_condominio y plantillas_horario se agregan aquí.
--
-- OJO CON LAS FKs COMPUESTAS Y LAS COLUMNAS NULABLES. `area_id` y
-- `plantilla_horario_id` son opcionales. En MATCH SIMPLE (el default de
-- PostgreSQL) una FK compuesta con CUALQUIER columna NULL no se verifica — que
-- es justo lo que queremos: rutina sin área declarada, o sin jornada fija. Con
-- MATCH FULL sería un error, porque company_id/project_id son NOT NULL.
--
-- BORRADO:
--   · rutina_actividades → rutina: CASCADE. Los pasos son parte de la
--     definición de la rutina, no historial: si la receta se va, se van.
--   · rutina_actividades → actividad: RESTRICT. Una actividad usada por alguna
--     rutina no se borra físicamente; su baja es activo=false.
--   · rutinas_limpieza → área / jornada: RESTRICT, mismo criterio.
--
-- SIN bitácora: son catálogo, no hechos (criterio de 20260731000100:178-182).
--
-- RBAC: gate `condominios.tab.prog_limpieza`. Las rutinas son de Limpieza
-- (rol Operaciones); no se reparte ningún permiso del módulo Seguridad, igual
-- que hizo el SELECT de plantillas en 20260904000200.
--
-- IDEMPOTENTE: sí — CREATE TABLE/INDEX IF NOT EXISTS, DO $$ guardado por
-- pg_constraint y DROP IF EXISTS antes de cada trigger/policy.
--
-- REVERSA: DROP TABLE public.rutina_actividades, public.rutinas_limpieza;
-- DROP FUNCTION public.rutina_actividad_coherente();
-- ALTER TABLE public.areas_condominio    DROP CONSTRAINT areas_id_tenant_uq;
-- ALTER TABLE public.plantillas_horario  DROP CONSTRAINT plantillas_horario_id_tenant_uq;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Anclas UNIQUE para las FKs compuestas
-- ────────────────────────────────────────────────────────────────────────────
-- (la de plantillas_tarea_cargo vive en 20260904000200)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'areas_id_tenant_uq') THEN
    ALTER TABLE public.areas_condominio
      ADD CONSTRAINT areas_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plantillas_horario_id_tenant_uq') THEN
    ALTER TABLE public.plantillas_horario
      ADD CONSTRAINT plantillas_horario_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. rutinas_limpieza — la cabecera de la receta
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rutinas_limpieza (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre               text        NOT NULL,
  descripcion          text,
  area_id              uuid,
  servicio             text        NOT NULL DEFAULT 'limpieza',
  plantilla_horario_id uuid,
  activa               boolean     NOT NULL DEFAULT true,
  orden                int         NOT NULL DEFAULT 0,
  creado_por           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- El nombre es lo que la distingue en la UI: en blanco no identifica nada.
  CONSTRAINT rutinas_limpieza_nombre_check CHECK (btrim(nombre) <> ''),
  -- Mismo dominio que plantillas_cargo_servicio_check (20260904000200), sin el
  -- NULL: una rutina nueva siempre declara a qué servicio pertenece.
  CONSTRAINT rutinas_limpieza_servicio_check CHECK (servicio IN
    ('limpieza', 'mantenimiento', 'seguridad', 'jardineria', 'administracion', 'otro')),
  -- Ancla para la FK compuesta de rutina_actividades.
  CONSTRAINT rutinas_id_tenant_uq UNIQUE (id, company_id, project_id),
  CONSTRAINT rutinas_limpieza_area_fk
    FOREIGN KEY (area_id, company_id, project_id)
    REFERENCES public.areas_condominio(id, company_id, project_id) ON DELETE RESTRICT,
  CONSTRAINT rutinas_limpieza_horario_fk
    FOREIGN KEY (plantilla_horario_id, company_id, project_id)
    REFERENCES public.plantillas_horario(id, company_id, project_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.rutinas_limpieza IS
  'Receta repetible: un conjunto ordenado de actividades del catálogo que se ejecuta junto. Es DEFINICIÓN — la ocurrencia del día se materializa en tareas_bloque.';
COMMENT ON COLUMN public.rutinas_limpieza.area_id IS
  'Área del catálogo donde corre la rutina. NULL = rutina general (no atada a una zona). La FK compuesta la congela al tenant de la rutina.';
COMMENT ON COLUMN public.rutinas_limpieza.plantilla_horario_id IS
  'Jornada en la que corre (plantillas_horario, 20260820000000). NULL = sin jornada fija; la decide quien materialice.';
COMMENT ON COLUMN public.rutinas_limpieza.activa IS
  'false = retirada de circulación sin borrar. La baja de una rutina es esto, no un DELETE: sus actividades siguen siendo trazables.';
COMMENT ON COLUMN public.rutinas_limpieza.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

-- Dos rutinas con el mismo nombre en un proyecto son un error de captura, no
-- una decisión: se reutiliza el normalizador de 20260904000100 (minúsculas,
-- sin acentos ni signos) en vez de escribir un segundo idéntico que podría
-- divergir. Total, no parcial por `activa`: chocar con una rutina inactiva
-- también es un duplicado — se reactiva, no se recrea.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rutinas_nombre_normalizado
  ON public.rutinas_limpieza (project_id, public.areas_normalizar_nombre(nombre));

CREATE INDEX IF NOT EXISTS idx_rutinas_project ON public.rutinas_limpieza(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_rutinas_area    ON public.rutinas_limpieza(area_id) WHERE area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rutinas_horario ON public.rutinas_limpieza(plantilla_horario_id) WHERE plantilla_horario_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. rutina_actividades — los pasos
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rutina_actividades (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  rutina_id          uuid        NOT NULL,
  plantilla_tarea_id uuid        NOT NULL,
  orden              int         NOT NULL DEFAULT 0,
  obligatoria        boolean     NOT NULL DEFAULT true,
  notas              text,
  creado_por         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- La misma actividad dos veces en la misma rutina es duplicado, no repetición
  -- deliberada: al materializar produciría dos tareas idénticas que nadie sabe
  -- distinguir (el mismo criterio que uq_tareas_bloque_plantilla, 20260907000100).
  CONSTRAINT rutina_act_unica UNIQUE (rutina_id, plantilla_tarea_id),
  CONSTRAINT rutina_act_rutina_fk
    FOREIGN KEY (rutina_id, company_id, project_id)
    REFERENCES public.rutinas_limpieza(id, company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT rutina_act_plantilla_fk
    FOREIGN KEY (plantilla_tarea_id, company_id, project_id)
    REFERENCES public.plantillas_tarea_cargo(id, company_id, project_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.rutina_actividades IS
  'Actividades que componen una rutina, ordenadas (rutinas_limpieza ↔ plantillas_tarea_cargo).';
COMMENT ON COLUMN public.rutina_actividades.obligatoria IS
  'false = paso opcional; la rutina se da por cumplida sin él. Se aplica al materializar, en PRs posteriores.';
COMMENT ON COLUMN public.rutina_actividades.company_id IS
  'Denormalizado de la rutina. Lo sella la BD (rutina_actividad_coherente); lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.rutina_actividades.project_id IS
  'Denormalizado de la rutina. Lo sella la BD (rutina_actividad_coherente); lo que mande el cliente se ignora.';

-- El UNIQUE ya indexa por rutina_id; falta la FK de la actividad (para el
-- RESTRICT y los listados por actividad) y el par project/company (loaders).
CREATE INDEX IF NOT EXISTS idx_rutina_act_plantilla ON public.rutina_actividades(plantilla_tarea_id);
CREATE INDEX IF NOT EXISTS idx_rutina_act_project   ON public.rutina_actividades(project_id, company_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Coherencia de tenant: sellar desde la rutina, validar la actividad
-- ────────────────────────────────────────────────────────────────────────────
-- Gemela de plantilla_recurso_coherente (20260904000300), con el padre en
-- `rutina_id` en vez de `plantilla_tarea_id`. SECURITY DEFINER por el mismo
-- motivo (20260729000600:72-90): con INVOKER, la RLS de la actividad ajena
-- haría que la fila "no exista" y el error mentiría; el punto es distinguir
-- "no existe" de "es de otro tenant" y abortar con el código correcto.
CREATE OR REPLACE FUNCTION public.rutina_actividad_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rutina      record;
  v_act_company uuid;
  v_act_project uuid;
BEGIN
  SELECT company_id, project_id INTO v_rutina
  FROM public.rutinas_limpieza
  WHERE id = NEW.rutina_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RUTINA_ACTIVIDAD: la rutina % no existe', NEW.rutina_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- El tenant lo define la rutina; lo que mande el cliente se ignora.
  NEW.company_id := v_rutina.company_id;
  NEW.project_id := v_rutina.project_id;

  SELECT company_id, project_id INTO v_act_company, v_act_project
  FROM public.plantillas_tarea_cargo
  WHERE id = NEW.plantilla_tarea_id;

  -- company_id es NOT NULL en el catálogo: NULL aquí = la fila no existe.
  IF v_act_company IS NULL THEN
    RAISE EXCEPTION 'RUTINA_ACTIVIDAD: la actividad % no existe', NEW.plantilla_tarea_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_act_company IS DISTINCT FROM v_rutina.company_id
     OR v_act_project IS DISTINCT FROM v_rutina.project_id THEN
    RAISE EXCEPTION 'RUTINA_ACTIVIDAD: la actividad % pertenece a otra empresa o a otro proyecto que la rutina %',
      NEW.plantilla_tarea_id, NEW.rutina_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
-- Solo la invoca el trigger; nadie la llama directo.
REVOKE EXECUTE ON FUNCTION public.rutina_actividad_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rutina_act_coherente ON public.rutina_actividades;
CREATE TRIGGER trg_rutina_act_coherente
  BEFORE INSERT OR UPDATE OF rutina_id, plantilla_tarea_id, company_id, project_id
  ON public.rutina_actividades
  FOR EACH ROW EXECUTE FUNCTION public.rutina_actividad_coherente();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Trazabilidad (20260731000000)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.rutinas_limpieza;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.rutinas_limpieza
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.rutina_actividades;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.rutina_actividades
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

COMMENT ON COLUMN public.rutina_actividades.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ────────────────────────────────────────────────────────────────────────────
-- Gate único: `condominios.tab.prog_limpieza`. Las rutinas son de Limpieza;
-- no se reparte ningún permiso del módulo Seguridad para administrarlas.
--
-- DELETE con el permiso del tab y NO con owner/admin — misma desviación
-- deliberada que 20260904000300: quitar un paso de una rutina es edición de
-- catálogo, no destrucción de historial (el historial lo protegen los RESTRICT
-- de esta serie y la anulación lógica de 20260907000100). Con owner/admin, el
-- operador que sí puede editar la rutina sufriría deletes silenciosos de
-- 0 filas.
ALTER TABLE public.rutinas_limpieza   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rutina_actividades ENABLE ROW LEVEL SECURITY;

-- GRANTs explícitos de mínimo privilegio: anon no toca las tablas nuevas;
-- authenticated pasa por RLS; service_role las administra (jobs de sistema).
REVOKE ALL ON public.rutinas_limpieza, public.rutina_actividades FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.rutinas_limpieza, public.rutina_actividades
  TO authenticated;
GRANT ALL ON public.rutinas_limpieza, public.rutina_actividades TO service_role;

DROP POLICY IF EXISTS "rutinas_limpieza_select" ON public.rutinas_limpieza;
CREATE POLICY "rutinas_limpieza_select" ON public.rutinas_limpieza
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutinas_limpieza_insert" ON public.rutinas_limpieza;
CREATE POLICY "rutinas_limpieza_insert" ON public.rutinas_limpieza
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutinas_limpieza_update" ON public.rutinas_limpieza;
CREATE POLICY "rutinas_limpieza_update" ON public.rutinas_limpieza
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

DROP POLICY IF EXISTS "rutinas_limpieza_delete" ON public.rutinas_limpieza;
CREATE POLICY "rutinas_limpieza_delete" ON public.rutinas_limpieza
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

-- La hija deriva el tenant de company_id propio (lo sella el trigger), no de un
-- EXISTS sobre la rutina: así el gate NO queda encadenado a la RLS del padre
-- —la trampa que costó el assert 7 de 20260907000100— y una rutina invisible
-- no puede dejar pasos huérfanos visibles, porque el company_id es el mismo.
DROP POLICY IF EXISTS "rutina_actividades_select" ON public.rutina_actividades;
CREATE POLICY "rutina_actividades_select" ON public.rutina_actividades
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutina_actividades_insert" ON public.rutina_actividades;
CREATE POLICY "rutina_actividades_insert" ON public.rutina_actividades
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "rutina_actividades_update" ON public.rutina_actividades;
CREATE POLICY "rutina_actividades_update" ON public.rutina_actividades
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

DROP POLICY IF EXISTS "rutina_actividades_delete" ON public.rutina_actividades;
CREATE POLICY "rutina_actividades_delete" ON public.rutina_actividades
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.prog_limpieza')))
  );
