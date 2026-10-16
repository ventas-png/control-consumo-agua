-- ════════════════════════════════════════════════════════════════════════════
-- RECURSOS HUMANOS · CONFIGURACIÓN: CATÁLOGOS DE CARGOS Y TIPOS DE TURNO POR CONDOMINIO
--
-- QUÉ HABÍA
--   · Los cargos del personal (conserje, guardia, jardinero, mantenimiento, administrador,
--     otro) y el turno del expediente (diurno, nocturno, rotativo) estaban escritos a mano
--     en la base: el trigger `plantillas_cargo_valida_cargo()` (20260904000400 §4), los
--     CHECK `prog_limpieza_cargo_check` / `prog_limpieza_turno_check` /
--     `ejec_limpieza_turno_check` (20260807130000) y la lista `v_cargos` de
--     `plantillas_import_evaluar` (20261031000200). `personal_condominio.cargo/turno` no
--     tenían validación alguna. Agregar un cargo exigía una migración.
--
-- QUÉ HACE
--   1. RBAC del tab nuevo `condominios.tab.rrhh_config` (Recursos Humanos → Configuración).
--   2. Dos catálogos POR CONDOMINIO, gemelos: `rrhh_cargos` y `rrhh_tipos_turno`
--      (código inmutable, nombre único por proyecto, ícono, orden, activo).
--   3. RLS: lectura por empresa + acceso al proyecto; crear/editar por permiso del tab;
--      borrar por permiso del tab, y sólo si NADIE lo usa (trigger, 23503).
--   4. Siembra: cada condominio existente recibe los 6 cargos y 3 turnos de siempre; cada
--      condominio nuevo los recibe al nacer (trigger en `projects`). Nada cambia de valor.
--   5. Validadores `rrhh_cargo_valido` / `rrhh_turno_valido` y triggers que los aplican en
--      personal, actividades (plantillas), programación y ejecuciones de limpieza. Los CHECK
--      literales se retiran DESPUÉS de instalar los triggers (nunca hay una ventana sin regla).
--   6. `rrhh_cargo_en_uso` / `rrhh_turno_en_uso` para que la pantalla muestre «en uso: N».
--   7. `plantillas_import_evaluar` lee los cargos ACTIVOS del condominio (acepta código o
--      nombre de pantalla).
--
-- REGLAS
--   · El turno del catálogo es el del EXPEDIENTE del empleado (diurno/nocturno/rotativo).
--     Las jornadas de «Asignación de turnos» (plantillas_horario / bloques_turno:
--     mañana/tarde/noche) NO se tocan.
--   · Desactivar, nunca borrar: un cargo o turno inactivo deja de ofrecerse en los selects
--     pero las filas que lo tienen siguen siendo válidas y editables (los triggers sólo
--     validan cuando el valor CAMBIA: `IS DISTINCT FROM`). Borrar sólo si nadie lo usa.
--   · Los triggers normalizan el valor a su código (`lower(btrim(…))`): « Conserje » se
--     guarda como `conserje`, que es lo que enlaza con el catálogo.
--   · `ejecuciones_limpieza.turno` es un registro derivado: exige que el turno EXISTA en
--     el catálogo, activo o no.
--   · Código: slug `^[a-z0-9][a-z0-9_]{0,39}$`, inmutable una vez creado (es la clave que
--     guardan personal, actividades y programaciones). Se renombra el nombre de pantalla,
--     nunca el código.
--
-- CÓMO REVERTIR: scripts/reversion-rrhh-catalogos.sql
-- IMPACTO EN DATOS PRODUCTIVOS: ninguna fila existente cambia de valor; se insertan los
--   catálogos por defecto en cada proyecto (6 + 3 filas por condominio).
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY/TRIGGER/
--   CONSTRAINT IF EXISTS, ON CONFLICT DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Catálogo RBAC del tab `rrhh_config`
-- ────────────────────────────────────────────────────────────────────────────
-- Clave base = visibilidad ("Ver"), convención de 20260518000005. La categoría es
-- `recursos_humanos` porque ahí vive la sección que lo hospeda (sections.ts).
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.rrhh_config', 'recursos_humanos', 'Configuración RRHH',
   'Catálogos de cargos y tipos de turno del condominio (rrhh_cargos, rrhh_tipos_turno). Los consumen Personal, Actividades, Programación de limpieza y la carga masiva.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.permissions (key, category, label, description)
SELECT
  p.key || '.' || a.akey,
  p.category,
  a.alabel || ' — ' || p.label,
  a.alabel || ' en ' || p.label
FROM public.permissions p
CROSS JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS a(akey, alabel)
WHERE p.key = 'condominios.tab.rrhh_config'
ON CONFLICT (key) DO NOTHING;

-- Herencia: quien ya administra el expediente del personal (ALLOW sobre la clave
-- homónima de `personal`) recibe la misma acción sobre la configuración. El efecto se
-- fuerza a 'allow' y sólo se copian filas 'allow': un deny sobre Personal no se
-- propaga a ciegas (los deny se ponen desde el editor de roles).
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT DISTINCT rp.role_id,
       'condominios.tab.rrhh_config' || substr(rp.permission_key, length('condominios.tab.personal') + 1),
       'allow'
FROM public.role_permissions rp
WHERE rp.effect = 'allow'
  AND (rp.permission_key = 'condominios.tab.personal'
       OR rp.permission_key LIKE 'condominios.tab.personal.%')
  AND substr(rp.permission_key, length('condominios.tab.personal') + 1)
      IN ('', '.create', '.edit', '.change_status', '.approve', '.delete')
ON CONFLICT DO NOTHING;

-- Administrador General (id fijo de 20260518000006): acceso completo, explícito.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key = 'condominios.tab.rrhh_config'
   OR p.key LIKE 'condominios.tab.rrhh\_config.%'
ON CONFLICT DO NOTHING;

-- Guarda de postcondición (un INSERT que no inserta nada no es error).
DO $$
DECLARE
  v_claves int;
