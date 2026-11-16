-- ════════════════════════════════════════════════════════════════════════════
-- Módulos por proyecto
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- Los módulos (Agua, Condominios, Rentas) se contratan por EMPRESA
-- (companies.servicio_*) y valen igual para todos sus proyectos. Una empresa con
-- varios proyectos no puede decir «este edificio lleva los tres, este
-- residencial sólo Agua y Condominios, y esta lotificación sólo Agua»: todos
-- los proyectos aparecen en los selectores de todos los módulos.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. `projects.modulo_agua / modulo_condominios / modulo_rentas` (por defecto
--      `true`: nada cambia para los proyectos que ya existen). Un módulo está
--      activo en un proyecto cuando la empresa lo tiene contratado Y el proyecto
--      lo tiene encendido: el interruptor del proyecto sólo RESTA sobre lo
--      contratado, nunca enciende algo que la empresa no paga.
--   2. Los interruptores son del PRINCIPAL de la empresa (propietario) y de la
--      plataforma, igual que crear o borrar proyectos (20261026000700). Un
--      administrador sigue editando el resto del proyecto (projects_update no
--      cambia). Un proyecto no puede quedar sin ningún módulo activo.
--   3. Portal del residente: `portal_mis_unidades` devuelve los flags de
--      servicio de la empresa cruzados con los del proyecto de cada unidad. El
--      residente de un proyecto de sólo Agua ya no entra al portal de Condominios.
--   4. Rentas: no se enlaza una propiedad a una unidad de un proyecto que tiene
--      Rentas apagado (`RENTAS_PROYECTO_SIN_MODULO`).
--
-- LO QUE **NO** HACE
--   · No cambia el plan ni lo que se cobra: la activación se paga por empresa y
--     los proyectos y unidades se cuentan igual, tengan los módulos que tengan.
--   · No añade RLS por módulo a las tablas de cada módulo: los datos del
--     proyecto se conservan y siguen protegidos por empresa, proyecto y permiso.
--     El interruptor decide en qué módulos OPERA el proyecto (selectores, menú,
--     portal), no es una frontera de seguridad nueva.
--   · No toca las propiedades ya enlazadas a un proyecto al que luego se le
--     apaga Rentas: se conservan; sólo se impide enlazar nuevas.
--
-- Idempotente: se puede aplicar dos veces.
-- REVERSA: scripts/reversion-modulos-por-proyecto.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columnas
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS modulo_agua        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS modulo_condominios boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS modulo_rentas      boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.projects.modulo_agua IS
  'El proyecto opera en Manejo Agua. Sólo cuenta si la empresa lo tiene contratado (companies.servicio_agua).';
COMMENT ON COLUMN public.projects.modulo_condominios IS
  'El proyecto opera en Manejo Condominios. Sólo cuenta si la empresa lo tiene contratado (companies.servicio_condominios).';
COMMENT ON COLUMN public.projects.modulo_rentas IS
  'Las unidades del proyecto se pueden llevar en Manejo de Rentas. Sólo cuenta si la empresa lo tiene contratado (companies.servicio_rentas).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Quién mueve los interruptores y qué no puede quedar
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER a propósito: decide por la sesión que escribe. La empresa
-- del proyecto la lee quien pasó projects_update (es la suya); la plataforma
-- las lee todas. service_role y las migraciones no pasan por la compuerta de
-- rol, pero sí por la de «al menos un módulo».
CREATE OR REPLACE FUNCTION public.projects_modulos_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_agua        boolean;
  v_condominios boolean;
  v_rentas      boolean;
