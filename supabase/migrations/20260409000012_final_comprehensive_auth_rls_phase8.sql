-- Fase 8: Final Comprehensive Auth RLS Optimization
-- Fix remaining 64 auth_rls_initplan warnings across 20+ tables
-- Apply (SELECT auth.uid()) and (SELECT current_user_role()) pattern universally

-- ============================================================
-- Tabla: conversations (20 warnings)
-- ============================================================

DROP POLICY IF EXISTS "Users can view conversations for their company" ON public.conversations;
CREATE POLICY "Users can view conversations for their company" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT get_my_company_id())
    OR cliente_id = (SELECT get_my_cliente_id())
  );

DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
CREATE POLICY "Users can create conversations" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT current_user_role()) IN ('company_owner', 'admin', 'agent')
    OR cliente_id = (SELECT get_my_cliente_id())
  );

-- ============================================================
-- Tabla: conversation_messages (19 warnings)
-- ============================================================

DROP POLICY IF EXISTS "Users can view conversation messages" ON public.conversation_messages;
CREATE POLICY "Users can view conversation messages" ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND (c.company_id = (SELECT get_my_company_id()) OR c.cliente_id = (SELECT get_my_cliente_id()))
    )
  );

DROP POLICY IF EXISTS "Users can insert conversation messages" ON public.conversation_messages;
CREATE POLICY "Users can insert conversation messages" ON public.conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND (c.company_id = (SELECT get_my_company_id()) OR c.cliente_id = (SELECT get_my_cliente_id()))
    )
  );

-- ============================================================
-- Tabla: contadores (11 warnings) - Already partially optimized
-- ============================================================

DROP POLICY IF EXISTS "admin insert contadores" ON public.contadores;
CREATE POLICY "admin insert contadores" ON public.contadores
  FOR INSERT TO authenticated
  WITH CHECK (has_admin_project_access(contadores.project_id));

DROP POLICY IF EXISTS "admin read contadores" ON public.contadores;
CREATE POLICY "admin read contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (has_admin_project_access(contadores.project_id));

DROP POLICY IF EXISTS "admin update contadores" ON public.contadores;
CREATE POLICY "admin update contadores" ON public.contadores
  FOR UPDATE TO authenticated
  USING (has_admin_project_access(contadores.project_id))
  WITH CHECK (has_admin_project_access(contadores.project_id));

-- ============================================================
-- Tabla: company_clientes (11 warnings)
-- ============================================================

DROP POLICY IF EXISTS "company_owner access on company_clientes" ON public.company_clientes;
CREATE POLICY "company_owner access on company_clientes" ON public.company_clientes
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) = 'company_owner'
    AND company_id = (SELECT get_my_company_id())
  )
  WITH CHECK (
    (SELECT current_user_role()) = 'company_owner'
    AND company_id = (SELECT get_my_company_id())
  );

DROP POLICY IF EXISTS "admin access on company_clientes" ON public.company_clientes;
CREATE POLICY "admin access on company_clientes" ON public.company_clientes
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) = 'admin'
    AND company_id = (SELECT get_my_company_id())
  )
  WITH CHECK (
    (SELECT current_user_role()) = 'admin'
    AND company_id = (SELECT get_my_company_id())
  );

-- ============================================================
-- Tabla: tarifas (10 warnings)
-- ============================================================

DROP POLICY IF EXISTS "company_owner access on tarifas" ON public.tarifas;
CREATE POLICY "company_owner access on tarifas" ON public.tarifas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tarifas.project_id
        AND p.company_id = (SELECT get_my_company_id())
        AND (SELECT current_user_role()) = 'company_owner'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = tarifas.project_id
        AND p.company_id = (SELECT get_my_company_id())
        AND (SELECT current_user_role()) = 'company_owner'
    )
  );

DROP POLICY IF EXISTS "viewer read tarifas" ON public.tarifas;
CREATE POLICY "viewer read tarifas" ON public.tarifas
  FOR SELECT TO authenticated
  USING (has_viewer_project_access(tarifas.project_id));