BEGIN
  SELECT count(*) INTO v_claves
  FROM public.permissions
  WHERE key = 'condominios.tab.rrhh_config'
     OR key LIKE 'condominios.tab.rrhh\_config.%';
  IF v_claves <> 6 THEN
    RAISE EXCEPTION 'rrhh_config: se esperaban 6 claves en el catálogo RBAC (base + 5 acciones), hay %', v_claves;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Los dos catálogos
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rrhh_cargos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  codigo      text        NOT NULL,
  nombre      text        NOT NULL,
  descripcion text,
  icono       text        NOT NULL DEFAULT '👤',
  orden       int         NOT NULL DEFAULT 0,
  activo      boolean     NOT NULL DEFAULT true,
  creado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rrhh_cargos_codigo_check CHECK (codigo ~ '^[a-z0-9][a-z0-9_]{0,39}$'),
  CONSTRAINT rrhh_cargos_nombre_check CHECK (length(btrim(nombre)) BETWEEN 2 AND 60),
  CONSTRAINT rrhh_cargos_icono_check  CHECK (length(icono) BETWEEN 1 AND 8),
  CONSTRAINT rrhh_cargos_orden_check  CHECK (orden >= 0),
  CONSTRAINT rrhh_cargos_descripcion_check CHECK (descripcion IS NULL OR length(descripcion) <= 300),
  CONSTRAINT rrhh_cargos_proyecto_codigo_uk UNIQUE (project_id, codigo),
  CONSTRAINT rrhh_cargos_id_tenant_uk       UNIQUE (id, company_id, project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS rrhh_cargos_proyecto_nombre_uk
  ON public.rrhh_cargos (project_id, lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS idx_rrhh_cargos_proyecto
  ON public.rrhh_cargos (project_id, activo, orden);

CREATE TABLE IF NOT EXISTS public.rrhh_tipos_turno (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  codigo      text        NOT NULL,
  nombre      text        NOT NULL,
  descripcion text,
  icono       text        NOT NULL DEFAULT '☀️',
  orden       int         NOT NULL DEFAULT 0,
  activo      boolean     NOT NULL DEFAULT true,
  creado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rrhh_turnos_codigo_check CHECK (codigo ~ '^[a-z0-9][a-z0-9_]{0,39}$'),
  CONSTRAINT rrhh_turnos_nombre_check CHECK (length(btrim(nombre)) BETWEEN 2 AND 60),
  CONSTRAINT rrhh_turnos_icono_check  CHECK (length(icono) BETWEEN 1 AND 8),
  CONSTRAINT rrhh_turnos_orden_check  CHECK (orden >= 0),
  CONSTRAINT rrhh_turnos_descripcion_check CHECK (descripcion IS NULL OR length(descripcion) <= 300),
  CONSTRAINT rrhh_turnos_proyecto_codigo_uk UNIQUE (project_id, codigo),
  CONSTRAINT rrhh_turnos_id_tenant_uk       UNIQUE (id, company_id, project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS rrhh_turnos_proyecto_nombre_uk
  ON public.rrhh_tipos_turno (project_id, lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS idx_rrhh_turnos_proyecto
  ON public.rrhh_tipos_turno (project_id, activo, orden);

COMMENT ON TABLE public.rrhh_cargos IS
  'Catálogo de cargos del personal POR CONDOMINIO. `codigo` es la clave que guardan personal_condominio.cargo, plantillas_tarea_cargo.cargo y programacion_limpieza.cargo; inmutable. Desactivar, no borrar: borrar sólo si nadie lo usa (trigger rrhh_tg_cargo_borrable).';
COMMENT ON COLUMN public.rrhh_cargos.codigo IS
  'Slug ^[a-z0-9][a-z0-9_]{0,39}$. Inmutable (RRHH_CATALOGO_INMUTABLE). Es el valor que viaja en personal, actividades y programaciones.';
COMMENT ON COLUMN public.rrhh_cargos.activo IS
  'Inactivo = no se ofrece en los selects ni valida filas NUEVAS; las filas que ya lo tienen siguen siendo válidas y editables.';
COMMENT ON TABLE public.rrhh_tipos_turno IS
  'Catálogo de tipos de turno del EXPEDIENTE del empleado POR CONDOMINIO (diurno/nocturno/rotativo por defecto). No son las jornadas de Asignación de turnos (plantillas_horario / bloques_turno). `codigo` inmutable; desactivar, no borrar.';
COMMENT ON COLUMN public.rrhh_tipos_turno.codigo IS
  'Slug ^[a-z0-9][a-z0-9_]{0,39}$. Inmutable (RRHH_CATALOGO_INMUTABLE). Es el valor que viaja en personal_condominio.turno, programacion_limpieza.turno y ejecuciones_limpieza.turno.';

-- Coherencia del tenant e inmutabilidad: `company_id` se copia SIEMPRE del proyecto (el
-- cliente no decide la empresa); en UPDATE el código y el tenant no cambian.
-- SECURITY DEFINER porque lee `projects` por debajo de la RLS del llamador (la fila
-- del proyecto es suya si pasa la policy de INSERT, que exige can_access_project).
CREATE OR REPLACE FUNCTION public.rrhh_catalogo_coherente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = NEW.project_id;
    IF v_company IS NULL THEN
      RAISE EXCEPTION 'RRHH_CATALOGO_PROYECTO: el proyecto % no existe', NEW.project_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    NEW.company_id := v_company;
    NEW.codigo := lower(btrim(NEW.codigo));
    NEW.nombre := btrim(NEW.nombre);
    RETURN NEW;
  END IF;
  IF NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'RRHH_CATALOGO_INMUTABLE: el código y el condominio de un cargo o turno no se cambian (crea otro y desactiva este)'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.nombre := btrim(NEW.nombre);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_catalogo_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rrhh_cargos_coherente ON public.rrhh_cargos;
CREATE TRIGGER trg_rrhh_cargos_coherente
  BEFORE INSERT OR UPDATE ON public.rrhh_cargos
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_catalogo_coherente();
DROP TRIGGER IF EXISTS trg_rrhh_cargos_sello ON public.rrhh_cargos;
CREATE TRIGGER trg_rrhh_cargos_sello
  BEFORE INSERT OR UPDATE ON public.rrhh_cargos
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rrhh_cargos_updated_at ON public.rrhh_cargos;
CREATE TRIGGER trg_rrhh_cargos_updated_at
  BEFORE UPDATE ON public.rrhh_cargos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_rrhh_turnos_coherente ON public.rrhh_tipos_turno;
CREATE TRIGGER trg_rrhh_turnos_coherente
  BEFORE INSERT OR UPDATE ON public.rrhh_tipos_turno
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_catalogo_coherente();
DROP TRIGGER IF EXISTS trg_rrhh_turnos_sello ON public.rrhh_tipos_turno;
CREATE TRIGGER trg_rrhh_turnos_sello
  BEFORE INSERT OR UPDATE ON public.rrhh_tipos_turno
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rrhh_turnos_updated_at ON public.rrhh_tipos_turno;
CREATE TRIGGER trg_rrhh_turnos_updated_at
  BEFORE UPDATE ON public.rrhh_tipos_turno
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────────────
-- Lectura: toda la empresa con acceso al proyecto (es un catálogo transversal que
-- alimentan selects de Personal, Actividades y Programación). Escritura: por acción del
-- tab (`user_has_permission` ya responde true a super_admin / company_owner / admin).
-- Borrar: por la acción `.delete` del tab, y además el trigger de §7 lo impide si el
-- código está en uso.
ALTER TABLE public.rrhh_cargos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rrhh_tipos_turno ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rrhh_cargos, public.rrhh_tipos_turno FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rrhh_cargos, public.rrhh_tipos_turno TO authenticated;

DROP POLICY IF EXISTS rrhh_cargos_select ON public.rrhh_cargos;
CREATE POLICY rrhh_cargos_select ON public.rrhh_cargos FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));
DROP POLICY IF EXISTS rrhh_cargos_insert ON public.rrhh_cargos;
CREATE POLICY rrhh_cargos_insert ON public.rrhh_cargos FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.can_access_project(project_id)
              AND (SELECT COALESCE(public.user_has_permission('condominios.tab.rrhh_config.create'), false)));
DROP POLICY IF EXISTS rrhh_cargos_update ON public.rrhh_cargos;
CREATE POLICY rrhh_cargos_update ON public.rrhh_cargos FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('condominios.tab.rrhh_config.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS rrhh_cargos_delete ON public.rrhh_cargos;
CREATE POLICY rrhh_cargos_delete ON public.rrhh_cargos FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('condominios.tab.rrhh_config.delete'), false)));

