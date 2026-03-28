-- ============================================================
-- Fix multi-project visibility and company scoping
--
-- Root causes:
--   1. contadores/unidades/tarifas: operator/viewer/admin policies
--      only check app_users.project_id (primary assignment), ignoring
--      user_project_assignments (multi-project assignments)
--   2. clientes: SELECT/INSERT/UPDATE policies only check the user's
--      role — no company or project scope — so any authenticated user
--      with the right role can see clients from ALL companies
-- ============================================================

-- ── Helper: check if current user has access to a project ────
-- Returns true if the user's primary project_id matches OR if the
-- user has an explicit assignment in user_project_assignments.
-- SECURITY DEFINER avoids RLS recursion on app_users.
CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND project_id = p_project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments
      WHERE user_id = auth.uid() AND project_id = p_project_id
    )
$$;

-- ============================================================
-- clientes: scope by company via company_clientes
-- ============================================================
DROP POLICY IF EXISTS "clientes_select_by_role" ON public.clientes;
CREATE POLICY "clientes_select_by_role" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    -- super_admin sees all clients
    current_user_role() IN ('super_admin', 'superadmin')
    OR
    -- all other roles see only clients linked to their company
    EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND current_user_role() = ANY (ARRAY[
          'company_owner', 'admin',
          'operator', 'operador', 'user',
          'viewer', 'visor', 'cliente'
        ])
    )
  );

DROP POLICY IF EXISTS "clientes_insert_by_role" ON public.clientes;
CREATE POLICY "clientes_insert_by_role" ON public.clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() IN ('super_admin', 'superadmin')
    OR current_user_role() IN ('company_owner', 'admin', 'operator', 'operador', 'user')
  );

DROP POLICY IF EXISTS "clientes_update_by_role" ON public.clientes;
CREATE POLICY "clientes_update_by_role" ON public.clientes
  FOR UPDATE TO authenticated
  USING (
    current_user_role() IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND current_user_role() IN (
          'company_owner', 'admin', 'operator', 'operador', 'user'
        )
    )
  )
  WITH CHECK (
    current_user_role() IN ('super_admin', 'superadmin')
    OR current_user_role() IN ('company_owner', 'admin', 'operator', 'operador', 'user')
  );

DROP POLICY IF EXISTS "clientes_delete_by_role" ON public.clientes;
CREATE POLICY "clientes_delete_by_role" ON public.clientes
  FOR DELETE TO authenticated
  USING (
    current_user_role() IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND current_user_role() IN ('company_owner', 'admin')
    )
  );

-- ============================================================
-- contadores: add user_project_assignments to admin/operator/viewer
-- ============================================================

-- admin: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "admin access on contadores" ON public.contadores;
CREATE POLICY "admin access on contadores" ON public.contadores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'admin' AND upa.project_id = contadores.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'admin' AND upa.project_id = contadores.project_id
    )
  );

-- operator SELECT: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "operator access on contadores" ON public.contadores;
CREATE POLICY "operator access on contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = contadores.project_id
    )
  );

-- operator INSERT: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "operator insert contadores" ON public.contadores;
CREATE POLICY "operator insert contadores" ON public.contadores
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = contadores.project_id
    )
  );

-- operator UPDATE: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "operator update contadores" ON public.contadores;
CREATE POLICY "operator update contadores" ON public.contadores
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = contadores.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = contadores.project_id
    )
  );

-- viewer SELECT: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "viewer read contadores" ON public.contadores;
CREATE POLICY "viewer read contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('viewer', 'visor', 'cliente')
        AND project_id = contadores.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('viewer', 'visor', 'cliente')
        AND upa.project_id = contadores.project_id
    )
  );

-- ============================================================
-- unidades: add user_project_assignments to operator/viewer
-- (admin was already fixed in 20260327000002)
-- ============================================================

-- operator SELECT
DROP POLICY IF EXISTS "operator read unidades" ON public.unidades;
CREATE POLICY "operator read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = unidades.project_id
    )
  );

-- operator INSERT
DROP POLICY IF EXISTS "operator insert unidades" ON public.unidades;
CREATE POLICY "operator insert unidades" ON public.unidades
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = unidades.project_id
    )
  );

-- operator UPDATE
DROP POLICY IF EXISTS "operator update unidades" ON public.unidades;
CREATE POLICY "operator update unidades" ON public.unidades
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = unidades.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'user')
        AND upa.project_id = unidades.project_id
    )
  );

-- viewer SELECT
DROP POLICY IF EXISTS "viewer read unidades" ON public.unidades;
CREATE POLICY "viewer read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('viewer', 'visor', 'cliente')
        AND project_id = unidades.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('viewer', 'visor', 'cliente')
        AND upa.project_id = unidades.project_id
    )
  );

-- ============================================================
-- tarifas: add user_project_assignments to admin/operator/viewer
-- ============================================================

-- admin: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "admin access on tarifas" ON public.tarifas;
CREATE POLICY "admin access on tarifas" ON public.tarifas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = tarifas.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'admin' AND upa.project_id = tarifas.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = tarifas.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid() AND u.role = 'admin' AND upa.project_id = tarifas.project_id
    )
  );

-- operator/viewer SELECT: direct project_id OR via user_project_assignments
DROP POLICY IF EXISTS "operator read tarifas" ON public.tarifas;
CREATE POLICY "operator read tarifas" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = tarifas.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND upa.project_id = tarifas.project_id
    )
  );