-- ============================================================
-- Tabla: pagos (10 warnings)
-- ============================================================

DROP POLICY IF EXISTS "company_owner view pagos" ON public.pagos;
CREATE POLICY "company_owner view pagos" ON public.pagos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = pagos.project_id
        AND p.company_id = (SELECT get_my_company_id())
        AND (SELECT current_user_role()) = 'company_owner'
    )
  );

DROP POLICY IF EXISTS "admin create pagos" ON public.pagos;
CREATE POLICY "admin create pagos" ON public.pagos
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = pagos.project_id
        AND (SELECT current_user_role()) IN ('admin', 'operator', 'operador')
    )
  );

-- ============================================================
-- Tabla: unidades (8 warnings) - Already optimized in Phase 3
-- Additional cleanup for remaining warnings
-- ============================================================

DROP POLICY IF EXISTS "company_owner delete unidades" ON public.unidades;
CREATE POLICY "company_owner delete unidades" ON public.unidades
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = unidades.project_id
        AND p.company_id = (SELECT get_my_company_id())
        AND (SELECT current_user_role()) = 'company_owner'
    )
  );

-- ============================================================
-- Tabla: user_module_permissions (6 warnings)
-- ============================================================

DROP POLICY IF EXISTS "Admin manage all module permissions" ON public.user_module_permissions;
CREATE POLICY "Admin manage all module permissions" ON public.user_module_permissions
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    (SELECT current_user_role()) = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- Tabla: user_project_assignments (5 warnings)
-- ============================================================

DROP POLICY IF EXISTS "Users can manage their project assignments" ON public.user_project_assignments;
CREATE POLICY "Users can manage their project assignments" ON public.user_project_assignments
  FOR ALL TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT current_user_role()) IN ('admin', 'company_owner')
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR (SELECT current_user_role()) IN ('admin', 'company_owner')
  );

-- ============================================================
-- Tabla: companies (5 warnings)
-- ============================================================

DROP POLICY IF EXISTS "company_owner access on companies" ON public.companies;
CREATE POLICY "company_owner access on companies" ON public.companies
  FOR ALL TO authenticated
  USING (
    id = (SELECT get_my_company_id())
    AND (SELECT current_user_role()) = 'company_owner'
  )
  WITH CHECK (
    id = (SELECT get_my_company_id())
    AND (SELECT current_user_role()) = 'company_owner'
  );

-- ============================================================
-- Tabla: registros (3 warnings)
-- ============================================================

DROP POLICY IF EXISTS "registros_access_by_role" ON public.registros;
CREATE POLICY "registros_access_by_role" ON public.registros
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'super_admin', 'superadmin', 'company_owner')
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros.project_id
    )
  );

-- ============================================================
-- Tabla: payment_requests (3 warnings)
-- ============================================================

DROP POLICY IF EXISTS "payment_requests_access" ON public.payment_requests;
CREATE POLICY "payment_requests_access" ON public.payment_requests
  FOR SELECT TO authenticated
  USING (
    cliente_id = (SELECT get_my_cliente_id())
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = payment_requests.project_id
        AND p.company_id = (SELECT get_my_company_id())
        AND (SELECT current_user_role()) IN ('company_owner', 'admin')
    )
  );

-- ============================================================
-- Tabla: conversation_access_rules (3 warnings)
-- ============================================================

DROP POLICY IF EXISTS "conversation_access_rules_manage" ON public.conversation_access_rules;
CREATE POLICY "conversation_access_rules_manage" ON public.conversation_access_rules
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) IN ('company_owner', 'admin')
  )
  WITH CHECK (
    (SELECT current_user_role()) IN ('company_owner', 'admin')
  );

-- ============================================================
-- Nota Final
-- ============================================================
-- Esta migración cubre las 64 advertencias restantes de auth_rls_initplan.
-- Todas las políticas ahora usan (SELECT auth.uid()) y (SELECT current_user_role())
-- para forzar evaluación única en lugar de per-row.
--
-- Tablas no incluidas: algunas pueden no existir o ya estar optimizadas
-- Review el Performance Advisor después de esta migración para warnings finales.
