-- ════════════════════════════════════════════════════════════════════════════
-- PROPUESTA · NO APLICADA (queda FUERA de la pieza de permisos y de la migración 20261027000900)
-- user_project_assignments: nadie se asigna ni se quita proyectos a sí mismo con una escritura directa por la API.
--
-- PROBLEMA (preexistente; producción = repo, 2026-10-10, ver politica_actual_produccion.md)
--   Las políticas INSERT / UPDATE / DELETE de public.user_project_assignments terminan en `OR user_id = (SELECT auth.uid())`:
--   cualquier usuario autenticado, de cualquier rol, puede insertarse una asignación a CUALQUIER proyecto (también de otra empresa:
--   el project_id propio no se acota) o borrar las suyas. `can_access_project()` y `user_is_project_exempt()` leen esa tabla, así
--   que todo el alcance de proyecto del circuito de compras (y las políticas SELECT por proyecto) deja de ser un límite real:
--     · un operador asignado a A se asigna B con un POST /rest/v1/user_project_assignments y, desde ese momento, ve y actúa en B;
--     · un administrador con asignaciones borra las suyas y pasa a ser «exento de proyecto» (admin sin asignaciones = exento).
--
-- CORRECCIÓN (solo políticas RLS; ningún dato, ninguna función, ningún grant)
--   Altas, cambios y bajas de asignaciones:
--     · superadministrador: cualquiera;
--     · propietario de la empresa (company_owner): sobre proyectos de su empresa, a cualquier persona (también a sí mismo: es exento);
--     · administrador (admin): sobre proyectos de su empresa, a OTRAS personas — nunca a sí mismo (si pudiera, ampliaría su alcance o
--       se volvería exento borrando las suyas).
--   La persona conserva LEER las suyas (la política SELECT NO se toca). Quedan 4 políticas con los mismos nombres.
--
-- QUÉ CAMBIA PARA LA APLICACIÓN (ver flujos_que_escriben_asignaciones.md)
--   El único flujo que escribe la tabla desde el navegador es AsignacionModal (administración de usuarios): borra e inserta las
--   asignaciones de LA PERSONA QUE SE EDITA. Si un administrador se edita a sí mismo desde esa pantalla, ahora recibe error de RLS
--   (propietario y superadministrador no cambian). Las edge functions escriben con el rol de servicio y no pasan por RLS.
--
-- DESPLIEGUE (alguien lo lleva como PR y despliegue propios): pegar en una migración nueva, dentro de la transacción de la migración.
-- DROP/CREATE POLICY toman ACCESS EXCLUSIVE sobre la tabla (ALTER POLICY también, medido en PostgreSQL 16): tabla pequeña, breve.
-- IDEMPOTENTE (se puede correr dos veces). Reversión exacta: reversion_asignaciones.sql.
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "user_project_assignments_insert" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = 'company_owner'
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR (current_user_role() = 'admin' AND user_id <> (SELECT auth.uid())
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
  );

DROP POLICY IF EXISTS "user_project_assignments_update" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_update" ON public.user_project_assignments
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = 'company_owner'
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR (current_user_role() = 'admin' AND user_id <> (SELECT auth.uid())
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = 'company_owner'
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR (current_user_role() = 'admin' AND user_id <> (SELECT auth.uid())
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
  );

DROP POLICY IF EXISTS "user_project_assignments_delete" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = 'company_owner'
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR (current_user_role() = 'admin' AND user_id <> (SELECT auth.uid())
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
  );