DROP POLICY IF EXISTS rrhh_turnos_select ON public.rrhh_tipos_turno;
CREATE POLICY rrhh_turnos_select ON public.rrhh_tipos_turno FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));
DROP POLICY IF EXISTS rrhh_turnos_insert ON public.rrhh_tipos_turno;
CREATE POLICY rrhh_turnos_insert ON public.rrhh_tipos_turno FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.can_access_project(project_id)
              AND (SELECT COALESCE(public.user_has_permission('condominios.tab.rrhh_config.create'), false)));
DROP POLICY IF EXISTS rrhh_turnos_update ON public.rrhh_tipos_turno;
CREATE POLICY rrhh_turnos_update ON public.rrhh_tipos_turno FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('condominios.tab.rrhh_config.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS rrhh_turnos_delete ON public.rrhh_tipos_turno;
CREATE POLICY rrhh_turnos_delete ON public.rrhh_tipos_turno FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND public.can_access_project(project_id)
         AND (SELECT COALESCE(public.user_has_permission('condominios.tab.rrhh_config.delete'), false)));

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Siembra: los valores de siempre, en cada condominio
-- ────────────────────────────────────────────────────────────────────────────
-- Sin EXECUTE para nadie: la llama esta migración (backfill) y el trigger de `projects`.
-- ON CONFLICT por (project_id, codigo): re-aplicar no duplica ni pisa lo que el
-- condominio ya personalizó (nombre, ícono, orden, activo).
CREATE OR REPLACE FUNCTION public.rrhh_sembrar_defaults(p_project uuid, p_company uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.rrhh_cargos (company_id, project_id, codigo, nombre, icono, orden)
  SELECT p_company, p_project, d.codigo, d.nombre, d.icono, d.orden
  FROM (VALUES
    ('conserje',      'Conserje',       '🧹', 10),
    ('guardia',       'Guardia',        '💂', 20),
    ('jardinero',     'Jardinero',      '🌿', 30),
    ('mantenimiento', 'Mantenimiento',  '🔧', 40),
    ('administrador', 'Administrador',  '👔', 50),
    ('otro',          'Otro',           '👤', 60)
  ) AS d(codigo, nombre, icono, orden)
  ON CONFLICT (project_id, codigo) DO NOTHING;

  INSERT INTO public.rrhh_tipos_turno (company_id, project_id, codigo, nombre, icono, orden)
  SELECT p_company, p_project, d.codigo, d.nombre, d.icono, d.orden
  FROM (VALUES
    ('diurno',   'Diurno',   '☀️', 10),
    ('nocturno', 'Nocturno', '🌙', 20),
    ('rotativo', 'Rotativo', '🔄', 30)
  ) AS d(codigo, nombre, icono, orden)
  ON CONFLICT (project_id, codigo) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_sembrar_defaults(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Backfill: todos los proyectos existentes.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.id, p.company_id FROM public.projects p LOOP
    PERFORM public.rrhh_sembrar_defaults(r.id, r.company_id);
  END LOOP;
END;
$$;

-- Proyecto nuevo → sus catálogos. Nunca aborta el alta (precedente: conta_seed_on_project).
CREATE OR REPLACE FUNCTION public.rrhh_sembrar_on_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    PERFORM public.rrhh_sembrar_defaults(NEW.id, NEW.company_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rrhh_sembrar_on_project(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_sembrar_on_project() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rrhh_sembrar_catalogos ON public.projects;
CREATE TRIGGER trg_rrhh_sembrar_catalogos
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_sembrar_on_project();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Validadores
-- ────────────────────────────────────────────────────────────────────────────
-- Regla de integridad: el veredicto NO depende de lo que la RLS deje ver a quien escribe
-- (SECURITY DEFINER); sólo devuelven un booleano. Comparan por código normalizado.
CREATE OR REPLACE FUNCTION public.rrhh_cargo_valido(p_project uuid, p_codigo text, p_solo_activos boolean DEFAULT true)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rrhh_cargos c
     WHERE c.project_id = p_project
       AND c.codigo = lower(btrim(COALESCE(p_codigo, '')))
       AND (c.activo OR NOT p_solo_activos))
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_cargo_valido(uuid, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_cargo_valido(uuid, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.rrhh_turno_valido(p_project uuid, p_codigo text, p_solo_activos boolean DEFAULT true)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rrhh_tipos_turno t
     WHERE t.project_id = p_project
       AND t.codigo = lower(btrim(COALESCE(p_codigo, '')))
       AND (t.activo OR NOT p_solo_activos))
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_turno_valido(uuid, text, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_turno_valido(uuid, text, boolean) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Triggers de validación (ANTES de retirar los CHECK literales)
-- ────────────────────────────────────────────────────────────────────────────
-- En UPDATE sólo se valida si el valor CAMBIA (o cambia el proyecto): una fila con un
-- cargo o turno hoy inactivo —o legado, fuera del catálogo— se sigue pudiendo editar
-- entera mientras nadie toque ese valor. Lo que ya no se puede es moverla a un valor que
-- el condominio no tenga activo. Los valores se guardan normalizados (código).

-- 6.1 personal_condominio: cargo y turno ACTIVOS.
CREATE OR REPLACE FUNCTION public.rrhh_personal_valida_catalogo()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cargo IS DISTINCT FROM OLD.cargo OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    IF NOT public.rrhh_cargo_valido(NEW.project_id, NEW.cargo) THEN
      RAISE EXCEPTION 'RRHH_CARGO: el cargo "%" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)', NEW.cargo
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.cargo := lower(btrim(NEW.cargo));
  END IF;
  IF TG_OP = 'INSERT' OR NEW.turno IS DISTINCT FROM OLD.turno OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    IF NOT public.rrhh_turno_valido(NEW.project_id, NEW.turno) THEN
      RAISE EXCEPTION 'RRHH_TURNO: el turno "%" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)', NEW.turno
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.turno := lower(btrim(NEW.turno));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_personal_valida_catalogo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_personal_catalogo_rrhh ON public.personal_condominio;
CREATE TRIGGER trg_personal_catalogo_rrhh
  BEFORE INSERT OR UPDATE OF cargo, turno, project_id ON public.personal_condominio
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_personal_valida_catalogo();

-- 6.2 plantillas_tarea_cargo: mismo trigger y misma función de 20260904000400 §4; sólo
-- cambia la fuente del catálogo (antes una lista literal).
CREATE OR REPLACE FUNCTION public.plantillas_cargo_valida_cargo()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.cargo IS DISTINCT FROM OLD.cargo OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    IF NOT public.rrhh_cargo_valido(NEW.project_id, NEW.cargo) THEN
      RAISE EXCEPTION 'PLANTILLAS_CARGO: cargo "%" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)', NEW.cargo
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.cargo := lower(btrim(NEW.cargo));
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.plantillas_cargo_valida_cargo() IS
  'Valida `cargo` contra el catálogo ACTIVO del condominio (rrhh_cargos) al insertar y al CAMBIARLO. No se dispara cuando el valor no cambia (IS DISTINCT FROM): las filas con un cargo hoy inactivo o legado siguen siendo editables.';

DROP TRIGGER IF EXISTS trg_plantillas_cargo_controlado ON public.plantillas_tarea_cargo;
CREATE TRIGGER trg_plantillas_cargo_controlado
  BEFORE INSERT OR UPDATE OF cargo, project_id ON public.plantillas_tarea_cargo
  FOR EACH ROW EXECUTE FUNCTION public.plantillas_cargo_valida_cargo();

-- 6.3 programacion_limpieza: NULL sigue siendo comodín («cualquier cargo/turno»).
CREATE OR REPLACE FUNCTION public.rrhh_prog_limpieza_valida_catalogo()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.cargo IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.cargo IS DISTINCT FROM OLD.cargo OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    IF NOT public.rrhh_cargo_valido(NEW.project_id, NEW.cargo) THEN
      RAISE EXCEPTION 'RRHH_CARGO: el cargo "%" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)', NEW.cargo
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.cargo := lower(btrim(NEW.cargo));
  END IF;
  IF NEW.turno IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.turno IS DISTINCT FROM OLD.turno OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    IF NOT public.rrhh_turno_valido(NEW.project_id, NEW.turno) THEN
      RAISE EXCEPTION 'RRHH_TURNO: el turno "%" no está activo en el catálogo de este condominio (Recursos Humanos → Configuración)', NEW.turno
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.turno := lower(btrim(NEW.turno));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_prog_limpieza_valida_catalogo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prog_limpieza_catalogo_rrhh ON public.programacion_limpieza;
CREATE TRIGGER trg_prog_limpieza_catalogo_rrhh
  BEFORE INSERT OR UPDATE OF cargo, turno, project_id ON public.programacion_limpieza
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_prog_limpieza_valida_catalogo();

-- 6.4 ejecuciones_limpieza.turno: registro derivado de la programación → exige que el
-- turno EXISTA en el catálogo (activo o no).
CREATE OR REPLACE FUNCTION public.rrhh_ejec_limpieza_valida_turno()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.turno IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.turno IS DISTINCT FROM OLD.turno OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
    IF NOT public.rrhh_turno_valido(NEW.project_id, NEW.turno, false) THEN
      RAISE EXCEPTION 'RRHH_TURNO: el turno "%" no existe en el catálogo de este condominio', NEW.turno
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.turno := lower(btrim(NEW.turno));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_ejec_limpieza_valida_turno() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ejec_limpieza_turno_rrhh ON public.ejecuciones_limpieza;
CREATE TRIGGER trg_ejec_limpieza_turno_rrhh
  BEFORE INSERT OR UPDATE OF turno, project_id ON public.ejecuciones_limpieza
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_ejec_limpieza_valida_turno();

-- 6.5 Con los triggers ya instalados, los CHECK literales sobran (y estorban: impedirían
-- cualquier cargo o turno nuevo).
ALTER TABLE public.programacion_limpieza DROP CONSTRAINT IF EXISTS prog_limpieza_cargo_check;
ALTER TABLE public.programacion_limpieza DROP CONSTRAINT IF EXISTS prog_limpieza_turno_check;
ALTER TABLE public.ejecuciones_limpieza  DROP CONSTRAINT IF EXISTS ejec_limpieza_turno_check;

COMMENT ON COLUMN public.programacion_limpieza.turno IS
  'Turno al que corresponde el área: código de rrhh_tipos_turno del condominio (trigger trg_prog_limpieza_catalogo_rrhh). NULL = cualquier turno.';
COMMENT ON COLUMN public.programacion_limpieza.cargo IS
  'Cargo que debe cubrirla: código de rrhh_cargos del condominio (trigger trg_prog_limpieza_catalogo_rrhh). NULL = cualquier cargo.';
COMMENT ON COLUMN public.personal_condominio.cargo IS
  'Código de rrhh_cargos del condominio (trigger trg_personal_catalogo_rrhh: activo al insertar o al cambiarlo).';
COMMENT ON COLUMN public.personal_condominio.turno IS
  'Código de rrhh_tipos_turno del condominio (trigger trg_personal_catalogo_rrhh: activo al insertar o al cambiarlo). Es el turno del expediente, no la jornada de Asignación de turnos.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Uso y borrado
-- ────────────────────────────────────────────────────────────────────────────
-- Conteo interno (sin EXECUTE para nadie): lo usan la guarda de borrado y el wrapper
-- de pantalla. DEFINER porque la respuesta «¿alguien lo usa?» no puede depender de lo
-- que la RLS deje ver a quien pregunta.
CREATE OR REPLACE FUNCTION public.rrhh_cargo_uso(p_project uuid, p_codigo text)
RETURNS TABLE (personal bigint, actividades bigint, programaciones bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    (SELECT count(*) FROM public.personal_condominio x
      WHERE x.project_id = p_project AND lower(btrim(x.cargo)) = lower(btrim(p_codigo))),
    (SELECT count(*) FROM public.plantillas_tarea_cargo x
      WHERE x.project_id = p_project AND lower(btrim(x.cargo)) = lower(btrim(p_codigo))),
    (SELECT count(*) FROM public.programacion_limpieza x
      WHERE x.project_id = p_project AND lower(btrim(x.cargo)) = lower(btrim(p_codigo)))
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_cargo_uso(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rrhh_turno_uso(p_project uuid, p_codigo text)
RETURNS TABLE (personal bigint, programaciones bigint, ejecuciones bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    (SELECT count(*) FROM public.personal_condominio x
      WHERE x.project_id = p_project AND lower(btrim(x.turno)) = lower(btrim(p_codigo))),
    (SELECT count(*) FROM public.programacion_limpieza x
      WHERE x.project_id = p_project AND lower(btrim(x.turno)) = lower(btrim(p_codigo))),
    (SELECT count(*) FROM public.ejecuciones_limpieza x
      WHERE x.project_id = p_project AND lower(btrim(x.turno)) = lower(btrim(p_codigo)))
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_turno_uso(uuid, text) FROM PUBLIC, anon, authenticated;

-- Para la pantalla («en uso: N»): sólo responde sobre proyectos a los que el llamador
-- tiene acceso; fuera de alcance devuelve ceros (no revela nada).
CREATE OR REPLACE FUNCTION public.rrhh_cargo_en_uso(p_project uuid, p_codigo text)
RETURNS TABLE (personal bigint, actividades bigint, programaciones bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.personal, u.actividades, u.programaciones
    FROM public.rrhh_cargo_uso(p_project, p_codigo) u
   WHERE COALESCE(public.can_access_project(p_project), false)
     AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project AND (p.company_id = public.get_my_company_id() OR public.is_super_admin()))
  UNION ALL
  SELECT 0::bigint, 0::bigint, 0::bigint
   WHERE NOT (COALESCE(public.can_access_project(p_project), false)
     AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project AND (p.company_id = public.get_my_company_id() OR public.is_super_admin())))
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_cargo_en_uso(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_cargo_en_uso(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rrhh_turno_en_uso(p_project uuid, p_codigo text)
RETURNS TABLE (personal bigint, programaciones bigint, ejecuciones bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.personal, u.programaciones, u.ejecuciones
    FROM public.rrhh_turno_uso(p_project, p_codigo) u
   WHERE COALESCE(public.can_access_project(p_project), false)
     AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project AND (p.company_id = public.get_my_company_id() OR public.is_super_admin()))
  UNION ALL
  SELECT 0::bigint, 0::bigint, 0::bigint
   WHERE NOT (COALESCE(public.can_access_project(p_project), false)
     AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project AND (p.company_id = public.get_my_company_id() OR public.is_super_admin())))
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_turno_en_uso(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rrhh_turno_en_uso(uuid, text) TO authenticated;

-- Guardas de borrado: un código en uso no se borra (se desactiva). ERRCODE 23503, el
-- que la pantalla ya traduce a «está en uso».
CREATE OR REPLACE FUNCTION public.rrhh_tg_cargo_borrable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u record;
BEGIN
  SELECT * INTO u FROM public.rrhh_cargo_uso(OLD.project_id, OLD.codigo);
  IF u.personal + u.actividades + u.programaciones > 0 THEN
    RAISE EXCEPTION 'RRHH_CARGO_EN_USO: el cargo "%" lo usan % empleado(s), % actividad(es) y % programación(es): desactívalo en vez de borrarlo', OLD.codigo, u.personal, u.actividades, u.programaciones
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_tg_cargo_borrable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rrhh_cargo_borrable ON public.rrhh_cargos;
CREATE TRIGGER trg_rrhh_cargo_borrable
  BEFORE DELETE ON public.rrhh_cargos
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_tg_cargo_borrable();

CREATE OR REPLACE FUNCTION public.rrhh_tg_turno_borrable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u record;
BEGIN
  SELECT * INTO u FROM public.rrhh_turno_uso(OLD.project_id, OLD.codigo);
  IF u.personal + u.programaciones + u.ejecuciones > 0 THEN
    RAISE EXCEPTION 'RRHH_TURNO_EN_USO: el turno "%" lo usan % empleado(s), % programación(es) y % ejecución(es): desactívalo en vez de borrarlo', OLD.codigo, u.personal, u.programaciones, u.ejecuciones
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_tg_turno_borrable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rrhh_turno_borrable ON public.rrhh_tipos_turno;
CREATE TRIGGER trg_rrhh_turno_borrable
  BEFORE DELETE ON public.rrhh_tipos_turno
  FOR EACH ROW EXECUTE FUNCTION public.rrhh_tg_turno_borrable();

-- ────────────────────────────────────────────────────────────────────────────
-- 8. plantillas_import_evaluar: el cargo sale del catálogo ACTIVO del condominio
-- ────────────────────────────────────────────────────────────────────────────
-- Cuerpo íntegro de 20261031000200 con tres cambios: `v_cargos` se lee de rrhh_cargos
-- (activos del proyecto, bajo la RLS de quien importa: SECURITY INVOKER); se acepta el
-- código o el nombre de pantalla (se devuelve el código en datos.cargo); y si el
-- condominio no tiene cargos activos el mensaje lo dice.
CREATE OR REPLACE FUNCTION public.plantillas_import_evaluar(p_company uuid, p_project uuid, p_fila jsonb, p_n int)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_ok_cols  constant text[] := ARRAY['titulo', 'cargo', 'servicio', 'descripcion', 'instrucciones_seguridad',
                                      'duracion_min', 'icono', 'area', 'orden', 'requiere_foto', 'requiere_comentario',
                                      'requiere_checklist', 'checklist', 'insumos', 'herramientas', 'equipo'];
  v_libres   constant text[] := ARRAY['descripcion', 'instrucciones_seguridad', 'checklist'];
  v_cargos   text[];
  v_cargo_cod text;
  v_servs    constant text[] := ARRAY['limpieza', 'mantenimiento', 'seguridad', 'jardineria', 'administracion', 'otro'];
  v_iconos   constant text[] := ARRAY['✅','🧹','🔧','🌿','💡','🚿','🪟','🚪','🏊','🗑','🧴','🔑','📦','🛗','⚡','💧','🖨','🪣','🧽','🔐','📋','🏋️','🎭','🌊','🛠'];
  v_err      jsonb := '[]'::jsonb;
  v_adv      jsonb := '[]'::jsonb;
  k          text;
  v_titulo   text;
  v_cargo    text;
  v_serv     text;
  v_desc     text;
  v_instr    text;
  v_dur_t    text;  v_dur int;
  v_icono    text;
  v_area     text;  v_area_id uuid;  v_n_area int;
  v_orden_t  text;  v_orden int := 0;
  v_rf       boolean := false;
  v_rc       boolean := false;
  v_rk       boolean := false;
  v_chk_t    text;  v_chk jsonb := '[]'::jsonb;
  v_items    jsonb;
  it         jsonb;
  v_nombre   text;
  v_cant_t   text;
  v_cant     numeric;
  v_n        int;
  v_id       uuid;
  v_sum      jsonb := '[]'::jsonb;
  v_inv      jsonb := '[]'::jsonb;
  v_sum_ids  uuid[] := ARRAY[]::uuid[];
  v_inv_ids  uuid[] := ARRAY[]::uuid[];
  v_col      text;
  v_cat      text;
  v_label    text;
BEGIN
  -- Cargos ACTIVOS del condominio (bajo la RLS de quien importa).
  SELECT COALESCE(array_agg(c.codigo ORDER BY c.orden, c.nombre), ARRAY[]::text[]) INTO v_cargos
    FROM public.rrhh_cargos c
   WHERE c.company_id = p_company AND c.project_id = p_project AND c.activo;

  IF jsonb_typeof(p_fila) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('datos', NULL,
      'errores', jsonb_build_array(jsonb_build_object('campo', 'fila', 'mensaje', 'La fila no es un registro de columnas.')),
      'advertencias', '[]'::jsonb);
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_fila) LOOP
    IF NOT (k = ANY (v_ok_cols)) THEN
      v_err := v_err || jsonb_build_object('campo', k,
        'mensaje', format('La columna «%s» no se admite: este archivo solo trae actividades (no decide estado, empresa ni identificadores).', k));
    END IF;
  END LOOP;

  -- Texto plano: nada que parezca fórmula. En los campos libres se admite «-» al inicio
  -- (viñetas); en el resto se rechaza también.
  FOR k IN SELECT unnest(v_ok_cols) LOOP
    IF COALESCE(p_fila->>k, '') ~ (CASE WHEN k = ANY (v_libres) THEN '^\s*[=+@]' ELSE '^\s*[=+@-]' END) THEN
      v_err := v_err || jsonb_build_object('campo', k, 'mensaje', 'Un valor que empieza con =, +, - o @ se rechaza (posible fórmula): pega valores de texto.');
    END IF;
  END LOOP;

  v_titulo  := NULLIF(btrim(COALESCE(p_fila->>'titulo', '')), '');
  v_cargo   := lower(NULLIF(btrim(COALESCE(p_fila->>'cargo', '')), ''));
  v_serv    := lower(NULLIF(btrim(COALESCE(p_fila->>'servicio', '')), ''));
  v_desc    := NULLIF(btrim(COALESCE(p_fila->>'descripcion', '')), '');
  v_instr   := NULLIF(btrim(COALESCE(p_fila->>'instrucciones_seguridad', '')), '');
  v_dur_t   := btrim(COALESCE(p_fila->>'duracion_min', ''));
  v_icono   := NULLIF(btrim(COALESCE(p_fila->>'icono', '')), '');
  v_area    := NULLIF(btrim(COALESCE(p_fila->>'area', '')), '');
  v_orden_t := COALESCE(NULLIF(btrim(COALESCE(p_fila->>'orden', '')), ''), '0');
  v_chk_t   := btrim(COALESCE(p_fila->>'checklist', ''));

  IF v_titulo IS NULL OR length(v_titulo) < 2 THEN
    v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', 'El título es obligatorio (2–150 caracteres).');
  ELSIF length(v_titulo) > 150 THEN
    v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', 'El título excede 150 caracteres.');
  END IF;

  -- Cargo: del catálogo ACTIVO del condominio, por código o por nombre de pantalla
  -- (se guarda el código). Servicio: del catálogo fijo; se aceptan las etiquetas.
  v_serv := translate(COALESCE(v_serv, ''), 'áéíóú', 'aeiou');
  IF v_cargo IS NOT NULL AND NOT (v_cargo = ANY (v_cargos)) THEN
    SELECT c.codigo INTO v_cargo_cod FROM public.rrhh_cargos c
     WHERE c.company_id = p_company AND c.project_id = p_project AND c.activo
       AND lower(btrim(c.nombre)) = v_cargo
     LIMIT 1;
    IF v_cargo_cod IS NOT NULL THEN v_cargo := v_cargo_cod; END IF;
  END IF;
  IF cardinality(v_cargos) = 0 THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', 'Este condominio no tiene cargos activos: configúralos en Recursos Humanos → Configuración.');
  ELSIF v_cargo IS NULL THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', format('El cargo es obligatorio: %s.', array_to_string(v_cargos, ', ')));
  ELSIF NOT (v_cargo = ANY (v_cargos)) THEN
    v_err := v_err || jsonb_build_object('campo', 'cargo', 'mensaje', format('Cargo inválido «%s» (o inactivo): usa %s.', v_cargo, array_to_string(v_cargos, ', ')));
  END IF;
  IF v_serv = '' THEN
    v_err := v_err || jsonb_build_object('campo', 'servicio', 'mensaje', format('El servicio es obligatorio: %s.', array_to_string(v_servs, ', ')));
  ELSIF NOT (v_serv = ANY (v_servs)) THEN
    v_err := v_err || jsonb_build_object('campo', 'servicio', 'mensaje', format('Servicio inválido «%s»: usa %s.', v_serv, array_to_string(v_servs, ', ')));
  END IF;

  -- Duración: entero > 0; obligatoria en limpieza (regla de la pantalla).
  IF v_dur_t <> '' THEN
    IF v_dur_t !~ '^[0-9]{1,5}$' OR v_dur_t::int < 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'duracion_min', 'mensaje', 'La duración estimada debe ser un entero de minutos mayor que cero (o vacía).');
    ELSE
      v_dur := v_dur_t::int;
    END IF;
  ELSIF v_serv = 'limpieza' THEN
    v_err := v_err || jsonb_build_object('campo', 'duracion_min', 'mensaje', 'Las actividades de limpieza requieren duración estimada en minutos.');
  END IF;

  -- Ícono: del catálogo de la pantalla o vacío (defecto por servicio).
  IF v_icono IS NULL THEN
    v_icono := CASE v_serv WHEN 'limpieza' THEN '🧹' WHEN 'mantenimiento' THEN '🔧' WHEN 'seguridad' THEN '🔐'
                           WHEN 'jardineria' THEN '🌿' WHEN 'administracion' THEN '📋' ELSE '✅' END;
  ELSIF NOT (v_icono = ANY (v_iconos)) THEN
    v_err := v_err || jsonb_build_object('campo', 'icono', 'mensaje', format('Ícono «%s» fuera del catálogo: déjalo vacío o usa uno de los de la pantalla.', v_icono));
  END IF;

  -- Área: por nombre, entre las activas del proyecto; opcional; nunca se crea.
  IF v_area IS NOT NULL THEN
    SELECT count(*), (array_agg(a.id ORDER BY a.id))[1] INTO v_n_area, v_area_id FROM public.areas_condominio a
     WHERE a.company_id = p_company AND a.project_id = p_project AND a.activo
       AND lower(btrim(a.nombre)) = lower(v_area);
    IF v_n_area = 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'area', 'mensaje', format('El área «%s» no existe (o está inactiva) en este proyecto. La importación no crea áreas.', v_area));
    ELSIF v_n_area > 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'area', 'mensaje', format('Hay %s áreas llamadas «%s» en el proyecto: el nombre es ambiguo. Renombra una en Áreas.', v_n_area, v_area));
      v_area_id := NULL;
    END IF;
  END IF;

  IF v_orden_t !~ '^[0-9]{1,5}$' THEN
    v_err := v_err || jsonb_build_object('campo', 'orden', 'mensaje', 'El orden debe ser un entero mayor o igual a 0 (vacío = 0).');
  ELSE
    v_orden := v_orden_t::int;
  END IF;

  -- si/no.
  FOR k IN SELECT unnest(ARRAY['requiere_foto', 'requiere_comentario', 'requiere_checklist']) LOOP
    v_col := lower(btrim(COALESCE(p_fila->>k, '')));
    IF v_col IN ('', 'no', 'false', '0', 'n') THEN
      NULL;
    ELSIF v_col IN ('si', 'sí', 'true', '1', 's', 'yes') THEN
      IF k = 'requiere_foto' THEN v_rf := true; ELSIF k = 'requiere_comentario' THEN v_rc := true; ELSE v_rk := true; END IF;
    ELSE
      v_err := v_err || jsonb_build_object('campo', k, 'mensaje', format('%s: si o no (vacío = no).', k));
    END IF;
  END LOOP;

  -- Checklist: pasos separados por «|», sin vacíos.
  IF v_chk_t <> '' THEN
    SELECT COALESCE(jsonb_agg(btrim(paso)), '[]'::jsonb) INTO v_chk
      FROM unnest(string_to_array(v_chk_t, '|')) paso WHERE btrim(paso) <> '';
    IF jsonb_array_length(v_chk) > 50 THEN
      v_err := v_err || jsonb_build_object('campo', 'checklist', 'mensaje', 'El checklist admite hasta 50 pasos.');
    END IF;
  END IF;
  IF v_rk AND jsonb_array_length(v_chk) = 0 THEN
    v_err := v_err || jsonb_build_object('campo', 'checklist', 'mensaje', 'El checklist está marcado como obligatorio pero no trae pasos (sepáralos con «|»).');
  END IF;

  IF v_desc IS NOT NULL AND length(v_desc) > 2000 THEN
    v_err := v_err || jsonb_build_object('campo', 'descripcion', 'mensaje', 'La descripción excede 2000 caracteres.');
  END IF;
  IF v_instr IS NOT NULL AND length(v_instr) > 2000 THEN
    v_err := v_err || jsonb_build_object('campo', 'instrucciones_seguridad', 'mensaje', 'Las instrucciones de seguridad exceden 2000 caracteres.');
  END IF;

  -- Insumos: suministros ACTIVOS del proyecto, por nombre; cantidad decimal > 0 (vacío = 1).
  -- La RLS de suministros_condominio exige ver la pestaña Suministros: sin ese permiso el
  -- catálogo está vacío para quien importa, y se dice tal cual (no «no existe»).
  v_items := public.plantillas_import_partir_recursos(p_fila->>'insumos');
  IF jsonb_array_length(v_items) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.suministros'), false) THEN
    v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', 'Para vincular insumos por nombre necesitas permiso para ver la pestaña Suministros.');
    v_items := '[]'::jsonb;
  END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_nombre := it->>'nombre';
    v_cant_t := COALESCE(it->>'cantidad', '1');
    IF v_nombre IS NULL OR length(v_nombre) < 2 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', 'Cada insumo va como «Nombre» o «Nombre x cantidad», separados por «;».');
      CONTINUE;
    END IF;
    IF (it->>'obligatoria')::boolean THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('«%s»: los insumos no llevan «!» (obligatoria aplica a herramientas y equipo).', v_nombre));
    END IF;
    IF v_cant_t !~ '^[0-9]{1,8}(\.[0-9]{1,2})?$' OR v_cant_t::numeric <= 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('«%s»: la cantidad debe ser un número mayor que cero (hasta 2 decimales).', v_nombre));
      CONTINUE;
    END IF;
    v_cant := v_cant_t::numeric;
    SELECT count(*), (array_agg(s.id ORDER BY s.id))[1] INTO v_n, v_id FROM public.suministros_condominio s
     WHERE s.company_id = p_company AND s.project_id = p_project AND s.activo
       AND lower(btrim(s.nombre)) = lower(v_nombre);
    IF v_n = 0 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('El insumo «%s» no existe (o está inactivo) en este proyecto. La importación no crea insumos.', v_nombre));
    ELSIF v_n > 1 THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('Hay %s insumos llamados «%s» en el proyecto: el nombre es ambiguo. Renombra uno en Suministros.', v_n, v_nombre));
    ELSIF v_id = ANY (v_sum_ids) THEN
      v_err := v_err || jsonb_build_object('campo', 'insumos', 'mensaje', format('El insumo «%s» se repite en la misma fila.', v_nombre));
    ELSE
      v_sum_ids := v_sum_ids || v_id;
      v_sum := v_sum || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'cantidad', v_cant);
    END IF;
  END LOOP;

  -- Herramientas y equipo: inventario NO dado de baja del proyecto, por nombre y categoría;
  -- cantidad entera > 0 (vacío = 1); «!» = obligatoria. Ver el inventario exige
  -- condominios.tab.inventario (RLS de inventario_condominio): sin él, mensaje claro en vez de «no existe».
  FOR v_col, v_cat, v_label IN SELECT * FROM (VALUES ('herramientas', 'herramienta', 'La herramienta'), ('equipo', 'equipo', 'El equipo')) t(c, cat, l) LOOP
    v_items := public.plantillas_import_partir_recursos(p_fila->>v_col);
    IF jsonb_array_length(v_items) > 0 AND NOT COALESCE(public.user_has_permission('condominios.tab.inventario'), false) THEN
      v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', 'Para vincular herramientas o equipo por nombre necesitas permiso para ver la pestaña Inventario.');
      CONTINUE;
    END IF;
    FOR it IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      v_nombre := it->>'nombre';
      v_cant_t := COALESCE(it->>'cantidad', '1');
      IF v_nombre IS NULL OR length(v_nombre) < 2 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', 'Cada recurso va como «Nombre», «Nombre x cantidad» o «Nombre!» (obligatoria), separados por «;».');
        CONTINUE;
      END IF;
      IF v_cant_t !~ '^[0-9]{1,6}$' OR v_cant_t::int <= 0 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('«%s»: la cantidad debe ser un entero mayor que cero.', v_nombre));
        CONTINUE;
      END IF;
      SELECT count(*), (array_agg(i.id ORDER BY i.id))[1] INTO v_n, v_id FROM public.inventario_condominio i
       WHERE i.company_id = p_company AND i.project_id = p_project AND i.estado <> 'dado_de_baja'
         AND i.categoria = v_cat AND lower(btrim(i.nombre)) = lower(v_nombre);
      IF v_n = 0 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('%s «%s» no existe en este proyecto con categoría «%s» (o está dado de baja). La importación no crea inventario; revisa la categoría en Inventario.', v_label, v_nombre, v_cat));
      ELSIF v_n > 1 THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('Hay %s artículos de inventario llamados «%s» con categoría «%s»: el nombre es ambiguo. Renombra uno en Inventario.', v_n, v_nombre, v_cat));
      ELSIF v_id = ANY (v_inv_ids) THEN
        v_err := v_err || jsonb_build_object('campo', v_col, 'mensaje', format('«%s» se repite en la misma fila.', v_nombre));
      ELSE
        v_inv_ids := v_inv_ids || v_id;
        v_inv := v_inv || jsonb_build_object('id', v_id, 'nombre', v_nombre, 'categoria', v_cat,
                                             'cantidad', v_cant_t::int, 'obligatoria', (it->>'obligatoria')::boolean);
      END IF;
    END LOOP;
  END LOOP;

  -- Actividad ya existente con el mismo título y cargo en el proyecto (activa o inactiva) → ERROR.
  IF v_titulo IS NOT NULL AND v_cargo = ANY (v_cargos) AND EXISTS (
    SELECT 1 FROM public.plantillas_tarea_cargo p
     WHERE p.company_id = p_company AND p.project_id = p_project
       AND lower(btrim(p.titulo)) = lower(v_titulo) AND lower(btrim(p.cargo)) = v_cargo) THEN
    v_err := v_err || jsonb_build_object('campo', 'titulo', 'mensaje', format('Ya existe una actividad «%s» para el cargo %s en este proyecto (activa o inactiva). La carga no sobrescribe: edítala en el catálogo o cambia el título.', v_titulo, v_cargo));
  END IF;

  IF jsonb_array_length(v_err) > 0 THEN
    RETURN jsonb_build_object('datos', NULL, 'errores', v_err, 'advertencias', v_adv);
  END IF;

  RETURN jsonb_build_object(
    'datos', jsonb_build_object(
      'titulo', v_titulo, 'cargo', v_cargo, 'servicio', v_serv, 'descripcion', v_desc,
      'instrucciones_seguridad', v_instr, 'duracion_estimada_min', v_dur, 'icono', v_icono,
      'area', v_area, 'area_id', v_area_id, 'orden', v_orden,
      'requiere_foto', v_rf, 'requiere_comentario', v_rc, 'requiere_checklist', v_rk, 'checklist', v_chk,
      'recursos', jsonb_build_object('suministros', v_sum, 'inventario', v_inv),
      'n_recursos', jsonb_array_length(v_sum) + jsonb_array_length(v_inv)),
    'errores', v_err, 'advertencias', v_adv);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Comentarios
