-- ============================================================================
-- E7 (corrección de 20261012000000): QUÉ CUOTA SE PUEDE ELIMINAR SIN APROBACIÓN
--
-- 20261012000000 dejaba eliminar sin solicitud cualquier cuota con
-- cuota_estado = 'pendiente' y sin dependencias. Ese estado NO significa «sin
-- emitir»: es el valor por defecto de TODA cuota desde que se crea
-- (20260604180000) y sólo cambia al cerrar el ciclo. Una cuota 'pendiente'
-- ya es una cuenta por cobrar:
--   · su devengo se contabiliza al insertarla (conta_tg_cuotas, INSERT con
--     monto > 0), sea cual sea su cuota_estado;
--   · el residente la ve como deuda (portal_documentos_con_saldo sólo excluye
--     anuladas y pagadas; el portal lista todas las cuotas de su unidad);
--   · figura en el estado de cuenta (conta_ec_fuera_de_saldo no filtra por
--     cuota_estado).
-- Borrarla reversaría ese devengo sin que nadie lo apruebe.
--
-- REGLA. Sin solicitud sólo se elimina la cuota que es la TARIFA de una
-- reserva de amenidad que ya está CANCELADA (reservas_amenidades.cuota_id y
-- estado = 'cancelada'; rechazar una reserva también la deja 'cancelada'), que
-- no se ha emitido (cuota_estado 'pendiente' Y emitida_at nulo) y que no tiene
-- dependencias. La cancelación de la reserva es el acto de negocio que la deja
-- sin causa. Cualquier otra cuota se anula con una solicitud aprobada
-- (CUOTA_ELIMINACION_SOLO_POR_SOLICITUD), incluidas las que la pantalla de
-- amenidades creaba y borraba como compensación cuando fallaba guardar la
-- reserva: ahora esa pantalla solicita su anulación.
--
-- CÓMO SE REVIERTE: restaurar conta_cuota_exigir_eliminable de 20261012000000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.conta_cuota_exigir_eliminable(p_cuota public.cuotas_condominio)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.conta_cuota_exigir_sin_dependencias(p_cuota.id, false, 'CUOTA_CON_DEPENDENCIAS');
  IF COALESCE(p_cuota.cuota_estado, 'pendiente') = 'pendiente'
     AND p_cuota.emitida_at IS NULL
     AND EXISTS (SELECT 1 FROM public.reservas_amenidades r
                  WHERE r.cuota_id = p_cuota.id AND r.estado = 'cancelada') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD: la cuota ya es una cuenta por cobrar registrada (devengo contable) y visible para el residente, aunque su estado sea «%». Se anula con una solicitud aprobada. Sin solicitud sólo se elimina la tarifa sin emitir de una reserva cancelada.',
    COALESCE(p_cuota.cuota_estado, 'pendiente') USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_exigir_eliminable(public.cuotas_condominio) FROM PUBLIC, anon, authenticated;
