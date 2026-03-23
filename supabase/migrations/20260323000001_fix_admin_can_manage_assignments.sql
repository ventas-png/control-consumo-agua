-- Fix: Allow admin role to manage project assignments within their company
-- Previously only company_owner could INSERT/UPDATE/DELETE, causing silent failures for admin users.
CREATE POLICY "Admin can manage assignments in their company"
  ON public.user_project_assignments FOR ALL
  TO authenticated
  USING (
    current_user_role() = 'admin'
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  )
  WITH CHECK (
    current_user_role() = 'admin'
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  );
