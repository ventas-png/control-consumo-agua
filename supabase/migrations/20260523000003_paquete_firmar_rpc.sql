-- ============================================================
-- Paquetería: firma de recepción por el residente (RPC)
-- ============================================================
-- El residente firma desde su portal. No se le da UPDATE directo por RLS porque
-- un WITH CHECK no puede limitar QUÉ columnas/valores cambia (podría alterar
-- estado, recibido_por, etc.). Esta función SECURITY DEFINER acota la transición
-- exacta: solo marca 'entregado' con firma/nombre, y solo si quien llama es el
-- residente activo de la unidad del paquete y el paquete está 'pendiente'.

CREATE OR REPLACE FUNCTION public.paquete_firmar_recepcion(
  p_paquete_id uuid,
  p_firma_path text,
  p_nombre     text
) RETURNS public.paquetes_recibidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.paquetes_recibidos;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.paquetes_recibidos p
    JOIN public.unidades u ON u.id = p.unidad_id
    WHERE p.id = p_paquete_id
      AND p.estado = 'pendiente'
      AND u.activo = true
      AND u.cliente_id = (SELECT cliente_id FROM public.app_users WHERE id = (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'No autorizado o paquete no disponible';
  END IF;

  UPDATE public.paquetes_recibidos
     SET estado             = 'entregado',
         firma_path         = p_firma_path,
         entregado_a_nombre = COALESCE(NULLIF(btrim(p_nombre), ''), entregado_a_nombre),
         entregado_via      = 'portal',
         hora_entrega       = now()
   WHERE id = p_paquete_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Solo usuarios autenticados. El proyecto concede EXECUTE a anon por privilegios
-- por defecto, así que se revoca explícitamente (la función ya se autoprotege con
-- auth.uid(), pero no debe quedar expuesta al rol anónimo).
REVOKE ALL ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.paquete_firmar_recepcion(uuid, text, text) TO authenticated;
