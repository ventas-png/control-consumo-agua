-- Consolidate multiple permissive policies → 1 policy per command per table.
-- Tables: broadcasts, broadcast_recipients, app_users, clientes, companies,
--         company_clientes, fuentes_agua, registros, registros_calidad

-- ============================================================
-- broadcasts (fixes auth_rls_initplan + duplicate SELECT)
-- ============================================================
DROP POLICY IF EXISTS "staff_broadcasts_all" ON public.broadcasts;
DROP POLICY IF EXISTS "cliente_broadcasts_select" ON public.broadcasts;

CREATE POLICY "broadcasts_all" ON public.broadcasts
  FOR ALL TO authenticated
  USING (company_id IN (
    SELECT app_users.company_id FROM app_users WHERE app_users.id = (SELECT auth.uid())
  ))
  WITH CHECK (company_id IN (
    SELECT app_users.company_id FROM app_users WHERE app_users.id = (SELECT auth.uid())
  ));

-- ============================================================
-- broadcast_recipients (merge duplicate SELECT + UPDATE)
-- ============================================================
DROP POLICY IF EXISTS "staff_recipients_select" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_select" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "staff_recipients_update" ON public.broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_update" ON public.broadcast_recipients;

CREATE POLICY "broadcast_recipients_select" ON public.broadcast_recipients
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT app_users.company_id FROM app_users WHERE app_users.id = (SELECT auth.uid()))
    OR cliente_id IN (
      SELECT cc.cliente_id FROM company_clientes cc
      JOIN app_users u ON u.id = (SELECT auth.uid()) WHERE u.company_id = cc.company_id
    )
  );

CREATE POLICY "broadcast_recipients_update" ON public.broadcast_recipients
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT app_users.company_id FROM app_users WHERE app_users.id = (SELECT auth.uid()))
    OR cliente_id IN (
      SELECT cc.cliente_id FROM company_clientes cc
      JOIN app_users u ON u.id = (SELECT auth.uid()) WHERE u.company_id = cc.company_id
    )
  );

-- ============================================================
-- app_users (6 SELECT policies + 2 ALL → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "CompanyOwner can manage company users" ON public.app_users;
DROP POLICY IF EXISTS "SuperAdmin can manage all users" ON public.app_users;
DROP POLICY IF EXISTS "Managers can view users in their company" ON public.app_users;
DROP POLICY IF EXISTS "SuperAdmin can view all users" ON public.app_users;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.app_users;
DROP POLICY IF EXISTS "cliente_select_own_app_user" ON public.app_users;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.app_users;

CREATE POLICY "app_users_select" ON public.app_users
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR id = (SELECT auth.uid())
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner','admin']))
    OR (current_user_role() = 'cliente' AND cliente_id = (SELECT get_my_cliente_id()))
  );

CREATE POLICY "app_users_insert" ON public.app_users
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (is_company_owner() AND company_id = get_my_company_id()
        AND role <> ALL(ARRAY['super_admin','superadmin','company_owner']))
  );

CREATE POLICY "app_users_update" ON public.app_users
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (is_company_owner() AND company_id = get_my_company_id()
        AND role <> ALL(ARRAY['super_admin','superadmin','company_owner']))
    OR id = (SELECT auth.uid())
  )
  WITH CHECK (
    is_super_admin()
    OR (is_company_owner() AND company_id = get_my_company_id()
        AND role <> ALL(ARRAY['super_admin','superadmin','company_owner']))
    OR id = (SELECT auth.uid())
  );

CREATE POLICY "app_users_delete" ON public.app_users
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (is_company_owner() AND company_id = get_my_company_id()
        AND role <> ALL(ARRAY['super_admin','superadmin','company_owner']))
  );

-- ============================================================
-- clientes (2 SELECT + 2 UPDATE → 1 each)
-- ============================================================
DROP POLICY IF EXISTS "cliente_select_own" ON public.clientes;
DROP POLICY IF EXISTS "clientes_select_by_role" ON public.clientes;
DROP POLICY IF EXISTS "cliente_update_own_contact" ON public.clientes;
DROP POLICY IF EXISTS "clientes_update_by_role" ON public.clientes;

CREATE POLICY "clientes_select" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = 'cliente' AND id = get_my_cliente_id())
    OR EXISTS (
      SELECT 1 FROM company_clientes cc
      JOIN app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id AND cc.company_id = u.company_id
        AND current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador',
                                           'user','viewer','visor','cliente'])
    )
  );

CREATE POLICY "clientes_update" ON public.clientes
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = 'cliente' AND id = get_my_cliente_id())
    OR EXISTS (
      SELECT 1 FROM company_clientes cc
      JOIN app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id AND cc.company_id = u.company_id
        AND current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador','user'])
    )
  )
  WITH CHECK (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = 'cliente' AND id = get_my_cliente_id())
    OR EXISTS (
      SELECT 1 FROM company_clientes cc
      JOIN app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id AND cc.company_id = u.company_id
        AND current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador','user'])
    )
  );