BEGIN
  IF NEW.modulo_agua        IS NOT DISTINCT FROM OLD.modulo_agua
     AND NEW.modulo_condominios IS NOT DISTINCT FROM OLD.modulo_condominios
     AND NEW.modulo_rentas      IS NOT DISTINCT FROM OLD.modulo_rentas THEN
    RETURN NEW;
  END IF;
  IF (SELECT auth.role()) = 'authenticated'
     AND NOT public.is_super_admin()
     AND NOT public.is_company_owner() THEN
    RAISE EXCEPTION 'MODULOS_PROYECTO_SOLO_PRINCIPAL: sólo el propietario de la empresa elige los módulos de un proyecto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(c.servicio_agua, false), COALESCE(c.servicio_condominios, false), COALESCE(c.servicio_rentas, false)
    INTO v_agua, v_condominios, v_rentas
    FROM public.companies c WHERE c.id = NEW.company_id;
  IF NOT COALESCE((v_agua AND NEW.modulo_agua)
               OR (v_condominios AND NEW.modulo_condominios)
               OR (v_rentas AND NEW.modulo_rentas), false) THEN
    RAISE EXCEPTION 'MODULOS_PROYECTO_VACIO: el proyecto debe conservar al menos un módulo de los que la empresa tiene contratados'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.projects_modulos_guard() IS
  'Trigger de projects: los interruptores modulo_* los mueve el propietario de la empresa o la plataforma, y el proyecto conserva al menos un módulo contratado.';
REVOKE EXECUTE ON FUNCTION public.projects_modulos_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_projects_modulos_guard ON public.projects;
CREATE TRIGGER trg_projects_modulos_guard
  BEFORE UPDATE OF modulo_agua, modulo_condominios, modulo_rentas ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_modulos_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Portal del residente: servicios de la empresa ∩ módulos del proyecto
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo cuerpo vigente (20260822000000); sólo cambian los dos flags.
CREATE OR REPLACE FUNCTION public.portal_mis_unidades()
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH roles AS (
    SELECT DISTINCT ON (m.unidad) m.unidad, m.rol
    FROM public.mis_unidad_roles() m
    ORDER BY m.unidad,
      CASE m.rol WHEN 'propietario' THEN 0 WHEN 'arrendatario' THEN 1 WHEN 'familiar' THEN 2 ELSE 3 END
  )
  SELECT to_jsonb(u.*)
    || jsonb_build_object(
         'rol', r.rol,
         'servicio_agua', COALESCE(c.servicio_agua AND p.modulo_agua, false),
         'servicio_condominios', COALESCE(c.servicio_condominios AND p.modulo_condominios, false))
    -- El contacto del propietario no es asunto del inquilino: se redacta
    -- server-side (la UI no tiene que acordarse de ocultarlo).
    || CASE WHEN r.rol = 'propietario' THEN '{}'::jsonb
       ELSE jsonb_build_object('propietario_telefono', NULL, 'propietario_email', NULL) END
  FROM roles r
  JOIN public.unidades u ON u.id = r.unidad
  LEFT JOIN public.projects p ON p.id = u.project_id
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE u.activo = true
  ORDER BY u.nombre
$fn$;
REVOKE ALL ON FUNCTION public.portal_mis_unidades() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.portal_mis_unidades() TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Rentas: no se enlaza a un proyecto que tiene Rentas apagado
-- ────────────────────────────────────────────────────────────────────────────
-- Trigger aparte (no se reescribe rentas_propiedad_coherente). Sólo al enlazar
-- o cambiar el enlace: una propiedad ya enlazada se sigue pudiendo editar.
-- SECURITY DEFINER porque lee projects, que quien escribe puede no tener a la
-- vista por su propia RLS (misma razón que rentas_propiedad_coherente).
DO $$
BEGIN
  IF to_regclass('public.rentas_propiedades') IS NULL THEN
    RAISE NOTICE 'modulos_por_proyecto: no existe rentas_propiedades; se omite la compuerta de Rentas';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.rentas_propiedad_modulo_proyecto()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $f$
  BEGIN
    IF NEW.project_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id)
       AND NOT COALESCE((SELECT pr.modulo_rentas FROM public.projects pr WHERE pr.id = NEW.project_id), true) THEN
      RAISE EXCEPTION 'RENTAS_PROYECTO_SIN_MODULO: ese proyecto no tiene activo Manejo de Rentas'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $f$;
  REVOKE EXECUTE ON FUNCTION public.rentas_propiedad_modulo_proyecto() FROM PUBLIC, anon, authenticated;

  DROP TRIGGER IF EXISTS trg_rentas_propiedades_modulo_proyecto ON public.rentas_propiedades;
  CREATE TRIGGER trg_rentas_propiedades_modulo_proyecto
    BEFORE INSERT OR UPDATE OF project_id ON public.rentas_propiedades
    FOR EACH ROW EXECUTE FUNCTION public.rentas_propiedad_modulo_proyecto();
END;
$$;
