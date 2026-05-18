-- ─── RLS hardening: solicitud_renta_unidad + solicitud_mudanza_unidad ──────
-- Both tables had a permissive `USING (true)` policy that allowed any
-- authenticated user to do anything. This migration replaces it with:
--   1. Cliente policies: residents see/create requests for their own units
--   2. Staff policies: company members with the appropriate RBAC permission
--      can perform CRUD on requests in their company

-- ─── solicitud_renta_unidad ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "solicitud_renta_all" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_unidad_delete" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_cliente_select" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad;

-- Cliente: read own solicitudes (where they own the unit)
CREATE POLICY "solicitud_renta_cliente_select" ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = solicitud_renta_unidad.unidad_id
        AND u.cliente_id = public.get_my_cliente_id()
    )
  );

-- Cliente: insert solicitudes for their own units
CREATE POLICY "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = solicitud_renta_unidad.unidad_id
        AND u.cliente_id = public.get_my_cliente_id()
    )
    -- Cliente cannot pre-approve their own request
    AND estado = 'pendiente'
  );

-- Staff: full CRUD gated by permission
CREATE POLICY "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  );

CREATE POLICY "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  );

CREATE POLICY "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_renta')
    )
  );

CREATE POLICY "solicitud_renta_unidad_delete" ON public.solicitud_renta_unidad
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = public.get_my_company_id()
    )
  );

-- ─── solicitud_mudanza_unidad ───────────────────────────────────────────────
DROP POLICY IF EXISTS "solicitud_mudanza_all" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_update" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_delete" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_cliente_select" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_cliente_insert" ON public.solicitud_mudanza_unidad;

-- Cliente: read own solicitudes (where they own the unit)
CREATE POLICY "solicitud_mudanza_cliente_select" ON public.solicitud_mudanza_unidad
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = solicitud_mudanza_unidad.unidad_id
        AND u.cliente_id = public.get_my_cliente_id()
    )
  );

-- Cliente: insert solicitudes for their own units (initial state only)
CREATE POLICY "solicitud_mudanza_cliente_insert" ON public.solicitud_mudanza_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = solicitud_mudanza_unidad.unidad_id
        AND u.cliente_id = public.get_my_cliente_id()
    )
    AND estado = 'pendiente'
  );

-- Staff: full CRUD gated by permission
CREATE POLICY "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_mudanza')
    )
  );

CREATE POLICY "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_mudanza')
    )
  );

CREATE POLICY "solicitud_mudanza_unidad_update" ON public.solicitud_mudanza_unidad
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_mudanza')
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR (
      company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.solicitudes_mudanza')
    )
  );

CREATE POLICY "solicitud_mudanza_unidad_delete" ON public.solicitud_mudanza_unidad
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (
      public.current_user_role() = ANY(ARRAY['company_owner','admin'])
      AND company_id = public.get_my_company_id()
    )
  );
