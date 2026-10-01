-- ============================================================================
-- PASARELA (correctiva de 20261015000000): REEMBOLSO TOTAL ANTES DE APROBAR Y
-- RESPUESTA SEGÚN EL ESTADO PERSISTIDO
--
-- 1. REEMBOLSO TOTAL ANTES DE LA APROBACIÓN. Un «reembolsado» sobre una
--    solicitud pending/failed (sin cobro retenido) sólo abría una incidencia
--    y dejaba la solicitud igual; un «aprobado» atrasado la conciliaba después
--    y creaba y acreditaba un pago por dinero que ya se había devuelto. Ahora
--    la solicitud pasa a 'refunded' (sin pago que reversar; el evento y la
--    incidencia reembolso_sin_cobro quedan como rastro) y el «aprobado»
--    posterior cae en 'ignorado_reembolsado': ni pago ni abono. Una sola
--    incidencia aprobado_tras_reembolso por solicitud (avisos repetidos o
--    simultáneos sólo dejan su evento). Los reembolsos PARCIALES no cambian
--    (pasarela_registrar_reembolso_parcial).
--
-- 2. LA RESPUESTA DESCRIBE LO QUE QUEDÓ GUARDADO, no la acción del aviso.
--    Antes un aviso DUPLICADO devolvía sólo accion = 'duplicado', y los edges
--    lo leían como conciliado (con saldo 0 por defecto): la segunda consulta
--    de un cobro retenido sobre una cuota anulada se presentaba como pagada.
--    Ahora toda respuesta (duplicada o no) lleva, leído de las filas:
--      conciliado   solicitud succeeded con su pago vivo
--      en_revision  solicitud pending_verification con cobro retenido
--      reembolsado  solicitud refunded
--    y pago_id/liquidado/saldo_restante SÓLO cuando hubo conciliación.
--
-- CÓMO SE REVIERTE: restaurar pasarela_registrar_estado de 20261015000000,
-- borrar pasarela_estado_persistido y el índice
-- uq_conta_incidencias_aprobado_tras_reembolso.
-- ============================================================================

-- Una incidencia «aprobado después de reembolsado» por solicitud.
CREATE UNIQUE INDEX uq_conta_incidencias_aprobado_tras_reembolso
  ON public.conta_incidencias_conciliacion (payment_request_id)
  WHERE tipo = 'aprobado_tras_reembolso';

-- Estado PERSISTIDO de una solicitud de cobro, para la respuesta. INTERNA.
CREATE FUNCTION public.pasarela_estado_persistido(p_pr uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'estado', pr.estado,
    'conciliado', pr.estado = 'succeeded' AND EXISTS (
       SELECT 1 FROM public.pagos p
        WHERE p.payment_request_id = pr.id AND p.deleted_at IS NULL
          AND p.estado IS DISTINCT FROM 'rechazado'),
    'en_revision', pr.estado = 'pending_verification' AND EXISTS (
       SELECT 1 FROM public.conta_incidencias_conciliacion i
        WHERE i.payment_request_id = pr.id AND i.tipo = 'cobro_sobre_documento_anulado'),
    'reembolsado', pr.estado = 'refunded')
    FROM public.payment_requests pr WHERE pr.id = p_pr
$$;

