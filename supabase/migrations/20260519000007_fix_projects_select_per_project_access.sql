-- ============================================================
-- Fix: scope projects_select to the user's assigned projects
-- ============================================================
-- The previous projects_select policy let ANY authenticated member of a
-- company read ALL of that company's projects, ignoring per-user project
-- assignments. A "viewer"/"operator" assigned to one condominio could
-- enumerate every condominio in the company (e.g. via the project selector
-- or a direct PostgREST call).
--
-- New policy keeps full company visibility for company_owner/admin/super_admin
-- (matches PROJECT_EXEMPT_ROLES in src/hooks/useData.ts) and the cliente
-- portal path, but restricts every other role to the projects they actually
-- have access to via the existing role-agnostic helper user_has_project_access()
-- (which checks both app_users.project_id and user_project_assignments).

DROP POLICY IF EXISTS "projects_select" ON public.projects;

CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND (
        current_user_role() = ANY (ARRAY['company_owner', 'admin'])
        OR public.user_has_project_access(projects.id)
      )
    )
    OR (
      current_user_role() = 'cliente' AND EXISTS (
        SELECT 1 FROM public.company_clientes cc
        WHERE cc.company_id = projects.company_id
          AND cc.cliente_id = get_my_cliente_id()
      )
    )
  );
