-- ════════════════════════════════════════════════════════════════════════════
-- Recursos planificados por actividad: insumos y herramientas
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ FALTABA
-- El catálogo de actividades (plantillas_tarea_cargo, extendido en
-- 20260904000100) no decía QUÉ se necesita para ejecutar cada actividad. Los
-- catálogos ya existen — `suministros_condominio` (insumos, con su
-- unidad_medida) e `inventario_condominio` (herramientas y equipo) — pero no
-- había relación normalizada actividad ↔ recurso.
--
-- LO QUE HACE ESTA MIGRACIÓN
-- Dos tablas puente, molde de `orden_compra_lineas` (20260821000100):
--   · plantilla_tarea_suministros:  actividad ↔ insumo + cantidad planificada.
--     SIN columna `unidad`: se deriva de suministros_condominio.unidad_medida
--     (duplicarla aquí solo crearía divergencia).
--   · plantilla_tarea_herramientas: actividad ↔ herramienta + cantidad +
--     bandera de obligatoria.
-- Esto es PLANIFICACIÓN pura: no hay consumo real, reserva ni descuento de
-- existencias (eso llega en PRs posteriores; el stock además lo protege
-- trg_suministros_guard_stock, 20260821000200).
--
-- TENANT — DOS capas que se complementan:
--   · Un trigger BEFORE sella company_id/project_id desde la plantilla
--     ignorando al cliente (patrón set_project_id_desde_padre, 20260729000600)
--     y aborta con un error legible si el recurso es de otra empresa u otro
--     proyecto (patrón conta_tg_linea_mismo_ledger, 20260813120000).
--   · FKs COMPUESTAS (id, company_id, project_id) hacia la plantilla y hacia
--     el recurso: el motor garantiza la coherencia DURANTE TODA LA VIDA de la
--     fila — mover una plantilla, un suministro o una herramienta ya
--     relacionados a otra empresa/proyecto viola la FK del hijo y se bloquea,
--     cosa que un trigger sobre el hijo no puede ver. Las anclas UNIQUE
--     (id, company_id, project_id) de los padres viven en 20260904000100
--     (plantillas) y aquí (suministros/inventario).
--
-- BORRADO: la FK a la plantilla es CASCADE (el vínculo es parte de la
-- definición de la actividad, no historial); las FK al recurso son RESTRICT
-- (un insumo/herramienta vinculado no se borra físicamente: su baja es
-- activo=false / estado='dado_de_baja').
--
-- SIN bitácora: son catálogo, no hechos (criterio de 20260731000100:178-182).
--
-- IDEMPOTENTE: sí — CREATE TABLE/INDEX IF NOT EXISTS y DROP IF EXISTS antes de
-- cada trigger/policy, como el resto del módulo Condominios (asignaciones_turno,
-- 20260820000000). El sandbox de supabase/tests/limpieza_catalogos re-aplica la
-- serie completa para demostrarlo.
--
-- REVERSA: DROP TABLE public.plantilla_tarea_suministros,
-- public.plantilla_tarea_herramientas;
-- DROP FUNCTION public.plantilla_recurso_coherente();
-- DROP CONSTRAINT suministros_id_tenant_uq / inventario_id_tenant_uq.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Anclas UNIQUE para las FKs compuestas
-- ────────────────────────────────────────────────────────────────────────────
-- (la de plantillas_tarea_cargo vive en 20260904000100)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suministros_id_tenant_uq') THEN
    ALTER TABLE public.suministros_condominio
      ADD CONSTRAINT suministros_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventario_id_tenant_uq') THEN
    ALTER TABLE public.inventario_condominio
      ADD CONSTRAINT inventario_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tablas
-- ────────────────────────────────────────────────────────────────────────────
-- `cantidad` en numeric(10,2): la misma precisión que el stock del inventario
-- de suministros (stock_actual numeric(10,2), 20260420000021) — planificar con
-- más decimales de los que el stock puede registrar solo fabrica descuadres.
CREATE TABLE IF NOT EXISTS public.plantilla_tarea_suministros (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid          NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  plantilla_tarea_id uuid          NOT NULL,
  suministro_id      uuid          NOT NULL,
  cantidad           numeric(10,2) NOT NULL DEFAULT 1,
  notas              text,
  creado_por         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pt_suministro_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT pt_suministro_unico UNIQUE (plantilla_tarea_id, suministro_id),
  -- FKs compuestas: la coherencia de tenant la garantiza el motor de por vida.
  CONSTRAINT pt_suministro_plantilla_fk
    FOREIGN KEY (plantilla_tarea_id, company_id, project_id)
    REFERENCES public.plantillas_tarea_cargo(id, company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT pt_suministro_recurso_fk
    FOREIGN KEY (suministro_id, company_id, project_id)
    REFERENCES public.suministros_condominio(id, company_id, project_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.plantilla_tarea_suministros IS
  'Insumos planificados por actividad (plantillas_tarea_cargo ↔ suministros_condominio). Planificación pura: sin consumo ni descuento de stock.';
COMMENT ON COLUMN public.plantilla_tarea_suministros.cantidad IS
  'Cantidad planificada por ejecución, en la unidad_medida del suministro (por eso aquí no hay columna de unidad).';
COMMENT ON COLUMN public.plantilla_tarea_suministros.company_id IS
  'Denormalizado de la plantilla. Lo sella la BD (plantilla_recurso_coherente); lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.plantilla_tarea_suministros.project_id IS
  'Denormalizado de la plantilla. Lo sella la BD (plantilla_recurso_coherente); lo que mande el cliente se ignora.';

-- `cantidad` int: el inventario cuenta unidades enteras (cantidad int,
-- 20260420000004).
CREATE TABLE IF NOT EXISTS public.plantilla_tarea_herramientas (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  plantilla_tarea_id uuid        NOT NULL,
  inventario_id      uuid        NOT NULL,
  cantidad           int         NOT NULL DEFAULT 1,
  obligatoria        boolean     NOT NULL DEFAULT false,
  notas              text,
  creado_por         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pt_herramienta_cantidad_check CHECK (cantidad > 0),
  CONSTRAINT pt_herramienta_unica UNIQUE (plantilla_tarea_id, inventario_id),
  CONSTRAINT pt_herramienta_plantilla_fk
    FOREIGN KEY (plantilla_tarea_id, company_id, project_id)
    REFERENCES public.plantillas_tarea_cargo(id, company_id, project_id) ON DELETE CASCADE,
  CONSTRAINT pt_herramienta_recurso_fk
    FOREIGN KEY (inventario_id, company_id, project_id)
    REFERENCES public.inventario_condominio(id, company_id, project_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.plantilla_tarea_herramientas IS
  'Herramientas/equipo planificados por actividad (plantillas_tarea_cargo ↔ inventario_condominio).';
COMMENT ON COLUMN public.plantilla_tarea_herramientas.obligatoria IS
  'true = la ejecución no debería iniciarse sin esta herramienta (se aplica al materializar, en PRs posteriores).';
COMMENT ON COLUMN public.plantilla_tarea_herramientas.company_id IS
  'Denormalizado de la plantilla. Lo sella la BD (plantilla_recurso_coherente); lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.plantilla_tarea_herramientas.project_id IS
  'Denormalizado de la plantilla. Lo sella la BD (plantilla_recurso_coherente); lo que mande el cliente se ignora.';

-- El UNIQUE ya indexa por plantilla_tarea_id; faltan la FK del recurso (para
-- el RESTRICT y los listados por recurso) y el par project/company (scope de
-- los loaders).
CREATE INDEX IF NOT EXISTS idx_pt_suministros_suministro  ON public.plantilla_tarea_suministros(suministro_id);
CREATE INDEX IF NOT EXISTS idx_pt_suministros_project     ON public.plantilla_tarea_suministros(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_pt_herramientas_inventario ON public.plantilla_tarea_herramientas(inventario_id);
CREATE INDEX IF NOT EXISTS idx_pt_herramientas_project    ON public.plantilla_tarea_herramientas(project_id, company_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Coherencia de tenant: sellar desde la plantilla, validar el recurso
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER por el mismo motivo que set_project_id_desde_padre
-- (20260729000600:72-90): con INVOKER, la RLS del recurso ajeno haría que la
-- fila "no exista" y el error mentiría; el punto es distinguir "no existe" de
-- "es de otro tenant" y abortar con el código correcto.
-- TG_ARGV = (tabla_recurso, columna_fk) — una sola función para ambas puentes.
CREATE OR REPLACE FUNCTION public.plantilla_recurso_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tabla       text := TG_ARGV[0];
  v_col         text := TG_ARGV[1];
  v_recurso     uuid;
  v_plantilla   record;
  v_rec_company uuid;
  v_rec_project uuid;
BEGIN
  v_recurso := (to_jsonb(NEW) ->> v_col)::uuid;

  SELECT company_id, project_id INTO v_plantilla
  FROM public.plantillas_tarea_cargo
  WHERE id = NEW.plantilla_tarea_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: la plantilla % no existe', NEW.plantilla_tarea_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- El tenant lo define la plantilla; lo que mande el cliente se ignora.
  NEW.company_id := v_plantilla.company_id;
  NEW.project_id := v_plantilla.project_id;

  EXECUTE format('SELECT company_id, project_id FROM public.%I WHERE id = $1', v_tabla)
    INTO v_rec_company, v_rec_project
    USING v_recurso;

  -- company_id es NOT NULL en ambos catálogos: NULL aquí = la fila no existe.
  IF v_rec_company IS NULL THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: %.% = % no existe', v_tabla, v_col, v_recurso
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_rec_company IS DISTINCT FROM v_plantilla.company_id
     OR v_rec_project IS DISTINCT FROM v_plantilla.project_id THEN
    RAISE EXCEPTION 'PLANTILLA_RECURSO: el recurso % de %.% pertenece a otra empresa o a otro proyecto que la plantilla %',
      v_recurso, v_tabla, v_col, NEW.plantilla_tarea_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
-- Solo la invocan los triggers; nadie la llama directo.
REVOKE EXECUTE ON FUNCTION public.plantilla_recurso_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pt_sum_coherente ON public.plantilla_tarea_suministros;
CREATE TRIGGER trg_pt_sum_coherente
  BEFORE INSERT OR UPDATE OF plantilla_tarea_id, suministro_id, company_id, project_id
  ON public.plantilla_tarea_suministros
  FOR EACH ROW EXECUTE FUNCTION public.plantilla_recurso_coherente('suministros_condominio', 'suministro_id');

DROP TRIGGER IF EXISTS trg_pt_her_coherente ON public.plantilla_tarea_herramientas;
CREATE TRIGGER trg_pt_her_coherente
  BEFORE INSERT OR UPDATE OF plantilla_tarea_id, inventario_id, company_id, project_id
  ON public.plantilla_tarea_herramientas
  FOR EACH ROW EXECUTE FUNCTION public.plantilla_recurso_coherente('inventario_condominio', 'inventario_id');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Trazabilidad (20260731000000)
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.plantilla_tarea_suministros;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.plantilla_tarea_suministros
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.plantilla_tarea_herramientas;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.plantilla_tarea_herramientas
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

COMMENT ON COLUMN public.plantilla_tarea_suministros.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';
COMMENT ON COLUMN public.plantilla_tarea_herramientas.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ────────────────────────────────────────────────────────────────────────────
-- Molde de 20260807130000:144-185. SELECT acepta también `tareas_personal` y
-- `prog_limpieza` (mismo criterio que el SELECT del padre en 20260904000100:
-- esos tabs consumen el catálogo de actividades y sus recursos sin permisos
-- del módulo Seguridad). El DELETE va con el permiso
-- del tab y NO con owner/admin — desviación deliberada del convenio: quitar un
-- insumo de una plantilla es edición de catálogo, no destrucción de historial
-- (el historial lo protegen los RESTRICT de esta serie); con owner/admin, el
-- operador que sí puede editar la plantilla sufriría deletes silenciosos de
-- 0 filas.
ALTER TABLE public.plantilla_tarea_suministros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantilla_tarea_herramientas ENABLE ROW LEVEL SECURITY;

-- GRANTs explícitos de mínimo privilegio: anon no toca las tablas nuevas;
-- authenticated pasa por RLS; service_role las administra (jobs de sistema).
REVOKE ALL ON public.plantilla_tarea_suministros, public.plantilla_tarea_herramientas FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.plantilla_tarea_suministros, public.plantilla_tarea_herramientas
  TO authenticated;
GRANT ALL ON public.plantilla_tarea_suministros, public.plantilla_tarea_herramientas TO service_role;

DROP POLICY IF EXISTS "plantilla_tarea_suministros_select" ON public.plantilla_tarea_suministros;
CREATE POLICY "plantilla_tarea_suministros_select" ON public.plantilla_tarea_suministros
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')
             OR public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "plantilla_tarea_suministros_insert" ON public.plantilla_tarea_suministros;
CREATE POLICY "plantilla_tarea_suministros_insert" ON public.plantilla_tarea_suministros
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  );

DROP POLICY IF EXISTS "plantilla_tarea_suministros_update" ON public.plantilla_tarea_suministros;
CREATE POLICY "plantilla_tarea_suministros_update" ON public.plantilla_tarea_suministros
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

DROP POLICY IF EXISTS "plantilla_tarea_suministros_delete" ON public.plantilla_tarea_suministros;
CREATE POLICY "plantilla_tarea_suministros_delete" ON public.plantilla_tarea_suministros
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  );

DROP POLICY IF EXISTS "plantilla_tarea_herramientas_select" ON public.plantilla_tarea_herramientas;
CREATE POLICY "plantilla_tarea_herramientas_select" ON public.plantilla_tarea_herramientas
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')
             OR public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

DROP POLICY IF EXISTS "plantilla_tarea_herramientas_insert" ON public.plantilla_tarea_herramientas;
CREATE POLICY "plantilla_tarea_herramientas_insert" ON public.plantilla_tarea_herramientas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  );

DROP POLICY IF EXISTS "plantilla_tarea_herramientas_update" ON public.plantilla_tarea_herramientas;
CREATE POLICY "plantilla_tarea_herramientas_update" ON public.plantilla_tarea_herramientas
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

DROP POLICY IF EXISTS "plantilla_tarea_herramientas_delete" ON public.plantilla_tarea_herramientas;
CREATE POLICY "plantilla_tarea_herramientas_delete" ON public.plantilla_tarea_herramientas
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.plantillas_cargo')))
  );
