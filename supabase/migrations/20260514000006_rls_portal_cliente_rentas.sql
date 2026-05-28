-- Allow portal clients to manage STR reservations for their authorized units.
-- Clients are authorized via an approved solicitud_renta_unidad that covers STR.
CREATE POLICY "str_cliente_portal" ON public.reservas_str
AS PERMISSIVE FOR ALL TO authenticated
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

-- Allow portal clients to manage rental contracts for their authorized units.
-- Clients are authorized via an approved solicitud_renta_unidad that covers arrendamiento.
CREATE POLICY "contratos_arr_cliente_portal" ON public.contratos_arrendamiento
AS PERMISSIVE FOR ALL TO authenticated
USING (
  current_user_role() = 'cliente'
  AND EXISTS (
    SELECT 1 FROM public.solicitud_renta_unidad s
    WHERE s.cliente_id = get_my_cliente_id()
      AND s.unidad_id  = contratos_arrendamiento.unidad_id
      AND s.company_id = contratos_arrendamiento.company_id
      AND s.estado = 'aprobada'
      AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
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
      AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
  )
);