REVOKE EXECUTE ON FUNCTION public.pasarela_estado_persistido(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pasarela_registrar_estado(
  p_payment_request_id uuid,
  p_estado             text,
  p_origen             text,
  p_clave_evento       text DEFAULT NULL,
  p_payload            jsonb DEFAULT NULL,
  p_verificado_por     text DEFAULT NULL,
  p_verificado_en      timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pr     public.payment_requests;
  v_clave  text;
  v_prev   text;
  v_nuevo  text;
  v_accion text;
  v_det    text;
  v_conc   jsonb := '{}'::jsonb;
  v_pago   public.pagos;
  v_ev     uuid := gen_random_uuid();
  v_inc_t  text;
  v_inc_d  text;
  v_inc    uuid;
  v_err    text;
  v_sin    text;
  v_retenido uuid;
  v_pago_x uuid;
BEGIN
  PERFORM public.pasarela_exigir_service_role();
  IF p_estado IS NULL OR p_estado NOT IN ('aprobado','pendiente','requiere_accion','rechazado','error','reembolsado') THEN
    RAISE EXCEPTION 'estado del proveedor inválido: %', p_estado USING ERRCODE = '22023';
  END IF;
  IF p_origen IS NULL OR p_origen NOT IN ('consulta','webhook') THEN
    RAISE EXCEPTION 'origen inválido: %', p_origen USING ERRCODE = '22023';
  END IF;

  -- Todo aviso de la MISMA solicitud se serializa aquí.
  SELECT * INTO v_pr FROM public.payment_requests pr WHERE pr.id = p_payment_request_id FOR UPDATE;
  IF v_pr.id IS NULL THEN
    RAISE EXCEPTION 'solicitud de cobro no encontrada' USING ERRCODE = 'P0002';
  END IF;
  v_prev  := v_pr.estado;
  v_nuevo := v_pr.estado;
  -- Sin clave del proveedor (consulta desde el servidor), la clave es el
  -- estado informado: consultar dos veces lo mismo es el mismo aviso.
  v_clave := COALESCE(NULLIF(btrim(COALESCE(p_clave_evento, '')), ''),
                      'consulta:' || v_pr.id::text || ':' || p_estado);

  -- DUPLICADO: ya procesado (y confirmado). No se hace nada otra vez.
  IF EXISTS (SELECT 1 FROM public.pasarela_eventos e
              WHERE e.provider = v_pr.provider AND e.clave_evento = v_clave) THEN
    IF v_pr.estado = 'succeeded' THEN
      v_conc := public.conciliar_pago_externo(v_pr.id, NULL, NULL);
    END IF;
    RETURN v_conc || jsonb_build_object('ok', true, 'duplicado', true, 'accion', 'duplicado')
           || public.pasarela_estado_persistido(v_pr.id);
  END IF;

  -- Cobro ya retenido por caer sobre una cuota anulada o eliminada (abajo).
  SELECT i.id INTO v_retenido FROM public.conta_incidencias_conciliacion i
   WHERE i.payment_request_id = v_pr.id AND i.tipo = 'cobro_sobre_documento_anulado';

  IF p_estado = 'aprobado' AND v_retenido IS NULL
     AND v_pr.estado NOT IN ('succeeded','refunded') AND v_pr.cuota_id IS NOT NULL THEN
    v_sin := public.pasarela_cuota_sin_cobro(v_pr.cuota_id);
  END IF;

  IF p_estado = 'aprobado' THEN
    IF v_pr.estado = 'refunded' THEN
      -- Reembolso total ya confirmado (antes o después de cobrar): nunca se
      -- crea ni se acredita un pago. Una sola incidencia por solicitud.
      v_accion := 'ignorado_reembolsado';
      IF EXISTS (SELECT 1 FROM public.conta_incidencias_conciliacion i
                  WHERE i.payment_request_id = v_pr.id AND i.tipo = 'aprobado_tras_reembolso') THEN
        v_det := 'Aviso «aprobado» adicional sobre una solicitud ya reembolsada: no se acreditó ni se abrió otra incidencia.';
      ELSE
        v_inc_t := 'aprobado_tras_reembolso';
        v_inc_d := 'El proveedor informó «aprobado» después de un reembolso total confirmado: no se registró ni acreditó ningún pago. Verifica con el proveedor el estado final del cobro.';
      END IF;
    ELSIF v_retenido IS NOT NULL THEN
      v_accion := 'cobro_retenido_ya_registrado';
      v_det    := 'Aviso «aprobado» adicional de un cobro ya retenido por caer sobre una cuota anulada o eliminada: no se acreditó ni se abrió otra incidencia.';
    ELSIF v_sin IS NOT NULL THEN
      -- La cuota ya no admite cobros: se conserva la confirmación, sin pago.
      UPDATE public.payment_requests pr SET estado = 'pending_verification', updated_at = now()
       WHERE pr.id = v_pr.id;
      v_nuevo  := 'pending_verification';
      v_accion := 'cobro_sobre_documento_anulado';
      v_inc_t  := 'cobro_sobre_documento_anulado';
      v_inc_d  := 'El proveedor confirmó un cobro de ' || v_pr.monto || ' sobre una cuota '
                  || CASE v_sin WHEN 'anulada' THEN 'ANULADA' WHEN 'eliminada' THEN 'ELIMINADA' ELSE 'INEXISTENTE' END
                  || ' (solicitud ' || v_prev || '). No se registró ni acreditó ningún pago y no se devolvió nada: '
                  || 'el dinero está en el proveedor. Decide si se reembolsa (en el proveedor) o se registra como anticipo '
                  || '(solicitud de ajuste), y resuelve esta incidencia con la nota.';
    ELSE
      -- pending|failed|pending_verification → succeeded (el proveedor es la
      -- autoridad); succeeded → devuelve lo existente.
      v_conc   := public.conciliar_pago_externo(v_pr.id, p_verificado_por, p_verificado_en);
      v_accion := CASE WHEN (v_conc ->> 'ya_conciliado')::boolean THEN 'ya_conciliado' ELSE 'conciliado' END;
      v_nuevo  := 'succeeded';
    END IF;

  ELSIF p_estado = 'rechazado' THEN
    IF v_retenido IS NOT NULL AND v_pr.estado = 'pending_verification' THEN
      -- FUERA DE ORDEN: el proveedor ya confirmó el cobro retenido.
      v_accion := 'ignorado_fuera_de_orden';
      v_det    := 'El proveedor informó «rechazado» después de confirmar un cobro retenido (cuota anulada o eliminada): la solicitud sigue en verificación; revisa la incidencia abierta.';
    ELSIF v_pr.estado IN ('pending','pending_verification') THEN
      UPDATE public.payment_requests pr SET estado = 'failed', updated_at = now() WHERE pr.id = v_pr.id;
      v_nuevo := 'failed'; v_accion := 'marcado_fallido';
    ELSIF v_pr.estado = 'succeeded' THEN
      -- FUERA DE ORDEN: un rechazo después de la aprobación no revierte el
      -- cobro acreditado.
      v_accion := 'ignorado_fuera_de_orden';
      v_inc_t  := 'rechazo_tras_aprobacion';
      v_inc_d  := 'El proveedor informó «rechazado» después de haber aprobado y acreditado el cobro: no se revirtió nada. Verifica con el proveedor; si el cobro realmente no ocurrió, el proveedor enviará un reembolso o anúlalo con una solicitud de ajuste.';
    ELSE
      v_accion := 'sin_cambio';
    END IF;

  ELSIF p_estado = 'reembolsado' THEN
    IF v_retenido IS NOT NULL AND v_pr.estado = 'pending_verification' THEN
      -- El dinero retenido volvió al pagador: no había pago ni asiento.
      UPDATE public.payment_requests pr SET estado = 'refunded', updated_at = now() WHERE pr.id = v_pr.id;
      v_nuevo  := 'refunded';
      v_accion := 'reembolso_de_cobro_retenido';
      v_det    := 'Reembolso confirmado por el proveedor de un cobro retenido (cuota anulada o eliminada): no había pago registrado ni asiento que revertir. Resuelve la incidencia abierta con la nota.';
    ELSIF v_pr.estado = 'succeeded' THEN
      UPDATE public.payment_requests pr SET estado = 'refunded', updated_at = now() WHERE pr.id = v_pr.id;
      v_nuevo := 'refunded';
      SELECT * INTO v_pago FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
      IF v_pago.id IS NULL THEN
        v_accion := 'reembolso_sin_cobro';
        v_inc_t  := 'reembolso_sin_cobro';
        v_inc_d  := 'Reembolso confirmado de una solicitud acreditada sin cobro registrado. Revísalo.';
      ELSE
        BEGIN
          PERFORM public.conta_rechazar_cobro_por_reembolso(v_pago.id,
            'Reembolso confirmado por el proveedor (' || v_pr.provider || ', ' || v_clave || ')');
          v_accion := 'cobro_rechazado';
          v_inc_t  := 'reembolso_aplicado';
          v_inc_d  := 'Reembolso confirmado por el proveedor: el cobro se rechazó y su asiento se reversó. Revisa el estado del documento que pagaba.';
        EXCEPTION WHEN OTHERS THEN
          -- E5: el bloqueo se mantiene y NO se descarta el reembolso.
          GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
          v_accion := 'rechazo_bloqueado';
          v_inc_t  := 'reembolso_bloqueado';
          v_inc_d  := 'Reembolso confirmado por el proveedor, pero el cobro no se pudo rechazar: ' || v_err
                      || ' El dinero ya se devolvió: resuelve el bloqueo (p. ej. revierte las aplicaciones de su saldo con una solicitud de ajuste) y anula el cobro.';
        END;
      END IF;
    ELSIF v_pr.estado = 'refunded' THEN
      v_accion := 'sin_cambio';
    ELSE
      -- REEMBOLSO TOTAL ANTES DE LA APROBACIÓN (pending, failed o
      -- pending_verification sin cobro retenido). No hay pago que reversar;
      -- la solicitud queda 'refunded' para que un «aprobado» atrasado no cree
      -- ni acredite un pago (conciliar_pago_externo también lo rechaza:
      -- PAGO_REEMBOLSADO). Los reembolsos PARCIALES no pasan por aquí
      -- (pasarela_registrar_reembolso_parcial).
      SELECT p.id INTO v_pago_x FROM public.pagos p WHERE p.payment_request_id = v_pr.id;
      v_inc_t := 'reembolso_sin_cobro';
      IF v_pago_x IS NULL THEN
        UPDATE public.payment_requests pr SET estado = 'refunded', updated_at = now() WHERE pr.id = v_pr.id;
        v_nuevo  := 'refunded';
        v_accion := 'reembolso_antes_de_aprobar';
        v_inc_d  := 'El proveedor confirmó el reembolso TOTAL de una solicitud que no estaba acreditada (' || v_prev
                    || '). No había pago que revertir. La solicitud queda reembolsada: una aprobación posterior no se acreditará.';
      ELSE
        -- Inconsistente (pago sin solicitud acreditada): no se toca nada.
        v_accion := 'reembolso_sin_cobro';
        v_inc_d  := 'El proveedor informó un reembolso de una solicitud no acreditada (' || v_prev
                    || ') que sin embargo tiene un pago registrado. No se cambió nada: revísalo.';
      END IF;
    END IF;

  ELSE
    -- pendiente / requiere_accion / error de consulta: nunca retrocede.
    v_accion := 'sin_cambio';
  END IF;

  INSERT INTO public.pasarela_eventos (
    id, company_id, payment_request_id, provider, clave_evento, estado_informado, origen,
    estado_previo, estado_resultante, resultado, detalle, payload)
  VALUES (
    v_ev, v_pr.company_id, v_pr.id, v_pr.provider, v_clave, p_estado, p_origen,
    v_prev, v_nuevo, v_accion, COALESCE(v_inc_d, v_det), p_payload);

  IF v_inc_t IS NOT NULL THEN
    INSERT INTO public.conta_incidencias_conciliacion (
      company_id, project_id, tipo, payment_request_id, pago_id, evento_id, monto, detalle)
    VALUES (
      v_pr.company_id,
      COALESCE(v_pago.project_id,
               (SELECT c.project_id FROM public.cuotas_condominio c WHERE c.id = v_pr.cuota_id),
               (SELECT ca.project_id FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_pr.cargo_adicional_id),
               (SELECT r.project_id FROM public.registros r WHERE r.id = v_pr.registro_id)),
      v_inc_t, v_pr.id, v_pago.id, v_ev, v_pr.monto, v_inc_d)
    RETURNING id INTO v_inc;
  END IF;

  RETURN v_conc || jsonb_build_object(
    'ok', true, 'duplicado', false, 'estado_previo', v_prev,
    'accion', v_accion, 'evento_id', v_ev, 'incidencia_id', COALESCE(v_inc, v_retenido))
    || public.pasarela_estado_persistido(v_pr.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasarela_registrar_estado(uuid, text, text, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pasarela_registrar_estado(uuid, text, text, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.pasarela_registrar_estado(uuid, text, text, text, jsonb, text, timestamptz) IS
  'service_role (confirm-charge, webhooks): registra un aviso del proveedor sobre una solicitud de cobro y aplica la única transición que corresponde. Deduplicado por (proveedor, clave). El estado sólo avanza: pending→succeeded|failed|refunded, failed→succeeded|refunded, succeeded→refunded. Un reembolso total antes de aprobar deja la solicitud refunded: un «aprobado» posterior no crea ni acredita pago. Un «aprobado» sobre una cuota anulada o eliminada no acredita: pending_verification con UNA incidencia cobro_sobre_documento_anulado. La respuesta lleva el estado persistido (conciliado, en_revision, reembolsado) también en duplicados (20261016000000).';
