-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de fix_asignaciones.sql: vuelve las tres políticas de escritura de public.user_project_assignments a su texto de
-- producción / repo (supabase/migrations/20260417000013_consolidate_rls_policies_part2.sql, líneas 548-580; verificado igual a la
-- consulta de solo lectura a producción del 2026-10-10). Idempotente. Deja EXACTAMENTE el hueco original (quien revierte lo reabre).
-- ════════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "user_project_assignments_insert" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "user_project_assignments_update" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_update" ON public.user_project_assignments
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "user_project_assignments_delete" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );
