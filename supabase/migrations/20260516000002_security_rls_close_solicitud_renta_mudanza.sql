-- ============================================================================
-- SECURITY HOTFIX: cierre de RLS en solicitud_renta_unidad y
-- solicitud_mudanza_unidad.
--
-- Ambas tablas se crearon (migrations 20260513000001 y 20260513000002) con
-- una política "FOR ALL TO authenticated USING (true) WITH CHECK (true)".
-- Esto deja accesibles las solicitudes de RENTA y MUDANZA de cualquier
-- empresa a cualquier usuario autenticado de cualquier otro tenant (lectura,
-- modificación y borrado). Contienen datos PII (cliente_id, motivos,
-- comentarios admin, fechas) y de negocio.
--
-- Esta migración reemplaza las políticas permisivas por el patrón estándar
-- que ya usan tablas equivalentes como solicitudes_residente:
--   - Empresa: full CRUD sobre filas con company_id = get_my_company_id()
--   - Cliente: SELECT/INSERT de sus propias filas (cliente_id = get_my_cliente_id())
--   - Super admin: pasa todo (is_super_admin())
-- Los UPDATE/DELETE quedan en manos del admin/empresa — el cliente envía
-- una solicitud nueva si necesita corregir.
-- ============================================================================

-- ── solicitud_renta_unidad ────────────────────────────────────────────────

DROP POLICY IF EXISTS "solicitud_renta_all" ON public.solicitud_renta_unidad;

CREATE POLICY "solicitud_renta_select"
  ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id())
  );

CREATE POLICY "solicitud_renta_insert"
  ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id())
  );

CREATE POLICY "solicitud_renta_update"
  ON public.solicitud_renta_unidad
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id())
  WITH CHECK (is_super_admin() OR company_id = get_my_company_id());

CREATE POLICY "solicitud_renta_delete"
  ON public.solicitud_renta_unidad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

-- ── solicitud_mudanza_unidad ──────────────────────────────────────────────

DROP POLICY IF EXISTS "solicitud_mudanza_all" ON public.solicitud_mudanza_unidad;

CREATE POLICY "solicitud_mudanza_select"
  ON public.solicitud_mudanza_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id())
  );

CREATE POLICY "solicitud_mudanza_insert"
  ON public.solicitud_mudanza_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id())
  );

CREATE POLICY "solicitud_mudanza_update"
  ON public.solicitud_mudanza_unidad
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id())
  WITH CHECK (is_super_admin() OR company_id = get_my_company_id());

CREATE POLICY "solicitud_mudanza_delete"
  ON public.solicitud_mudanza_unidad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

-- ── Índices para soportar los filtros nuevos sin seq scan ────────────────

CREATE INDEX IF NOT EXISTS idx_solicitud_renta_cliente
  ON public.solicitud_renta_unidad (cliente_id)
  WHERE cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_solicitud_renta_company
  ON public.solicitud_renta_unidad (company_id);

CREATE INDEX IF NOT EXISTS idx_solicitud_mudanza_cliente
  ON public.solicitud_mudanza_unidad (cliente_id)
  WHERE cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_solicitud_mudanza_company
  ON public.solicitud_mudanza_unidad (company_id);
