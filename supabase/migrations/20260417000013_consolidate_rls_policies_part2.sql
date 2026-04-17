-- Part 2: contadores, energia tables, pagos, projects, tarifas, unidades,
--         user_module_permissions, user_project_assignments

-- ============================================================
-- contadores (3 ALL + 7 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on contadores" ON public.contadores;
DROP POLICY IF EXISTS "company_owner access on contadores" ON public.contadores;
DROP POLICY IF EXISTS "super_admin full access on contadores" ON public.contadores;
DROP POLICY IF EXISTS "admin insert contadores" ON public.contadores;
DROP POLICY IF EXISTS "operator insert contadores" ON public.contadores;
DROP POLICY IF EXISTS "admin read contadores" ON public.contadores;
DROP POLICY IF EXISTS "cliente_select_own_contadores" ON public.contadores;
DROP POLICY IF EXISTS "operator access on contadores" ON public.contadores;
DROP POLICY IF EXISTS "operator read contadores" ON public.contadores;
DROP POLICY IF EXISTS "viewer read contadores" ON public.contadores;
DROP POLICY IF EXISTS "admin update contadores" ON public.contadores;
DROP POLICY IF EXISTS "operator update contadores" ON public.contadores;

CREATE POLICY "contadores_select" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
    OR (current_user_role() = 'cliente' AND activo = true AND EXISTS (
      SELECT 1 FROM unidades u
      WHERE u.id = contadores.unidad_id AND u.cliente_id = get_my_cliente_id()
    ))
  );

CREATE POLICY "contadores_insert" ON public.contadores
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "contadores_update" ON public.contadores
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "contadores_delete" ON public.contadores
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

-- ============================================================
-- facturas_energia (3 ALL + 1 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on facturas_energia" ON public.facturas_energia;
DROP POLICY IF EXISTS "company_owner access on facturas_energia" ON public.facturas_energia;
DROP POLICY IF EXISTS "super_admin full access on facturas_energia" ON public.facturas_energia;
DROP POLICY IF EXISTS "operator read facturas_energia" ON public.facturas_energia;

CREATE POLICY "facturas_energia_select" ON public.facturas_energia
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "facturas_energia_insert" ON public.facturas_energia
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "facturas_energia_update" ON public.facturas_energia
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "facturas_energia_delete" ON public.facturas_energia
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

-- ============================================================
-- fuentes_energia (3 ALL + 1 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on fuentes_energia" ON public.fuentes_energia;
DROP POLICY IF EXISTS "company_owner access on fuentes_energia" ON public.fuentes_energia;
DROP POLICY IF EXISTS "super_admin full access on fuentes_energia" ON public.fuentes_energia;
DROP POLICY IF EXISTS "operator read fuentes_energia" ON public.fuentes_energia;

CREATE POLICY "fuentes_energia_select" ON public.fuentes_energia
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "fuentes_energia_insert" ON public.fuentes_energia
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "fuentes_energia_update" ON public.fuentes_energia
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "fuentes_energia_delete" ON public.fuentes_energia
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

-- ============================================================
-- pagos (2 ALL + 6 SELECT + 1 INSERT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "Managers can manage company pagos" ON public.pagos;
DROP POLICY IF EXISTS "SuperAdmin can manage all pagos" ON public.pagos;
DROP POLICY IF EXISTS "admin create pagos" ON public.pagos;
DROP POLICY IF EXISTS "Admin can view company pagos" ON public.pagos;
DROP POLICY IF EXISTS "CompanyOwner can view company pagos" ON public.pagos;
DROP POLICY IF EXISTS "SuperAdmin can view all pagos" ON public.pagos;
DROP POLICY IF EXISTS "Users can view pagos for their assigned projects" ON public.pagos;
DROP POLICY IF EXISTS "company_owner view pagos" ON public.pagos;

CREATE POLICY "pagos_select" ON public.pagos
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT projects.id FROM projects WHERE projects.company_id = get_my_company_id()))
    OR EXISTS (
      SELECT 1 FROM user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = pagos.project_id
    )
  );

CREATE POLICY "pagos_insert" ON public.pagos
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT projects.id FROM projects WHERE projects.company_id = get_my_company_id()))
    OR EXISTS (
      SELECT 1 FROM user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = pagos.project_id
        AND current_user_role() = ANY(ARRAY['admin','operator','operador'])
    )
  );

CREATE POLICY "pagos_update" ON public.pagos
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT projects.id FROM projects WHERE projects.company_id = get_my_company_id()))
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT projects.id FROM projects WHERE projects.company_id = get_my_company_id()))
  );

CREATE POLICY "pagos_delete" ON public.pagos
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT projects.id FROM projects WHERE projects.company_id = get_my_company_id()))
  );

-- ============================================================
-- projects (1 ALL + 2 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "Managers can manage projects" ON public.projects;
DROP POLICY IF EXISTS "Users can view projects" ON public.projects;
DROP POLICY IF EXISTS "cliente_select_own_projects" ON public.projects;

CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND EXISTS (
      SELECT 1 FROM company_clientes cc
      WHERE cc.company_id = projects.company_id AND cc.cliente_id = get_my_cliente_id()
    ))
  );

CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner','admin']))
  );

CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner','admin']))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner','admin']))
  );

CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner','admin']))
  );

