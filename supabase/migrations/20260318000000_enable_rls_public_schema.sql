-- ============================================================
-- Enable RLS on all public tables exposed to PostgREST
-- ============================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- COMPANIES
-- A user can see only their own company
-- ============================================================
CREATE POLICY "Users can view their own company"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
  );

CREATE POLICY "Admins can manage their company"
  ON public.companies FOR ALL
  TO authenticated
  USING (
    id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'superadmin') LIMIT 1)
  )
  WITH CHECK (
    id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() AND role IN ('admin', 'superadmin') LIMIT 1)
  );

-- ============================================================
-- APP_USERS
-- Users can see their own profile; admins can see all users in their company
-- ============================================================
CREATE POLICY "Users can view their own profile"
  ON public.app_users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins can view all users in their company"
  ON public.app_users FOR SELECT
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can manage users in their company"
  ON public.app_users FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- ============================================================
-- PROJECTS
-- Users see projects in their company; admins can manage them
-- ============================================================
CREATE POLICY "Users can view projects in their company"
  ON public.projects FOR SELECT
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
  );

CREATE POLICY "Admins can manage projects in their company"
  ON public.projects FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- ============================================================
-- USER_PROJECT_ASSIGNMENTS
-- Users see their own assignments; admins see all in their company
-- ============================================================
CREATE POLICY "Users can view their own project assignments"
  ON public.user_project_assignments FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all assignments in their company"
  ON public.user_project_assignments FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    )
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can manage assignments in their company"
  ON public.user_project_assignments FOR ALL
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    )
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects
      WHERE company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    )
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

-- ============================================================
-- PAGOS
-- Users see pagos for their assigned projects; admins see all in their company
-- ============================================================
CREATE POLICY "Users can view pagos for their assigned projects"
  ON public.pagos FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT project_id FROM public.user_project_assignments WHERE user_id = auth.uid()
    )
    OR cliente_id = auth.uid()
  );

CREATE POLICY "Admins can view all pagos in their company"
  ON public.pagos FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    )
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );

CREATE POLICY "Admins can manage pagos in their company"
  ON public.pagos FOR ALL
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    )
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects
      WHERE company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    )
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('admin', 'superadmin')
    )
  );
