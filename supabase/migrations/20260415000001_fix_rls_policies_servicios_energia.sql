-- Fix RLS policies for servicios_energia tables to use proper helper functions
-- The original policies were checking direct project_id matching, but admin users
-- can also be assigned via user_project_assignments table

-- =============================================================================
-- PROVEEDORES_ENERGIA RLS FIXES
-- =============================================================================

DROP POLICY IF EXISTS "admin access on proveedores_energia" ON public.proveedores_energia;
DROP POLICY IF EXISTS "operator read proveedores_energia" ON public.proveedores_energia;

CREATE POLICY "admin access on proveedores_energia" ON public.proveedores_energia
  FOR ALL TO authenticated
  USING (has_admin_project_access(proveedores_energia.project_id))
  WITH CHECK (has_admin_project_access(proveedores_energia.project_id));

CREATE POLICY "operator read proveedores_energia" ON public.proveedores_energia
  FOR SELECT TO authenticated
  USING (has_operator_project_access(proveedores_energia.project_id));

-- =============================================================================
-- TARIFAS_ENERGIA RLS FIXES
-- =============================================================================

DROP POLICY IF EXISTS "admin access on tarifas_energia" ON public.tarifas_energia;
DROP POLICY IF EXISTS "operator read tarifas_energia" ON public.tarifas_energia;

CREATE POLICY "admin access on tarifas_energia" ON public.tarifas_energia
  FOR ALL TO authenticated
  USING (has_admin_project_access(tarifas_energia.project_id))
  WITH CHECK (has_admin_project_access(tarifas_energia.project_id));

CREATE POLICY "operator read tarifas_energia" ON public.tarifas_energia
  FOR SELECT TO authenticated
  USING (has_operator_project_access(tarifas_energia.project_id));

-- =============================================================================
-- FUENTES_ENERGIA RLS FIXES
-- =============================================================================

DROP POLICY IF EXISTS "admin access on fuentes_energia" ON public.fuentes_energia;
DROP POLICY IF EXISTS "operator read fuentes_energia" ON public.fuentes_energia;

CREATE POLICY "admin access on fuentes_energia" ON public.fuentes_energia
  FOR ALL TO authenticated
  USING (has_admin_project_access(fuentes_energia.project_id))
  WITH CHECK (has_admin_project_access(fuentes_energia.project_id));

CREATE POLICY "operator read fuentes_energia" ON public.fuentes_energia
  FOR SELECT TO authenticated
  USING (has_operator_project_access(fuentes_energia.project_id));

-- =============================================================================
-- FACTURAS_ENERGIA RLS FIXES
-- =============================================================================

DROP POLICY IF EXISTS "admin access on facturas_energia" ON public.facturas_energia;
DROP POLICY IF EXISTS "operator read facturas_energia" ON public.facturas_energia;

CREATE POLICY "admin access on facturas_energia" ON public.facturas_energia
  FOR ALL TO authenticated
  USING (has_admin_project_access(facturas_energia.project_id))
  WITH CHECK (has_admin_project_access(facturas_energia.project_id));

CREATE POLICY "operator read facturas_energia" ON public.facturas_energia
  FOR SELECT TO authenticated
  USING (has_operator_project_access(facturas_energia.project_id));