-- ============================================================
-- proveedores_energia (3 ALL + 1 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on proveedores_energia" ON public.proveedores_energia;
DROP POLICY IF EXISTS "company_owner access on proveedores_energia" ON public.proveedores_energia;
DROP POLICY IF EXISTS "super_admin full access on proveedores_energia" ON public.proveedores_energia;
DROP POLICY IF EXISTS "operator read proveedores_energia" ON public.proveedores_energia;

CREATE POLICY "proveedores_energia_select" ON public.proveedores_energia
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "proveedores_energia_insert" ON public.proveedores_energia
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "proveedores_energia_update" ON public.proveedores_energia
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "proveedores_energia_delete" ON public.proveedores_energia
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

-- ============================================================
-- tarifas (4 ALL + 2 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "company_owner access on tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "operator write tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "super_admin full access on tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "operator read tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "viewer read tarifas" ON public.tarifas;

CREATE POLICY "tarifas_select" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
  );

CREATE POLICY "tarifas_insert" ON public.tarifas
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "tarifas_update" ON public.tarifas
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "tarifas_delete" ON public.tarifas
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

-- ============================================================
-- tarifas_energia (3 ALL + 1 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on tarifas_energia" ON public.tarifas_energia;
DROP POLICY IF EXISTS "company_owner access on tarifas_energia" ON public.tarifas_energia;
DROP POLICY IF EXISTS "super_admin full access on tarifas_energia" ON public.tarifas_energia;
DROP POLICY IF EXISTS "operator read tarifas_energia" ON public.tarifas_energia;

CREATE POLICY "tarifas_energia_select" ON public.tarifas_energia
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "tarifas_energia_insert" ON public.tarifas_energia
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "tarifas_energia_update" ON public.tarifas_energia
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

CREATE POLICY "tarifas_energia_delete" ON public.tarifas_energia
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

-- ============================================================
-- unidades (3 ALL + 5 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on unidades" ON public.unidades;
DROP POLICY IF EXISTS "company_owner access on unidades" ON public.unidades;
DROP POLICY IF EXISTS "super_admin full access on unidades" ON public.unidades;
DROP POLICY IF EXISTS "company_owner delete unidades" ON public.unidades;
DROP POLICY IF EXISTS "operator insert unidades" ON public.unidades;
DROP POLICY IF EXISTS "cliente_select_own_unidades" ON public.unidades;
DROP POLICY IF EXISTS "operator read unidades" ON public.unidades;
DROP POLICY IF EXISTS "viewer read unidades" ON public.unidades;
DROP POLICY IF EXISTS "operator update unidades" ON public.unidades;

CREATE POLICY "unidades_select" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id() AND activo = true)
  );

CREATE POLICY "unidades_insert" ON public.unidades
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "unidades_update" ON public.unidades
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
  );

CREATE POLICY "unidades_delete" ON public.unidades
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
  );

-- ============================================================
-- user_module_permissions (3 ALL + 3 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "Admin manage all module permissions" ON public.user_module_permissions;
DROP POLICY IF EXISTS "CompanyOwner manages company module permissions" ON public.user_module_permissions;
DROP POLICY IF EXISTS "SuperAdmin manages all module permissions" ON public.user_module_permissions;
DROP POLICY IF EXISTS "CompanyOwner views company module permissions" ON public.user_module_permissions;
DROP POLICY IF EXISTS "SuperAdmin views all module permissions" ON public.user_module_permissions;
DROP POLICY IF EXISTS "Users view own module permissions" ON public.user_module_permissions;

CREATE POLICY "user_module_permissions_select" ON public.user_module_permissions
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (is_company_owner() AND user_id IN (
      SELECT id FROM app_users WHERE company_id = get_my_company_id()
    ))
    OR current_user_role() = 'admin'
    OR user_id = (SELECT get_my_user_id())
  );

CREATE POLICY "user_module_permissions_insert" ON public.user_module_permissions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (is_company_owner() AND user_id IN (
      SELECT id FROM app_users WHERE company_id = get_my_company_id()
    ))
    OR current_user_role() = 'admin'
  );

CREATE POLICY "user_module_permissions_update" ON public.user_module_permissions
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (is_company_owner() AND user_id IN (
      SELECT id FROM app_users WHERE company_id = get_my_company_id()
    ))
    OR current_user_role() = 'admin'
  )
  WITH CHECK (
    is_super_admin()
    OR (is_company_owner() AND user_id IN (
      SELECT id FROM app_users WHERE company_id = get_my_company_id()
    ))
    OR current_user_role() = 'admin'
  );

CREATE POLICY "user_module_permissions_delete" ON public.user_module_permissions
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (is_company_owner() AND user_id IN (
      SELECT id FROM app_users WHERE company_id = get_my_company_id()
    ))
    OR current_user_role() = 'admin'
  );

-- ============================================================
-- user_project_assignments (4 ALL + 3 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "Admin can manage assignments in their company" ON public.user_project_assignments;
DROP POLICY IF EXISTS "CompanyOwner can manage assignments" ON public.user_project_assignments;
DROP POLICY IF EXISTS "SuperAdmin can manage all assignments" ON public.user_project_assignments;
DROP POLICY IF EXISTS "Users can manage their project assignments" ON public.user_project_assignments;
DROP POLICY IF EXISTS "Managers can view assignments in their company" ON public.user_project_assignments;
DROP POLICY IF EXISTS "SuperAdmin can view all assignments" ON public.user_project_assignments;
DROP POLICY IF EXISTS "Users can view their own project assignments" ON public.user_project_assignments;

CREATE POLICY "user_project_assignments_select" ON public.user_project_assignments
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );

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

CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id()))
    OR user_id = (SELECT auth.uid())
  );
