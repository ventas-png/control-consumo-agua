-- 1) Index missing on registros.project_id
--    The registros_select policy for company_owner uses:
--    project_id IN (SELECT id FROM projects WHERE company_id = get_my_company_id())
--    Without this index, every row on the 4k+ table does a seq scan → timeout.
CREATE INDEX IF NOT EXISTS idx_registros_project_id
  ON public.registros(project_id);

-- 2) Index missing on reservas_str.company_id and unidad_id
--    Used by both the existing str_select policy and the new str_cliente_portal policy.
CREATE INDEX IF NOT EXISTS idx_reservas_str_company_id
  ON public.reservas_str(company_id);

CREATE INDEX IF NOT EXISTS idx_reservas_str_unidad_id
  ON public.reservas_str(unidad_id);

-- 3) Replace the str_cliente_portal FOR ALL policy with separate per-command policies.
--    FOR ALL creates 4 policies (SELECT/INSERT/UPDATE/DELETE) which Postgres evaluates
--    for every row even when current_user_role() != 'cliente', adding overhead for admins.
--    Splitting them lets the planner prune each one independently.
DROP POLICY IF EXISTS "str_cliente_portal" ON public.reservas_str;

CREATE POLICY "str_cliente_portal_select" ON public.reservas_str
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.solicitud_renta_unidad s
      WHERE s.cliente_id = get_my_cliente_id()
        AND s.unidad_id  = reservas_str.unidad_id
        AND s.company_id = reservas_str.company_id
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  );

CREATE POLICY "str_cliente_portal_insert" ON public.reservas_str
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.solicitud_renta_unidad s
      WHERE s.cliente_id = get_my_cliente_id()
        AND s.unidad_id  = unidad_id
        AND s.company_id = company_id
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  );

CREATE POLICY "str_cliente_portal_update" ON public.reservas_str
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.solicitud_renta_unidad s
      WHERE s.cliente_id = get_my_cliente_id()
        AND s.unidad_id  = reservas_str.unidad_id
        AND s.company_id = reservas_str.company_id
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  )
  WITH CHECK (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.solicitud_renta_unidad s
      WHERE s.cliente_id = get_my_cliente_id()
        AND s.unidad_id  = unidad_id
        AND s.company_id = company_id
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  );

CREATE POLICY "str_cliente_portal_delete" ON public.reservas_str
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.solicitud_renta_unidad s
      WHERE s.cliente_id = get_my_cliente_id()
        AND s.unidad_id  = reservas_str.unidad_id
        AND s.company_id = reservas_str.company_id
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  );

-- 4) Index on solicitud_renta_unidad for the EXISTS subquery in the client policies
CREATE INDEX IF NOT EXISTS idx_solicitud_renta_cliente_unidad
  ON public.solicitud_renta_unidad(cliente_id, unidad_id, company_id)
  WHERE estado = 'aprobada';