-- ────────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.rrhh_cargo_valido(uuid, text, boolean) IS
  'true si `p_codigo` (normalizado) es un cargo del condominio; con p_solo_activos (defecto) sólo los activos. SECURITY DEFINER: regla de integridad, no depende de la RLS del llamador.';
COMMENT ON FUNCTION public.rrhh_turno_valido(uuid, text, boolean) IS
  'true si `p_codigo` (normalizado) es un tipo de turno del condominio; con p_solo_activos (defecto) sólo los activos. SECURITY DEFINER: regla de integridad, no depende de la RLS del llamador.';
COMMENT ON FUNCTION public.rrhh_cargo_en_uso(uuid, text) IS
  'Cuántos empleados, actividades (plantillas) y programaciones de limpieza del condominio usan el cargo. Fuera del alcance del llamador devuelve ceros.';
COMMENT ON FUNCTION public.rrhh_turno_en_uso(uuid, text) IS
  'Cuántos empleados, programaciones y ejecuciones de limpieza del condominio usan el tipo de turno. Fuera del alcance del llamador devuelve ceros.';
COMMENT ON FUNCTION public.rrhh_sembrar_defaults(uuid, uuid) IS
  'Siembra los 6 cargos y 3 tipos de turno por defecto en un condominio (ON CONFLICT DO NOTHING). Sin EXECUTE: la llaman el backfill y el trigger de projects.';
COMMENT ON FUNCTION public.plantillas_import_evaluar(uuid, uuid, jsonb, int) IS
  'Evalúa una fila de la carga masiva de actividades. El cargo se resuelve contra los cargos ACTIVOS del condominio (rrhh_cargos), por código o por nombre de pantalla.';
