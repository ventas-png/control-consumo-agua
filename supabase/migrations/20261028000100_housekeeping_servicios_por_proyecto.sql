-- ════════════════════════════════════════════════════════════════════════════
-- Housekeeping · el SERVICIO (sus textos y sus sellos) se acota al proyecto
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ CIERRA
--   Las policies previas de `servicios_housekeeping` solo exigían empresa + el
--   permiso de la pestaña: un operador asignado al proyecto A2 leía, y podía
--   MODIFICAR, los servicios del proyecto A1 de su empresa — incluidos los textos
--   de evidencia (`hallazgos_ingreso`, `observaciones_cierre`) y el estado, cuyo
--   cambio sella `completado_por`. Las fotos ya estaban acotadas al proyecto
--   (20261028000000, `hk_acceso`); el texto, que es la otra mitad de la
--   evidencia, no. Encontrado con inicio de sesión real en el sandbox (PR #927).
--
-- LA REGLA ES LA MISMA QUE LA DE LAS FOTOS: `public.hk_acceso(empresa, proyecto)`
--   super_admin, o empresa del usuario + permiso `condominios.tab.housekeeping`
--   + `can_access_project(proyecto)`.
--   · SELECT: esa regla, O el residente de la unidad del servicio (rama previa,
--     sin cambios: `unidad_id IN (SELECT mis_unidades_ids())`).
--   · INSERT / UPDATE: esa regla (USING y WITH CHECK: tampoco se puede MOVER un
--     servicio a un proyecto ajeno).
--   · DELETE: como antes (dueño o admin de la empresa) y además con acceso al
--     proyecto. El borrado normal va por la RPC `hk_eliminar_servicio`, que ya
--     exigía lo mismo.
--   Quien está exento de proyecto (dueño, admin sin asignaciones, super_admin)
--   no nota ningún cambio. El listado de la pestaña ya filtra por proyecto.
--
-- Idempotente (DROP POLICY IF EXISTS + CREATE). No cambia filas.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS servicios_housekeeping_select ON public.servicios_housekeeping;
DROP POLICY IF EXISTS servicios_housekeeping_insert ON public.servicios_housekeeping;
DROP POLICY IF EXISTS servicios_housekeeping_update ON public.servicios_housekeeping;
DROP POLICY IF EXISTS servicios_housekeeping_delete ON public.servicios_housekeeping;

CREATE POLICY servicios_housekeeping_select ON public.servicios_housekeeping
  FOR SELECT TO authenticated
  USING (
    public.hk_acceso(company_id, project_id)
    OR (unidad_id IN (SELECT public.mis_unidades_ids()))
  );

CREATE POLICY servicios_housekeeping_insert ON public.servicios_housekeeping
  FOR INSERT TO authenticated
  WITH CHECK (public.hk_acceso(company_id, project_id));

CREATE POLICY servicios_housekeeping_update ON public.servicios_housekeeping
  FOR UPDATE TO authenticated
  USING (public.hk_acceso(company_id, project_id))
  WITH CHECK (public.hk_acceso(company_id, project_id));

CREATE POLICY servicios_housekeeping_delete ON public.servicios_housekeeping
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      (SELECT public.current_user_role()) = ANY (ARRAY['company_owner', 'admin'])
      AND company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
    )
  );
