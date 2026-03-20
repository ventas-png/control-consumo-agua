-- ============================================================
-- Restructurar jerarquía de administración
-- Nueva jerarquía: super_admin → company_owner → admin → operator/viewer
-- ============================================================

-- 1. Agregar límite de proyectos por empresa (configurado por superadmin)
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS max_projects integer NOT NULL DEFAULT 5;

-- 2. Helper function: verificar si el usuario actual es super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN ('super_admin', 'superadmin')
$$;

-- 3. Helper function: verificar si es company_owner
CREATE OR REPLACE FUNCTION public.is_company_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() = 'company_owner'
$$;

-- ============================================================
-- COMPANIES: super_admin ve y gestiona TODAS las empresas
-- ============================================================
DROP POLICY IF EXISTS "Users can view their own company" ON public.companies;
DROP POLICY IF EXISTS "Admins can manage their company" ON public.companies;

-- Visualización: super_admin ve todo, demás ven solo su empresa
CREATE POLICY "Users can view companies" ON public.companies FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR id = get_my_company_id()
  );

-- Super admin puede gestionar todas las empresas
CREATE POLICY "SuperAdmin can manage all companies" ON public.companies FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Company owner puede gestionar su propia empresa
CREATE POLICY "CompanyOwner can manage their company" ON public.companies FOR ALL
  TO authenticated
  USING (
    is_company_owner()
    AND id = get_my_company_id()
  )
  WITH CHECK (
    is_company_owner()
    AND id = get_my_company_id()
  );

-- ============================================================
-- PROJECTS: company_owner crea proyectos, admin los gestiona
-- ============================================================
DROP POLICY IF EXISTS "Users can view projects in their company" ON public.projects;
DROP POLICY IF EXISTS "Admins can manage projects in their company" ON public.projects;

-- Visualización: super_admin ve todos, demás ven los de su empresa
CREATE POLICY "Users can view projects" ON public.projects FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
  );

-- company_owner y admin pueden gestionar proyectos de su empresa
-- super_admin puede gestionar cualquier proyecto
CREATE POLICY "Managers can manage projects" ON public.projects FOR ALL
  TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- ============================================================
-- APP_USERS: actualizar políticas para la nueva jerarquía
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all users in their company" ON public.app_users;
DROP POLICY IF EXISTS "Admins can manage users in their company" ON public.app_users;

-- super_admin ve todos los usuarios de todas las empresas
CREATE POLICY "SuperAdmin can view all users" ON public.app_users FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- company_owner y admin ven usuarios de su empresa
CREATE POLICY "Managers can view users in their company" ON public.app_users FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN ('company_owner', 'admin')
    AND company_id = get_my_company_id()
  );

-- super_admin puede gestionar todos los usuarios
CREATE POLICY "SuperAdmin can manage all users" ON public.app_users FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- company_owner puede crear/gestionar admins, operators, viewers de su empresa
-- (no puede crear otros company_owners ni super_admins)
CREATE POLICY "CompanyOwner can manage company users" ON public.app_users FOR ALL
  TO authenticated
  USING (
    is_company_owner()
    AND company_id = get_my_company_id()
    AND role NOT IN ('super_admin', 'superadmin', 'company_owner')
  )
  WITH CHECK (
    is_company_owner()
    AND company_id = get_my_company_id()
    AND role NOT IN ('super_admin', 'superadmin', 'company_owner')
  );

-- ============================================================
-- USER_PROJECT_ASSIGNMENTS: company_owner asigna accesos
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all assignments in their company" ON public.user_project_assignments;
DROP POLICY IF EXISTS "Admins can manage assignments in their company" ON public.user_project_assignments;

-- super_admin ve todas las asignaciones
CREATE POLICY "SuperAdmin can view all assignments" ON public.user_project_assignments FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- company_owner y admin ven asignaciones de proyectos de su empresa
CREATE POLICY "Managers can view assignments in their company" ON public.user_project_assignments FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN ('company_owner', 'admin')
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  );

-- super_admin gestiona todas las asignaciones
CREATE POLICY "SuperAdmin can manage all assignments" ON public.user_project_assignments FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- company_owner gestiona asignaciones de su empresa
CREATE POLICY "CompanyOwner can manage assignments" ON public.user_project_assignments FOR ALL
  TO authenticated
  USING (
    is_company_owner()
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  )
  WITH CHECK (
    is_company_owner()
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  );

-- ============================================================
-- PAGOS: actualizar para la nueva jerarquía
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all pagos in their company" ON public.pagos;
DROP POLICY IF EXISTS "Admins can manage pagos in their company" ON public.pagos;

-- super_admin ve todos los pagos
CREATE POLICY "SuperAdmin can view all pagos" ON public.pagos FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- company_owner ve todos los pagos de su empresa
CREATE POLICY "CompanyOwner can view company pagos" ON public.pagos FOR SELECT
  TO authenticated
  USING (
    is_company_owner()
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  );

-- admin ve pagos de su empresa
CREATE POLICY "Admin can view company pagos" ON public.pagos FOR SELECT
  TO authenticated
  USING (
    current_user_role() = 'admin'
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  );

-- super_admin gestiona todos los pagos
CREATE POLICY "SuperAdmin can manage all pagos" ON public.pagos FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- company_owner y admin gestionan pagos de su empresa
CREATE POLICY "Managers can manage company pagos" ON public.pagos FOR ALL
  TO authenticated
  USING (
    current_user_role() IN ('company_owner', 'admin')
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  )
  WITH CHECK (
    current_user_role() IN ('company_owner', 'admin')
    AND project_id IN (
      SELECT id FROM public.projects WHERE company_id = get_my_company_id()
    )
  );
