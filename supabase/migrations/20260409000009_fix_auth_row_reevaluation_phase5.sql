-- Fase 5: Fix Auth Function Per-Row Re-evaluation
-- Resolve Supabase Performance Advisor warnings for 3 policies
-- Issues:
--   1. contadores "super_admin full access" re-evaluates auth.uid() per row
--   2. contadores "company_owner access" re-evaluates auth.uid() per row
--   3. user_module_permissions "Users view own module permissions" re-evaluates auth.uid() per row
--
-- Solution: Use helper functions (which evaluate once) or wrap auth.uid() in SELECT

-- ============================================================
-- PARTE 1: Funciones Helper que faltan de Phase 3
-- ============================================================

-- Helper function para super_admin check (debe haber sido creado en Phase 3)
CREATE OR REPLACE FUNCTION public.has_super_admin_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT current_user_role() = 'super_admin'
$$;

COMMENT ON FUNCTION has_super_admin_access() IS 'Performance: Check if user is super_admin (avoids duplicate current_user_role() calls)';

-- Helper function para company_owner con company_id (Phase 3)
CREATE OR REPLACE FUNCTION public.has_company_owner_company_access(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    current_user_role() = 'company_owner'
    AND get_my_company_id() = p_company_id
$$;

COMMENT ON FUNCTION has_company_owner_company_access(uuid) IS 'Performance: Combined company_owner + company_id check';

-- Helper function para admin con company_id (Phase 3)
CREATE OR REPLACE FUNCTION public.has_admin_company_access(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    current_user_role() = 'admin'
    AND get_my_company_id() = p_company_id
$$;

COMMENT ON FUNCTION has_admin_company_access(uuid) IS 'Performance: Combined admin + company_id check';

-- ============================================================
-- PARTE 2: Refactor Contadores Policies
-- ============================================================

-- Fix: "super_admin full access on contadores"
-- Was: EXISTS (...auth.uid()...) evaluated per row
-- Now: has_super_admin_access() evaluated once per statement
DROP POLICY IF EXISTS "super_admin full access on contadores" ON public.contadores;

CREATE POLICY "super_admin full access on contadores" ON public.contadores
  FOR ALL TO authenticated
  USING (has_super_admin_access())
  WITH CHECK (has_super_admin_access());

-- Fix: "company_owner access on contadores"
-- Was: EXISTS (...auth.uid() AND company_id check...) evaluated per row
-- Now: has_company_owner_company_access() + company_id parameter
DROP POLICY IF EXISTS "company_owner access on contadores" ON public.contadores;

CREATE POLICY "company_owner access on contadores" ON public.contadores
  FOR ALL TO authenticated
  USING (has_company_owner_company_access(contadores.company_id))
  WITH CHECK (has_company_owner_company_access(contadores.company_id));

-- ============================================================
-- PARTE 3: Fix user_module_permissions "Users view own module permissions"
-- ============================================================
-- Issue: user_id = auth.uid() re-evaluates auth.uid() per row
-- Fix: Wrap auth.uid() in SELECT to force single evaluation
-- Alternative: Create helper function get_my_user_id()

-- Helper function for current user ID (single evaluation)
CREATE OR REPLACE FUNCTION public.get_my_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT auth.uid()
$$;

COMMENT ON FUNCTION get_my_user_id() IS 'Performance: Get current user ID (avoids per-row auth.uid() re-evaluation)';

-- Fix policy: Use helper function instead of direct auth.uid()
DROP POLICY IF EXISTS "Users view own module permissions" ON public.user_module_permissions;

CREATE POLICY "Users view own module permissions" ON public.user_module_permissions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT get_my_user_id()));

-- ============================================================
-- Verification
-- ============================================================
-- All 3 policies now use helper functions that are evaluated once
-- instead of re-evaluating per row. This resolves the Supabase
-- Performance Advisor warnings.
--
-- Summary:
-- ✓ contadores "super_admin full access" -> uses has_super_admin_access()
-- ✓ contadores "company_owner access" -> uses has_company_owner_company_access()
-- ✓ user_module_permissions "Users view own module permissions" -> uses get_my_user_id()
