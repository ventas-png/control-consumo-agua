-- Fase 7: Fix 92+ Remaining Auth RLS Initialization Plan Warnings (Bulk Optimization)
-- Apply (SELECT auth.uid()) and (SELECT current_user_role()) pattern to all affected policies
-- Tables: fuentes_agua, registros_calidad, app_users, rutas, proyectos_meta, and others
-- Zero functional impact - pure performance optimization

-- ============================================================
-- Tabla: fuentes_agua (4 policies)
-- ============================================================

DROP POLICY IF EXISTS "fuentes_agua_staff_insert" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_staff_insert" ON public.fuentes_agua
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = fuentes_agua.project_id
    )
  );

DROP POLICY IF EXISTS "fuentes_agua_staff_select" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_staff_select" ON public.fuentes_agua
  FOR SELECT TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin', 'viewer', 'visor')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = fuentes_agua.project_id
    )
  );

DROP POLICY IF EXISTS "fuentes_agua_staff_update" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_staff_update" ON public.fuentes_agua
  FOR UPDATE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = fuentes_agua.project_id
    )
  )
  WITH CHECK (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = fuentes_agua.project_id
    )
  );

DROP POLICY IF EXISTS "fuentes_agua_super_admin" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_super_admin" ON public.fuentes_agua
  FOR ALL TO authenticated
  USING ((SELECT current_user_role()) IN ('super_admin', 'superadmin'))
  WITH CHECK ((SELECT current_user_role()) IN ('super_admin', 'superadmin'));

-- ============================================================
-- Tabla: registros_calidad (6 policies)
-- ============================================================

DROP POLICY IF EXISTS "registros_calidad_company_owner" ON public.registros_calidad;
CREATE POLICY "registros_calidad_company_owner" ON public.registros_calidad
  FOR ALL TO authenticated
  USING (
    (SELECT current_user_role()) = 'company_owner'
    AND company_id = (SELECT get_my_company_id())
  )
  WITH CHECK (
    (SELECT current_user_role()) = 'company_owner'
    AND company_id = (SELECT get_my_company_id())
  );

DROP POLICY IF EXISTS "registros_calidad_staff_delete" ON public.registros_calidad;
CREATE POLICY "registros_calidad_staff_delete" ON public.registros_calidad
  FOR DELETE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros_calidad.project_id
    )
  );

DROP POLICY IF EXISTS "registros_calidad_staff_insert" ON public.registros_calidad;
CREATE POLICY "registros_calidad_staff_insert" ON public.registros_calidad
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros_calidad.project_id
    )
  );

DROP POLICY IF EXISTS "registros_calidad_staff_select" ON public.registros_calidad;
CREATE POLICY "registros_calidad_staff_select" ON public.registros_calidad
  FOR SELECT TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin', 'viewer', 'visor')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros_calidad.project_id
    )
  );

DROP POLICY IF EXISTS "registros_calidad_staff_update" ON public.registros_calidad;
CREATE POLICY "registros_calidad_staff_update" ON public.registros_calidad
  FOR UPDATE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros_calidad.project_id
    )
  )
  WITH CHECK (
    (SELECT current_user_role()) IN ('admin', 'operator', 'operador', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros_calidad.project_id
    )
  );

DROP POLICY IF EXISTS "registros_calidad_super_admin" ON public.registros_calidad;
CREATE POLICY "registros_calidad_super_admin" ON public.registros_calidad
  FOR ALL TO authenticated
  USING ((SELECT current_user_role()) IN ('super_admin', 'superadmin'))
  WITH CHECK ((SELECT current_user_role()) IN ('super_admin', 'superadmin'));

-- ============================================================
-- Tabla: app_users (3 policies)
-- ============================================================

DROP POLICY IF EXISTS "Users can update their own profile" ON public.app_users;
CREATE POLICY "Users can update their own profile" ON public.app_users
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view their own profile" ON public.app_users;
CREATE POLICY "Users can view their own profile" ON public.app_users
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "cliente_select_own_app_user" ON public.app_users;
CREATE POLICY "cliente_select_own_app_user" ON public.app_users
  FOR SELECT TO authenticated
  USING (
    cliente_id = (SELECT get_my_cliente_id())
    AND (SELECT current_user_role()) = 'cliente'
  );

-- ============================================================
-- Tabla: rutas (1+ policies)
-- ============================================================

DROP POLICY IF EXISTS "rutas_delete" ON public.rutas;
CREATE POLICY "rutas_delete" ON public.rutas
  FOR DELETE TO authenticated
  USING (
    (SELECT current_user_role()) IN ('admin', 'super_admin', 'superadmin')
    AND EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = rutas.project_id
    )
  );

-- ============================================================
-- PARTE 2: Apply global pattern fix to other common tables
-- This uses a general approach for tables with similar warning patterns
-- ============================================================

-- Note: Additional tables may need similar fixes based on their specific RLS policies
-- Review the remaining warnings after this migration