-- ============================================================
-- companies (3 ALL + 2 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "CompanyOwner can manage their company" ON public.companies;
DROP POLICY IF EXISTS "SuperAdmin can manage all companies" ON public.companies;
DROP POLICY IF EXISTS "company_owner access on companies" ON public.companies;
DROP POLICY IF EXISTS "Users can view companies" ON public.companies;
DROP POLICY IF EXISTS "cliente_select_own_companies" ON public.companies;

CREATE POLICY "companies_select" ON public.companies
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND EXISTS (
      SELECT 1 FROM company_clientes cc
      WHERE cc.company_id = companies.id AND cc.cliente_id = get_my_cliente_id()
    ))
  );

CREATE POLICY "companies_insert" ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (is_company_owner() AND id = get_my_company_id()));

CREATE POLICY "companies_update" ON public.companies
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (is_company_owner() AND id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (is_company_owner() AND id = get_my_company_id()));

CREATE POLICY "companies_delete" ON public.companies
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (is_company_owner() AND id = get_my_company_id()));

-- ============================================================
-- company_clientes (3 ALL + 4 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "admin access on company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "company_owner access on company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "super_admin full access on company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "operator insert company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "cliente_select_own_company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "operator read company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "viewer read company_clientes" ON public.company_clientes;
DROP POLICY IF EXISTS "staff_company_clientes_update" ON public.company_clientes;

CREATE POLICY "company_clientes_select" ON public.company_clientes
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id())
    OR EXISTS (
      SELECT 1 FROM app_users WHERE id = (SELECT auth.uid())
        AND role = ANY(ARRAY['operator','operador','user','viewer','visor','cliente'])
        AND company_id = company_clientes.company_id
    )
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id())
  );

CREATE POLICY "company_clientes_insert" ON public.company_clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id())
    OR EXISTS (
      SELECT 1 FROM app_users WHERE id = (SELECT auth.uid())
        AND role = ANY(ARRAY['operator','operador','user'])
        AND company_id = company_clientes.company_id
    )
  );

CREATE POLICY "company_clientes_update" ON public.company_clientes
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR company_id IN (SELECT app_users.company_id FROM app_users WHERE id = (SELECT auth.uid()))
  );

CREATE POLICY "company_clientes_delete" ON public.company_clientes
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id())
  );

-- ============================================================
-- fuentes_agua (2 ALL + 4 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "fuentes_agua_company_owner" ON public.fuentes_agua;
DROP POLICY IF EXISTS "fuentes_agua_super_admin" ON public.fuentes_agua;
DROP POLICY IF EXISTS "fuentes_agua_staff_delete" ON public.fuentes_agua;
DROP POLICY IF EXISTS "fuentes_agua_staff_insert" ON public.fuentes_agua;
DROP POLICY IF EXISTS "fuentes_agua_staff_select" ON public.fuentes_agua;
DROP POLICY IF EXISTS "fuentes_agua_staff_update" ON public.fuentes_agua;

CREATE POLICY "fuentes_agua_select" ON public.fuentes_agua
  FOR SELECT TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador','viewer','visor'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "fuentes_agua_insert" ON public.fuentes_agua
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "fuentes_agua_update" ON public.fuentes_agua
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "fuentes_agua_delete" ON public.fuentes_agua
  FOR DELETE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin','admin'])
    OR (current_user_role() = 'company_owner' AND company_id = get_my_company_id())
  );

-- ============================================================
-- registros (1 ALL + 5 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "registros_access_by_role" ON public.registros;
DROP POLICY IF EXISTS "registros_delete_by_role" ON public.registros;
DROP POLICY IF EXISTS "registros_insert_by_role" ON public.registros;
DROP POLICY IF EXISTS "cliente_select_own_registros" ON public.registros;
DROP POLICY IF EXISTS "registros_select_by_role" ON public.registros;
DROP POLICY IF EXISTS "registros_update_by_role" ON public.registros;

CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner',
                                   'operator','operador','user','viewer','visor','cliente'])
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id())
  );

CREATE POLICY "registros_insert" ON public.registros
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner','operator','operador'])
    OR EXISTS (
      SELECT 1 FROM user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
  );

CREATE POLICY "registros_update" ON public.registros
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner','operator','operador'])
    OR EXISTS (
      SELECT 1 FROM user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
  )
  WITH CHECK (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner','operator','operador'])
    OR EXISTS (
      SELECT 1 FROM user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
  );

CREATE POLICY "registros_delete" ON public.registros
  FOR DELETE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner'])
    OR EXISTS (
      SELECT 1 FROM user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
  );

-- ============================================================
-- registros_calidad (2 ALL + 4 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "registros_calidad_company_owner" ON public.registros_calidad;
DROP POLICY IF EXISTS "registros_calidad_super_admin" ON public.registros_calidad;
DROP POLICY IF EXISTS "registros_calidad_staff_delete" ON public.registros_calidad;
DROP POLICY IF EXISTS "registros_calidad_staff_insert" ON public.registros_calidad;
DROP POLICY IF EXISTS "registros_calidad_staff_select" ON public.registros_calidad;
DROP POLICY IF EXISTS "registros_calidad_staff_update" ON public.registros_calidad;

CREATE POLICY "registros_calidad_select" ON public.registros_calidad
  FOR SELECT TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador','viewer','visor'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "registros_calidad_insert" ON public.registros_calidad
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "registros_calidad_update" ON public.registros_calidad
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "registros_calidad_delete" ON public.registros_calidad
  FOR DELETE TO authenticated
  USING (
    current_user_role() = ANY(ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator','operador'])
        AND company_id = get_my_company_id())
  );
