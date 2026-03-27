-- ============================================================
-- Fix clientes RLS policies to include all role variants
-- Root causes:
--   1. 'operator' (English) was missing from clientes SELECT/INSERT/UPDATE
--   2. 'company_owner' and 'super_admin' could not read/write clientes
--   3. Operators could not insert into company_clientes (needed for import linking)
-- ============================================================

-- ── clientes SELECT ───────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_select_by_role" ON public.clientes;
CREATE POLICY "clientes_select_by_role" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    current_user_role() = ANY (ARRAY[
      'admin', 'operador', 'operator',
      'visor', 'viewer', 'user',
      'company_owner', 'super_admin', 'superadmin'
    ])
  );

-- ── clientes INSERT ───────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_insert_by_role" ON public.clientes;
CREATE POLICY "clientes_insert_by_role" ON public.clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY (ARRAY[
      'admin', 'operador', 'operator',
      'company_owner', 'super_admin', 'superadmin'
    ])
  );

-- ── clientes UPDATE ───────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_update_by_role" ON public.clientes;
CREATE POLICY "clientes_update_by_role" ON public.clientes
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY (ARRAY[
      'admin', 'operador', 'operator',
      'company_owner', 'super_admin', 'superadmin'
    ])
  )
  WITH CHECK (
    current_user_role() = ANY (ARRAY[
      'admin', 'operador', 'operator',
      'company_owner', 'super_admin', 'superadmin'
    ])
  );

-- ── clientes DELETE ───────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_delete_by_role" ON public.clientes;
CREATE POLICY "clientes_delete_by_role" ON public.clientes
  FOR DELETE TO authenticated
  USING (
    current_user_role() = ANY (ARRAY[
      'admin', 'company_owner', 'super_admin', 'superadmin'
    ])
  );

-- ── company_clientes INSERT for operators ─────────────────────
-- Operators need to insert links when importing clients (new + existing)
DROP POLICY IF EXISTS "operator insert company_clientes" ON public.company_clientes;
CREATE POLICY "operator insert company_clientes" ON public.company_clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND company_id = company_clientes.company_id
    )
  );
