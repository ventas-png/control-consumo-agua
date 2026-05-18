-- Permitir que el cliente del portal gestione huespedes_str (pre-registro
-- de personas del grupo en reservas STR) para las reservas que pertenecen
-- a unidades donde tiene autorización STR aprobada. Antes solo existía
-- la política "company_access" basada en company_id de app_users, que
-- siempre regresa NULL para clientes y bloqueaba la operación.
--
-- Reutiliza el mismo patrón que reservas_str.str_cliente_portal_*:
-- une por reservas_str.unidad_id y exige una solicitud_renta_unidad
-- aprobada del cliente con tipo str o ambas.

CREATE POLICY "huespedes_str_cliente_portal" ON public.huespedes_str
  AS PERMISSIVE
  FOR ALL TO authenticated
  USING (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1
      FROM public.reservas_str r
      JOIN public.solicitud_renta_unidad s
        ON s.unidad_id = r.unidad_id
       AND s.company_id = r.company_id
      WHERE r.id = huespedes_str.reserva_str_id
        AND s.cliente_id = get_my_cliente_id()
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  )
  WITH CHECK (
    current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1
      FROM public.reservas_str r
      JOIN public.solicitud_renta_unidad s
        ON s.unidad_id = r.unidad_id
       AND s.company_id = r.company_id
      WHERE r.id = huespedes_str.reserva_str_id
        AND s.cliente_id = get_my_cliente_id()
        AND s.estado = 'aprobada'
        AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
    )
  );
