-- Fase 6: Fix Remaining Auth RLS Initialization Plan Warnings
-- Resolve 9+ auth_rls_initplan warnings across 6 tables
-- Fix 1 unindexed foreign key warning
-- All changes are performance optimizations with zero functional impact

-- ============================================================
-- PARTE 1: Add Missing Index for Foreign Key
-- ============================================================

-- Fix: unindexed_foreign_keys on user_module_permissions.updated_by
CREATE INDEX IF NOT EXISTS idx_user_module_permissions_updated_by
  ON public.user_module_permissions(updated_by);

-- ============================================================
-- PARTE 2: Fix clientes Policies
-- ============================================================
-- Issue: clientes_delete_by_role, clientes_select_by_role, clientes_update_by_role
-- re-evaluate current_user_role() per row

DROP POLICY IF EXISTS "clientes_delete_by_role" ON public.clientes;

CREATE POLICY "clientes_delete_by_role" ON public.clientes
  FOR DELETE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'operador', 'user')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
    )
  );

DROP POLICY IF EXISTS "clientes_select_by_role" ON public.clientes;

CREATE POLICY "clientes_select_by_role" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    (SELECT current_user_role()) IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND (SELECT current_user_role()) IN ('company_owner', 'admin', 'operator', 'operador', 'user', 'viewer', 'visor', 'cliente')
    )
  );

DROP POLICY IF EXISTS "clientes_update_by_role" ON public.clientes;

CREATE POLICY "clientes_update_by_role" ON public.clientes
  FOR UPDATE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND (SELECT current_user_role()) IN ('company_owner', 'admin', 'operator', 'operador', 'user')
    )
  )
  WITH CHECK (
    (SELECT current_user_role()) IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = (SELECT auth.uid())
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND (SELECT current_user_role()) IN ('company_owner', 'admin', 'operator', 'operador', 'user')
    )
  );

-- ============================================================
-- PARTE 3: Fix security_logs Policy
-- ============================================================

DROP POLICY IF EXISTS "security_logs_insert_authenticated" ON public.security_logs;

CREATE POLICY "security_logs_insert_authenticated" ON public.security_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
  );

-- ============================================================
-- PARTE 4: Fix user_project_assignments Policy
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own project assignments" ON public.user_project_assignments;

CREATE POLICY "Users can view their own project assignments" ON public.user_project_assignments
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
  );

-- ============================================================
-- PARTE 5: Fix pagos Policy
-- ============================================================

DROP POLICY IF EXISTS "Users can view pagos for their assigned projects" ON public.pagos;

CREATE POLICY "Users can view pagos for their assigned projects" ON public.pagos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = pagos.project_id
    )
  );

-- ============================================================
-- PARTE 6: Fix password_reset_tokens Policy
-- ============================================================

DROP POLICY IF EXISTS "Users can view their own reset tokens" ON public.password_reset_tokens;

CREATE POLICY "Users can view their own reset tokens" ON public.password_reset_tokens
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
  );

-- ============================================================
-- PARTE 7: Fix fuentes_agua Policies
-- ============================================================

DROP POLICY IF EXISTS "fuentes_agua_company_owner" ON public.fuentes_agua;

CREATE POLICY "fuentes_agua_company_owner" ON public.fuentes_agua
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) = 'company_owner'
    AND company_id = (SELECT get_my_company_id())
  )
  WITH CHECK (
    (SELECT current_user_role()) = 'company_owner'
    AND company_id = (SELECT get_my_company_id())
  );

DROP POLICY IF EXISTS "fuentes_agua_staff_delete" ON public.fuentes_agua;

CREATE POLICY "fuentes_agua_staff_delete" ON public.fuentes_agua
  FOR DELETE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('super_admin', 'superadmin', 'admin')
  );
