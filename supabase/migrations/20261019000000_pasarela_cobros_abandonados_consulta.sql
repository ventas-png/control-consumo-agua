-- ============================================================================
-- E8 · COBROS EN LÍNEA ABANDONADOS: CONSULTAR, NUNCA LIBERAR POR ANTIGÜEDAD
--
-- Decisión aprobada el 2026-10-01 (docs/DECISIONES_PENDIENTES_CONTABILIDAD.md
-- §E8):
--   · CONSULTA AUTOMÁTICA a la hora de creado el cobro y otra a las 24 h
--     (la sesión de Stripe caduca a las 24 h por defecto). Sólo un estado
--     FINAL del proveedor (pago cancelado / rechazado) pasa la solicitud a
--     failed; sin respuesta o pendiente, no cambia nada.
--   · Si tras las dos consultas sigue pendiente (o no se pudo consultar), se
--     abre UNA incidencia visible «cobro_sin_confirmar» para Contabilidad. La
--     solicitud NO se libera: sigue siendo dependencia de su documento.
--   · CONSULTA MANUAL: quien puede solicitar ajustes la pide desde la
--     incidencia («Consultar al proveedor», confirm-charge).
--   · RESOLUCIÓN MANUAL CON RESPALDO (QPayPro mientras no tenga consulta de
--     servidor a servidor, o cualquier proveedor que no responda): solicitud
--     «resolver_cobro_en_linea» (cobrado / no cobrado) con al menos un
--     respaldo (p. ej. la captura del panel del proveedor), aprobada por OTRA
--     persona. Se ejecuta por el mismo punto que un aviso del proveedor
--     (pasarela_registrar_estado, origen 'manual'): cobrado → concilia (o se
--     retiene si la cuota se anuló); no cobrado → failed. La incidencia se
--     cierra con la solicitud.
--
-- EL CRON. reconciliar_payment_requests_pendientes (20260717000000) marcaba
-- failed POR ANTIGÜEDAD: a los 30 días con referencia del proveedor, y a las
-- 24 h «sin referencia» mirando sólo provider_ref — así que también los
-- cobros de Stripe (cuya referencia es stripe_payment_intent) caían a las
-- 24 h sin preguntarle nada a Stripe. Ahora:
--   1. sólo se da por fallida a las 24 h la solicitud que no llegó a tener
--      NINGUNA referencia del proveedor (provider_ref, stripe_payment_intent
--      ni paypal_order_id): no existe un cobro en el proveedor que consultar
--      ni que pagar;
--   2. con referencia: dos consultas (1 h y 24 h) por confirm-charge, que ya
--      sabe consultar a Stripe por su PaymentIntent;
--   3. después, la incidencia; nunca failed por fecha.
--
-- CÓMO SE REVIERTE: restaurar reconciliar_payment_requests_pendientes de
-- 20260717000000, pasarela_registrar_estado de 20261016000000,
-- pasarela_exigir_service_role de 20261011000000, conta_ajuste_foto de
-- 20261011000000, y conta_ajuste_revalidar, conta_ajuste_ejecutar y
-- conta_cuota_dependencias de 20261017000000; DROP de
-- conta_ajuste_solicitar_resolucion_cobro y conta_pr_proyecto; retirar las
-- columnas y restricciones nuevas (sólo sin filas que las usen).
-- ============================================================================

-- ── 1. Seguimiento de consultas e incidencia ────────────────────────────────
ALTER TABLE public.payment_requests
  ADD COLUMN consultas_auto smallint NOT NULL DEFAULT 0,
  ADD COLUMN ultima_consulta_at timestamptz;
COMMENT ON COLUMN public.payment_requests.consultas_auto IS
  'E8: consultas automáticas al proveedor enviadas por el cron (1 h y 24 h). Después, incidencia cobro_sin_confirmar; nunca failed por antigüedad.';

ALTER TABLE public.conta_incidencias_conciliacion DROP CONSTRAINT conta_incidencias_tipo;
ALTER TABLE public.conta_incidencias_conciliacion ADD CONSTRAINT conta_incidencias_tipo CHECK (tipo IN (
  'reembolso_bloqueado', 'reembolso_aplicado', 'rechazo_tras_aprobacion',
  'aprobado_tras_reembolso', 'reembolso_sin_cobro', 'reembolso_parcial',
  'cobro_sobre_documento_anulado', 'cobro_sin_confirmar'));
CREATE UNIQUE INDEX uq_conta_incidencias_cobro_sin_confirmar
  ON public.conta_incidencias_conciliacion (payment_request_id)
  WHERE tipo = 'cobro_sin_confirmar';

ALTER TABLE public.pasarela_eventos DROP CONSTRAINT pasarela_eventos_origen;
ALTER TABLE public.pasarela_eventos ADD CONSTRAINT pasarela_eventos_origen CHECK (origen IN ('consulta', 'webhook', 'manual'));

-- Proyecto del ítem que paga una solicitud de cobro (INTERNA).
CREATE FUNCTION public.conta_pr_proyecto(p_pr public.payment_requests)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT c.project_id FROM public.cuotas_condominio c WHERE c.id = p_pr.cuota_id),
    (SELECT ca.project_id FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_pr.cargo_adicional_id),
    (SELECT r.project_id FROM public.registros r WHERE r.id = p_pr.registro_id))
$$;
REVOKE EXECUTE ON FUNCTION public.conta_pr_proyecto(public.payment_requests) FROM PUBLIC, anon, authenticated;

-- ── 2. El cron: consultar, nunca liberar por antigüedad ─────────────────────
CREATE OR REPLACE FUNCTION public.reconciliar_payment_requests_pendientes()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_base_url    text;
  v_service_key text;
  v_sin_ref     integer := 0;
  v_enviados    integer := 0;
  v_incidencias integer := 0;
  r record;
BEGIN
  -- 1) Sin NINGUNA referencia del proveedor tras 24 h → failed: el cobro no
  --    llegó a existir en el proveedor (no hay nada que consultar ni pagar).
  WITH exp AS (
    UPDATE public.payment_requests
       SET estado = 'failed',
           notas = COALESCE(notas || ' · ', '') || 'sin referencia del proveedor: el cobro no llegó a crearse (reconciliación)',
           updated_at = now()
     WHERE estado = 'pending'
       AND provider_ref IS NULL AND stripe_payment_intent IS NULL AND paypal_order_id IS NULL
       AND created_at < now() - interval '24 hours'
     RETURNING 1
  )
  SELECT count(*) INTO v_sin_ref FROM exp;

  -- 2) Consultas automáticas: a la hora y a las 24 h, por confirm-charge.
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'edge_function_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_base_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    FOR r IN
      SELECT id
        FROM public.payment_requests
       WHERE estado = 'pending'
         AND (provider_ref IS NOT NULL OR stripe_payment_intent IS NOT NULL)
         AND ((consultas_auto = 0 AND created_at < now() - interval '1 hour')
              OR (consultas_auto = 1 AND created_at < now() - interval '24 hours'))
       ORDER BY created_at
       LIMIT 50
       FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM net.http_post(
        url     := v_base_url || '/confirm-charge',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body    := jsonb_build_object('payment_request_id', r.id, 'source', 'pg_cron')
      );
      UPDATE public.payment_requests pr
         SET consultas_auto = pr.consultas_auto + 1, ultima_consulta_at = now()
       WHERE pr.id = r.id;
      v_enviados := v_enviados + 1;
    END LOOP;
  END IF;

  -- 3) Sigue sin confirmar tras las dos consultas (o no se puede consultar):
  --    incidencia visible. NO se cambia el estado: nada se libera por fecha.
  INSERT INTO public.conta_incidencias_conciliacion
    (company_id, project_id, tipo, payment_request_id, monto, detalle)
  SELECT pr.company_id, public.conta_pr_proyecto(pr), 'cobro_sin_confirmar', pr.id, pr.monto,
         'Cobro en línea (' || pr.provider || ') de ' || pr.monto || ' sin confirmar desde '
           || to_char(pr.created_at, 'YYYY-MM-DD HH24:MI') || ' UTC'
           || CASE WHEN v_base_url IS NULL OR v_service_key IS NULL
                   THEN ' (no se pudo consultar automáticamente: faltan los secretos del cron)'
                   ELSE ' tras ' || pr.consultas_auto || ' consultas automáticas' END
           || '. No se liberó: sigue bloqueando su documento. Consulta al proveedor o solicita su resolución con respaldo.'
    FROM public.payment_requests pr
   WHERE pr.estado = 'pending'
     AND pr.created_at < now() - interval '25 hours'
     AND (pr.consultas_auto >= 2 OR v_base_url IS NULL OR v_service_key IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.conta_incidencias_conciliacion i
                      WHERE i.payment_request_id = pr.id AND i.tipo = 'cobro_sin_confirmar')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_incidencias = ROW_COUNT;

  RAISE NOTICE 'reconciliar_payment_requests: % consultas enviadas, % sin referencia, % incidencias nuevas',
    v_enviados, v_sin_ref, v_incidencias;
  RETURN v_enviados;
END $$;

REVOKE EXECUTE ON FUNCTION public.reconciliar_payment_requests_pendientes() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reconciliar_payment_requests_pendientes() IS
  'E8 (cada 15 min, pg_cron): consulta al proveedor (confirm-charge) los cobros en línea pendientes a la hora y a las 24 h; después abre una incidencia cobro_sin_confirmar. Nunca los marca failed por antigüedad; sólo da por fallida a las 24 h la solicitud que no llegó a tener referencia del proveedor.';

-- ── 3. Ejecución manual autorizada: el punto único del proveedor ────────────
-- pasarela_exigir_service_role: cuerpo de 20261011000000 + la ejecución de
-- una solicitud resolver_cobro_en_linea aprobada (en ESTA transacción).
CREATE OR REPLACE FUNCTION public.pasarela_exigir_service_role()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rol text := COALESCE((NULLIF(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
BEGIN
  IF v_rol <> 'service_role' AND current_user <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.conta_ajustes_solicitudes s
                      WHERE s.ejecucion_txid = txid_current() AND s.tipo = 'resolver_cobro_en_linea') THEN
    RAISE EXCEPTION 'operación del proveedor de pago, no de un usuario' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pasarela_exigir_service_role() FROM PUBLIC, anon, authenticated;

-- pasarela_registrar_estado: cuerpo de 20261016000000 + origen 'manual' (sólo
-- desde la ejecución de su solicitud de resolución).
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
  IF p_origen IS NULL OR p_origen NOT IN ('consulta','webhook','manual') THEN
    RAISE EXCEPTION 'origen inválido: %', p_origen USING ERRCODE = '22023';
  END IF;
  -- Manual (E8): sólo la resolución aprobada de ESTA solicitud de cobro.
  IF p_origen = 'manual' AND public.conta_ajuste_en_ejecucion('resolver_cobro_en_linea', p_payment_request_id) IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_REQUIERE_SOLICITUD: un estado manual de un cobro en línea se registra con una solicitud de resolución aprobada.'
      USING ERRCODE = '42501';
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

-- ── 4. Solicitud resolver_cobro_en_linea ────────────────────────────────────
ALTER TABLE public.conta_ajustes_solicitudes ADD COLUMN resolucion text;
COMMENT ON COLUMN public.conta_ajustes_solicitudes.resolucion IS
  'resolver_cobro_en_linea (E8): cobrado | no_cobrado, según el respaldo del proveedor.';
ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_tipo_valido;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_tipo_valido CHECK (tipo IN (
  'anular_cargo', 'anular_cobro_cargo', 'anular_anticipo',
  'revertir_aplicacion_saldo_favor', 'aplicar_saldo_favor', 'anular_cuota', 'ajuste_importe',
  'resolver_cobro_en_linea'));
ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_documento_del_tipo;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_documento_del_tipo CHECK (
     (tipo = 'anular_cargo'                    AND documento_tabla = 'cargos_adicionales_unidad')
  OR (tipo IN ('anular_cobro_cargo','anular_anticipo') AND documento_tabla = 'pagos')
  OR (tipo = 'revertir_aplicacion_saldo_favor' AND documento_tabla = 'conta_saldo_favor_aplicaciones')
  OR (tipo = 'aplicar_saldo_favor'             AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad'))
  OR (tipo = 'anular_cuota'                    AND documento_tabla = 'cuotas_condominio')
  OR (tipo = 'ajuste_importe'                  AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad'))
  OR (tipo = 'resolver_cobro_en_linea'         AND documento_tabla = 'payment_requests'));
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_resolucion_completa CHECK (
  (tipo = 'resolver_cobro_en_linea') = (resolucion IS NOT NULL)
  AND (resolucion IS NULL OR resolucion IN ('cobrado','no_cobrado')));

-- conta_ajuste_foto: cuerpo de 20261011000000 + la solicitud de cobro.
CREATE OR REPLACE FUNCTION public.conta_ajuste_foto(
  p_company uuid,
  p_project uuid,
  p_tipo    text,
  p_tabla   text,
  p_id      uuid,
  p_origen  uuid,
  p_bloquear boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ca   public.cargos_adicionales_unidad;
  v_cu   public.cuotas_condominio;
  v_p    public.pagos;
  v_x    public.conta_saldo_favor_aplicaciones;
  v_o    public.conta_saldo_favor_origenes;
  v_s    record;
  v_q    record;
  v_pr   public.payment_requests;
BEGIN
  IF p_tabla = 'cargos_adicionales_unidad' THEN
    IF p_bloquear THEN
      SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca
       WHERE ca.id = p_id AND ca.company_id = p_company AND ca.project_id = p_project FOR UPDATE;
    ELSE
      SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca
       WHERE ca.id = p_id AND ca.company_id = p_company AND ca.project_id = p_project;
    END IF;
    IF v_ca.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_ca.id);
    RETURN jsonb_build_object(
      'estado', v_ca.estado, 'monto', v_ca.monto, 'responsable', v_ca.responsable_cliente_id,
      'unidad', v_ca.unidad_id, 'concepto', v_ca.concepto,
      'saldo', CASE WHEN v_s.devengo_monto IS NULL THEN NULL
                    ELSE round(v_s.devengo_monto - v_s.aplicado, 2) END);
  ELSIF p_tabla = 'cuotas_condominio' THEN
    IF p_bloquear THEN
      SELECT * INTO v_cu FROM public.cuotas_condominio c
       WHERE c.id = p_id AND c.company_id = p_company AND c.project_id = p_project FOR UPDATE;
    ELSE
      SELECT * INTO v_cu FROM public.cuotas_condominio c
       WHERE c.id = p_id AND c.company_id = p_company AND c.project_id = p_project;
    END IF;
    IF v_cu.id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(v_cu.id);
    RETURN jsonb_build_object(
      'estado', COALESCE(v_cu.cuota_estado, v_cu.estado), 'monto', v_cu.monto,
      'responsable', v_cu.responsable_cliente_id, 'unidad', v_cu.unidad_id,
      'concepto', v_cu.concepto || ' ' || v_cu.periodo,
      'saldo', CASE WHEN v_q.princ_monto IS NULL THEN NULL
                    ELSE round(COALESCE(v_q.princ_monto, 0) + COALESCE(v_q.mora_monto, 0)
                               - v_q.aplicado_princ - v_q.aplicado_mora, 2) END);
  ELSIF p_tabla = 'pagos' THEN
    IF p_bloquear THEN
      -- Cobro de cargo: el cargo primero (orden de conta_anular_cobro_cargo).
      PERFORM 1 FROM public.cargos_adicionales_unidad ca
       WHERE ca.id = (SELECT p.cargo_adicional_id FROM public.pagos p WHERE p.id = p_id) FOR UPDATE;
      SELECT * INTO v_p FROM public.pagos p WHERE p.id = p_id FOR UPDATE;
    ELSE
      SELECT * INTO v_p FROM public.pagos p WHERE p.id = p_id;
    END IF;
    IF v_p.id IS NULL
       OR v_p.project_id IS DISTINCT FROM p_project
       OR NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = v_p.project_id AND pr.company_id = p_company) THEN
      RETURN NULL;
    END IF;
    IF p_tipo = 'anular_cobro_cargo' AND v_p.cargo_adicional_id IS NULL THEN RETURN NULL; END IF;
    IF p_tipo = 'anular_anticipo'
       AND NOT EXISTS (SELECT 1 FROM public.conta_anticipos an WHERE an.pago_id = v_p.id AND an.company_id = p_company) THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object(
      'estado', v_p.estado, 'monto', v_p.monto, 'responsable', v_p.cliente_id,
      'eliminado', v_p.deleted_at IS NOT NULL, 'cargo', v_p.cargo_adicional_id);
  ELSIF p_tabla = 'conta_saldo_favor_aplicaciones' THEN
    SELECT * INTO v_x FROM public.conta_saldo_favor_aplicaciones x
     WHERE x.id = p_id AND x.company_id = p_company AND x.project_id = p_project;
    IF v_x.id IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object(
      'estado', CASE WHEN v_x.revertida_at IS NULL THEN 'viva' ELSE 'revertida' END,
      'monto', v_x.monto, 'responsable', v_x.cliente_id, 'origen', v_x.origen_id);
  ELSIF p_tabla = 'payment_requests' THEN
    IF p_bloquear THEN
      SELECT * INTO v_pr FROM public.payment_requests pr WHERE pr.id = p_id AND pr.company_id = p_company FOR UPDATE;
    ELSE
      SELECT * INTO v_pr FROM public.payment_requests pr WHERE pr.id = p_id AND pr.company_id = p_company;
    END IF;
    IF v_pr.id IS NULL OR public.conta_pr_proyecto(v_pr) IS DISTINCT FROM p_project THEN RETURN NULL; END IF;
    RETURN jsonb_build_object(
      'estado', v_pr.estado, 'monto', v_pr.monto, 'responsable', v_pr.cliente_id,
      'proveedor', v_pr.provider,
      'referencia', COALESCE(v_pr.provider_ref, v_pr.stripe_payment_intent, v_pr.paypal_order_id),
      'concepto', 'Cobro en línea ' || v_pr.provider || ' del ' || to_char(v_pr.created_at, 'YYYY-MM-DD'));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_foto(uuid, uuid, text, text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- Solicitar la resolución manual de un cobro en línea (con respaldo).
CREATE FUNCTION public.conta_ajuste_solicitar_resolucion_cobro(
  p_id                 uuid,
  p_payment_request_id uuid,
  p_resolucion         text,
  p_motivo             text
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_pr      public.payment_requests;
  v_project uuid;
  v_existe  public.conta_ajustes_solicitudes;
  v_sol     public.conta_ajustes_solicitudes;
  v_foto    jsonb;
  v_motivo  text := btrim(COALESCE(p_motivo, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.conta_ajuste_puede_solicitar('resolver_cobro_en_linea') THEN
    RAISE EXCEPTION 'No autorizado para solicitar este ajuste.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_CLAVE: falta la clave de la solicitud.' USING ERRCODE = '22023';
  END IF;
  IF p_resolucion IS NULL OR p_resolucion NOT IN ('cobrado','no_cobrado') THEN
    RAISE EXCEPTION 'AJUSTE_RESOLUCION: indica si el proveedor cobró (cobrado) o no (no_cobrado).' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'AJUSTE_MOTIVO: indica el motivo (al menos 5 caracteres).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existe FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.company_id IS DISTINCT FROM v_company OR v_existe.tipo IS DISTINCT FROM 'resolver_cobro_en_linea'
       OR v_existe.documento_id IS DISTINCT FROM p_payment_request_id OR v_existe.resolucion IS DISTINCT FROM p_resolucion
       OR v_existe.motivo IS DISTINCT FROM v_motivo OR v_existe.solicitado_por IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'AJUSTE_CLAVE_REUSADA: esa clave ya identifica otra solicitud. No se registró nada.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existe.id, v_existe.estado, true;
    RETURN;
  END IF;

  SELECT * INTO v_pr FROM public.payment_requests pr WHERE pr.id = p_payment_request_id AND pr.company_id = v_company;
  v_project := public.conta_pr_proyecto(v_pr);
  IF v_pr.id IS NULL OR v_project IS NULL OR NOT public.can_access_project(v_project) THEN
    RAISE EXCEPTION 'El cobro en línea no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_pr.estado = 'pending' OR (v_pr.estado = 'failed' AND p_resolucion = 'cobrado')) THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el cobro en línea está % y no admite esa resolución.', v_pr.estado
      USING ERRCODE = 'check_violation';
  END IF;
  v_foto := public.conta_ajuste_foto(v_company, v_project, 'resolver_cobro_en_linea', 'payment_requests', v_pr.id, NULL, false);

  BEGIN
    INSERT INTO public.conta_ajustes_solicitudes (
      id, company_id, project_id, tipo, documento_tabla, documento_id, resolucion,
      importe, motivo, canal, solicitado_por, foto_documento)
    VALUES (
      p_id, v_company, v_project, 'resolver_cobro_en_linea', 'payment_requests', v_pr.id, p_resolucion,
      v_pr.monto, v_motivo, 'backoffice', auth.uid(), v_foto)
    RETURNING * INTO v_sol;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'AJUSTE_YA_SOLICITADO: ya hay una solicitud de resolución abierta para este cobro. Resuélvela antes de pedir otra.'
      USING ERRCODE = '23505';
  END;
  PERFORM public.conta_ajuste_evento(v_sol, 'solicitada', NULL, 'pendiente', v_motivo);
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_solicitar_resolucion_cobro(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_solicitar_resolucion_cobro(uuid, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_solicitar_resolucion_cobro(uuid, uuid, text, text) IS
  'E8: solicita resolver a mano un cobro en línea sin confirmar (cobrado / no cobrado). Exige al menos un respaldo antes de aprobarse; la aprueba otra persona y se ejecuta como un aviso del proveedor (origen manual). Idempotente por p_id; una abierta por cobro.';

-- conta_ajuste_revalidar: cuerpo de 20261017000000 + resolver_cobro_en_linea.
CREATE OR REPLACE FUNCTION public.conta_ajuste_revalidar(p_sol public.conta_ajustes_solicitudes)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ahora jsonb;
  v_antes jsonb := p_sol.foto_documento;
  v_disp  numeric(14,2);
  v_o     public.conta_saldo_favor_origenes;
BEGIN
  v_ahora := public.conta_ajuste_foto(p_sol.company_id, p_sol.project_id, p_sol.tipo,
               p_sol.documento_tabla, p_sol.documento_id, p_sol.saldo_origen_id, true);
  IF v_ahora IS NULL
     OR (p_sol.tipo IN ('anular_cuota','ajuste_importe') AND p_sol.documento_tabla = 'cuotas_condominio'
         AND EXISTS (SELECT 1 FROM public.cuotas_condominio c
                      WHERE c.id = p_sol.documento_id AND c.deleted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_INEXISTENTE: el documento ya no existe en esta contabilidad.'
      USING ERRCODE = 'P0002';
  END IF;

  -- PERÍODO. Las anulaciones y reversos se fechan en el período del asiento
  -- original o, si está cerrado, hoy; una aplicación, hoy. Si el período de
  -- hoy está cerrado no hay fecha posible.
  IF public.conta_periodo_cerrado(p_sol.project_id, to_char(CURRENT_DATE, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'AJUSTE_PERIODO_CERRADO: el período % está cerrado; reábrelo o espera al siguiente y reintenta.',
      to_char(CURRENT_DATE, 'YYYY-MM') USING ERRCODE = 'check_violation';
  END IF;

  -- DOCUMENTO: lo aprobado es lo que se vio al solicitar.
  IF (v_antes ->> 'monto') IS DISTINCT FROM (v_ahora ->> 'monto')
     OR (v_antes ->> 'responsable') IS DISTINCT FROM (v_ahora ->> 'responsable') THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento cambió después de la solicitud (importe o responsable: % → %). Rechaza esta solicitud y crea otra.',
      COALESCE(v_antes ->> 'monto', '—') || '/' || COALESCE(v_antes ->> 'responsable', '—'),
      COALESCE(v_ahora ->> 'monto', '—') || '/' || COALESCE(v_ahora ->> 'responsable', '—')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sol.tipo = 'anular_cargo' AND v_ahora ->> 'estado' = 'anulado' THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el cargo ya está anulado.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sol.tipo IN ('anular_cobro_cargo','anular_anticipo')
     AND (v_ahora ->> 'estado' = 'rechazado' OR (v_ahora ->> 'eliminado')::boolean) THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el cobro ya está anulado.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sol.tipo = 'revertir_aplicacion_saldo_favor' AND v_ahora ->> 'estado' = 'revertida' THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: la aplicación ya está revertida.' USING ERRCODE = 'check_violation';
  END IF;

  -- ANULAR CUOTA: no anulada ya, y sin dependencias vivas (con la cuota
  -- bloqueada: un cobro nuevo espera a esta transacción y ve la anulación).
  IF p_sol.tipo = 'anular_cuota' THEN
    IF v_ahora ->> 'estado' = 'anulada' THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: la cuota ya está anulada.' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM public.conta_cuota_exigir_sin_dependencias(p_sol.documento_id, true, 'AJUSTE_DEPENDENCIAS');
  END IF;

  -- SALDO de una aplicación: disponible del origen y saldo del documento.
  IF p_sol.tipo = 'aplicar_saldo_favor' THEN
    IF v_ahora ->> 'estado' IN ('anulado','anulada','pagado','pagada') THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento ya no admite aplicaciones (estado: %).', v_ahora ->> 'estado'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_o FROM public.conta_saldo_favor_origenes o WHERE o.id = p_sol.saldo_origen_id;
    v_disp := public.conta_sf_disponible(p_sol.saldo_origen_id);
    IF v_o.id IS NULL OR v_disp IS NULL OR v_disp < p_sol.importe THEN
      RAISE EXCEPTION 'AJUSTE_SALDO_INSUFICIENTE: el saldo a favor disponible (% %) ya no alcanza para aplicar %.',
        COALESCE(v_disp, 0), COALESCE(v_o.moneda, ''), p_sol.importe USING ERRCODE = 'check_violation';
    END IF;
    IF (v_ahora ->> 'saldo') IS NOT NULL AND (v_ahora ->> 'saldo')::numeric < p_sol.importe THEN
      RAISE EXCEPTION 'AJUSTE_SALDO_DOCUMENTO: el documento ahora debe % y la solicitud aplica %. Rechaza esta solicitud y crea otra por el importe correcto.',
        v_ahora ->> 'saldo', p_sol.importe USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- RESOLUCIÓN MANUAL (E8): el cobro sigue sin resolver y hay respaldo.
  IF p_sol.tipo = 'resolver_cobro_en_linea' THEN
    IF NOT (v_ahora ->> 'estado' = 'pending' OR (v_ahora ->> 'estado' = 'failed' AND p_sol.resolucion = 'cobrado')) THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el cobro en línea ya está % (lo resolvió el proveedor u otra solicitud).', v_ahora ->> 'estado'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conta_ajustes_respaldos r WHERE r.solicitud_id = p_sol.id) THEN
      RAISE EXCEPTION 'AJUSTE_RESPALDO_REQUERIDO: adjunta al menos un respaldo (p. ej. la captura del panel del proveedor) antes de aprobar.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- REBAJA (E6): no anulado, y el tope con el documento bloqueado.
  IF p_sol.tipo = 'ajuste_importe' THEN
    IF v_ahora ->> 'estado' IN ('anulado','anulada') THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento ya está anulado.' USING ERRCODE = 'check_violation';
    END IF;
    v_disp := public.conta_rebaja_saldo(p_sol.documento_tabla, p_sol.documento_id, p_sol.componente);
    IF v_disp IS NULL OR v_disp < p_sol.importe THEN
      RAISE EXCEPTION 'AJUSTE_REBAJA_EXCEDE_SALDO: el saldo pendiente ahora es %; la rebaja de % no puede superarlo. Rechaza esta solicitud y crea otra por un importe menor.',
        COALESCE(v_disp, 0), p_sol.importe USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN v_ahora;
END;
$$;

-- conta_ajuste_ejecutar: cuerpo de 20261017000000 + resolver_cobro_en_linea.
CREATE OR REPLACE FUNCTION public.conta_ajuste_ejecutar(p_sol public.conta_ajustes_solicitudes, p_accion text)
RETURNS public.conta_ajustes_solicitudes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol   public.conta_ajustes_solicitudes := p_sol;
  v_res   jsonb;
  v_rev   uuid;
  v_rev_m uuid;
  v_tenia boolean;
  v_err   text;
  v_prev  text := p_sol.estado;
BEGIN
  UPDATE public.conta_ajustes_solicitudes s
     SET intentos_ejecucion = s.intentos_ejecucion + 1, updated_at = now()
   WHERE s.id = v_sol.id;

  BEGIN
    UPDATE public.conta_ajustes_solicitudes s SET ejecucion_txid = txid_current() WHERE s.id = v_sol.id;

    PERFORM public.conta_ajuste_revalidar(v_sol);

    IF v_sol.tipo = 'anular_cargo' THEN
      -- El trigger del cargo reversa su devengo (si lo tenía); la evidencia
      -- se escribe después, con el reverso ya hecho.
      UPDATE public.cargos_adicionales_unidad ca SET estado = 'anulado' WHERE ca.id = v_sol.documento_id;
      SELECT a.anulado_por_id INTO v_rev FROM public.conta_asientos a
       WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
         AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = v_sol.documento_id
         AND a.origen_evento = 'cargo_adicional_emitido'
       ORDER BY a.created_at DESC LIMIT 1;
      INSERT INTO public.conta_cargo_anulaciones
        (cargo_id, company_id, project_id, solicitud_id, anulado_por, motivo, tenia_asiento, reverso_id)
      VALUES (v_sol.documento_id, v_sol.company_id, v_sol.project_id, v_sol.id, auth.uid(), v_sol.motivo,
              EXISTS (SELECT 1 FROM public.conta_asientos a
                       WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
                         AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = v_sol.documento_id
                         AND a.origen_evento = 'cargo_adicional_emitido'),
              v_rev);
      SELECT to_jsonb(an) INTO v_res FROM public.conta_cargo_anulaciones an WHERE an.cargo_id = v_sol.documento_id;
    ELSIF v_sol.tipo = 'anular_cuota' THEN
      -- La cuota queda anulada con la hora del servidor (el estado de cuenta
      -- la ubica al corte por anulada_at). Su devengo y su mora se reversan
      -- con asientos vinculados; los originales no se tocan.
      v_tenia := EXISTS (SELECT 1 FROM public.conta_asientos a
                          WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
                            AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_sol.documento_id
                            AND a.origen_evento IN ('cuota_emitida','cuota_mora') AND a.estado = 'publicado');
      UPDATE public.cuotas_condominio c
         SET cuota_estado = 'anulada', anulada_at = now()
       WHERE c.id = v_sol.documento_id;
      v_rev := public.conta_reversar_automatico(v_sol.company_id, 'cuotas_condominio', v_sol.documento_id,
                 'cuota_emitida', 'Cuota anulada (solicitud ' || left(v_sol.id::text, 8) || ')');
      v_rev_m := public.conta_reversar_automatico(v_sol.company_id, 'cuotas_condominio', v_sol.documento_id,
                 'cuota_mora', 'Mora de cuota anulada (solicitud ' || left(v_sol.id::text, 8) || ')');
      -- conta_reversar_automatico no lanza: si algo quedó sin reversar, se
      -- deshace todo.
      IF EXISTS (SELECT 1 FROM public.conta_asientos a
                  WHERE a.company_id = v_sol.company_id AND a.origen = 'automatico'
                    AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_sol.documento_id
                    AND a.origen_evento IN ('cuota_emitida','cuota_mora')
                    AND a.estado = 'publicado' AND a.anulado_por_id IS NULL) THEN
        RAISE EXCEPTION 'AJUSTE_REVERSO_FALLO: no se pudo reversar el devengo de la cuota; no se anuló. Revisa el registro del servidor y reintenta.'
          USING ERRCODE = 'check_violation';
      END IF;
      INSERT INTO public.conta_cuota_anulaciones
        (cuota_id, company_id, project_id, solicitud_id, anulado_por, motivo, tenia_asiento,
         reverso_emision_id, reverso_mora_id)
      VALUES (v_sol.documento_id, v_sol.company_id, v_sol.project_id, v_sol.id, auth.uid(), v_sol.motivo,
              v_tenia, v_rev, v_rev_m);
      SELECT to_jsonb(an) INTO v_res FROM public.conta_cuota_anulaciones an WHERE an.cuota_id = v_sol.documento_id;
    ELSIF v_sol.tipo = 'anular_cobro_cargo' THEN
      SELECT to_jsonb(r) INTO v_res FROM public.conta_anular_cobro_cargo(v_sol.documento_id, v_sol.motivo) r;
    ELSIF v_sol.tipo = 'anular_anticipo' THEN
      SELECT to_jsonb(r) INTO v_res FROM public.conta_anular_anticipo(v_sol.documento_id, v_sol.motivo) r;
    ELSIF v_sol.tipo = 'revertir_aplicacion_saldo_favor' THEN
      SELECT to_jsonb(r) INTO v_res FROM public.conta_revertir_aplicacion_saldo_favor(v_sol.documento_id, v_sol.motivo) r;
    ELSIF v_sol.tipo = 'resolver_cobro_en_linea' THEN
      -- Por el punto único de un aviso del proveedor: cobrado concilia (o
      -- se retiene si la cuota se anuló); no cobrado pasa a failed.
      v_res := public.pasarela_registrar_estado(
        v_sol.documento_id,
        CASE v_sol.resolucion WHEN 'cobrado' THEN 'aprobado' ELSE 'rechazado' END,
        'manual', 'manual:' || v_sol.id::text,
        jsonb_build_object('solicitud_id', v_sol.id, 'resolucion', v_sol.resolucion,
                           'motivo', v_sol.motivo, 'respaldos', v_sol.respaldos_revisados),
        v_sol.revisado_por::text, now());
      UPDATE public.conta_incidencias_conciliacion i
         SET estado = 'resuelta', resuelta_por = v_sol.revisado_por, resuelta_at = now(),
             nota_resolucion = 'Resuelto por la solicitud ' || v_sol.id::text || ' (' || v_sol.resolucion || ', con respaldo).'
       WHERE i.payment_request_id = v_sol.documento_id AND i.tipo = 'cobro_sin_confirmar' AND i.estado = 'abierta';
    ELSIF v_sol.tipo = 'ajuste_importe' THEN
      SELECT to_jsonb(n) INTO v_res FROM public.conta_nota_credito_registrar(v_sol) n;
    ELSIF v_sol.tipo = 'aplicar_saldo_favor' THEN
      -- La aplicación usa el id de la solicitud como su clave: un reintento
      -- después de un éxito que no alcanzó a sellarse no aplica dos veces.
      SELECT to_jsonb(r) INTO v_res
        FROM public.conta_aplicar_saldo_favor(v_sol.saldo_origen_id, v_sol.documento_tabla, v_sol.documento_id,
                                              v_sol.importe, 'Solicitud ' || v_sol.id::text || ': ' || v_sol.motivo,
                                              v_sol.id) r;
    END IF;

    UPDATE public.conta_ajustes_solicitudes s
       SET estado = 'ejecutada', ejecutado_at = now(), resultado = COALESCE(v_res, '{}'::jsonb),
           error_ejecucion = NULL, ejecucion_txid = NULL, updated_at = now()
     WHERE s.id = v_sol.id
    RETURNING * INTO v_sol;
    PERFORM public.conta_ajuste_evento(v_sol, 'ejecutada', v_prev, 'ejecutada', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    UPDATE public.conta_ajustes_solicitudes s
       SET estado = 'fallida', error_ejecucion = v_err, ejecucion_txid = NULL, updated_at = now()
     WHERE s.id = v_sol.id
    RETURNING * INTO v_sol;
    PERFORM public.conta_ajuste_evento(v_sol, 'fallida', v_prev, 'fallida', v_err);
  END;
  RETURN v_sol;
END;
$$;

-- conta_cuota_dependencias: cuerpo de 20261017000000; el cobro en línea en
-- curso dice cómo resolverlo (E8).
CREATE OR REPLACE FUNCTION public.conta_cuota_dependencias(p_cuota uuid, p_para_anular boolean)
RETURNS TABLE (dependencia text, id uuid, monto numeric, estado text, detalle text, como_resolver text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT * FROM public.cuotas_condominio c WHERE c.id = p_cuota)
  SELECT 'cobro'::text, p.id, p.monto, p.estado,
         'Cobro ' || COALESCE(p.metodo, '') || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '')
           || ' del ' || to_char(COALESCE(p.verified_at, p.created_at), 'YYYY-MM-DD'),
         'Recházalo o anúlalo en Pagos antes de anular la cuota.'
    FROM c JOIN public.pagos p ON (p.cuota_id = c.id OR p.id = c.pago_id)
   WHERE p.deleted_at IS NULL AND p.estado IS DISTINCT FROM 'rechazado'
  UNION ALL
  SELECT 'aplicacion_saldo_favor', x.id, x.monto, 'viva',
         'Aplicación de saldo a favor del ' || to_char(x.created_at, 'YYYY-MM-DD'),
         'Solicita revertir la aplicación (Contabilidad › Saldos a favor).'
    FROM c JOIN public.conta_saldo_favor_aplicaciones x ON x.cuota_id = c.id
   WHERE x.revertida_at IS NULL
  UNION ALL
  SELECT 'cobro_en_linea', pr.id, pr.monto, pr.estado,
         'Pago en línea en curso (' || pr.provider || ')',
         'Espera la confirmación del proveedor, consúltalo («Consultar al proveedor») o solicita su resolución con respaldo.'
    FROM c JOIN public.payment_requests pr ON pr.cuota_id = c.id
   WHERE pr.estado IN ('pending','pending_verification')
  UNION ALL
  SELECT 'solicitud_aplicacion', s.id, s.importe, s.estado,
         'Solicitud abierta de aplicar saldo a favor',
         'Recházala o que la cancele quien la pidió.'
    FROM c JOIN public.conta_ajustes_solicitudes s
      ON s.tipo = 'aplicar_saldo_favor' AND s.documento_id = c.id
   WHERE s.estado IN ('pendiente','fallida')
  UNION ALL
  SELECT 'nota_credito', n.id, n.monto, 'viva',
         'Nota de crédito (' || n.componente || ') del ' || to_char(n.created_at, 'YYYY-MM-DD'),
         'Reversa la póliza de la nota de crédito (Contabilidad › Pólizas) antes de anular la cuota.'
    FROM c JOIN public.conta_notas_credito n ON n.cuota_id = c.id
   WHERE public.conta_sf_asiento_vivo(n.asiento_id)
  UNION ALL
  SELECT 'solicitud_rebaja', s.id, s.importe, s.estado,
         'Solicitud abierta de rebaja de importe (' || s.componente || ')',
         'Recházala o que la cancele quien la pidió.'
    FROM c JOIN public.conta_ajustes_solicitudes s
      ON s.tipo = 'ajuste_importe' AND s.documento_id = c.id
   WHERE s.estado IN ('pendiente','fallida')
  UNION ALL
  SELECT 'devengo_borrador', a.id, a.total_debe, a.estado,
         'Asiento de ' || a.origen_evento || ' en ' || a.estado,
         'Publícalo o anúlalo en Contabilidad antes de anular la cuota.'
    FROM c JOIN public.conta_asientos a
      ON a.company_id = c.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
     AND a.origen_evento IN ('cuota_emitida','cuota_mora')
   WHERE p_para_anular AND a.estado NOT IN ('publicado','anulado')
  UNION ALL
  SELECT DISTINCT ON (i.evento) 'devengo_pendiente', i.id, NULL::numeric, i.evento,
         'Contabilización pendiente de ' || i.evento,
         'Reprocésala (Contabilidad › Pendientes) antes de anular la cuota.'
    FROM c JOIN public.conta_intentos_contabilizacion i
      ON i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id
   WHERE p_para_anular
     AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                      WHERE a.company_id = c.company_id AND a.origen = 'automatico'
                        AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
                        AND a.origen_evento = i.evento AND a.estado <> 'anulado')
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_dependencias(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ── Una incidencia «cobro_sin_confirmar» no se descarta a mano mientras el
--    cobro siga pendiente: se cierra con la resolución aprobada (respaldo +
--    otra persona) o cuando el proveedor da un estado final.
CREATE OR REPLACE FUNCTION public.conta_incidencia_resolver(p_id uuid, p_nota text)
RETURNS TABLE (incidencia_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_i       public.conta_incidencias_conciliacion;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL OR NOT public.conta_puede_escribir('change_status') THEN
    RAISE EXCEPTION 'No autorizado para resolver incidencias de conciliación.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_nota, ''))) < 5 THEN
    RAISE EXCEPTION 'Indica cómo se resolvió (al menos 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_i FROM public.conta_incidencias_conciliacion i
   WHERE i.id = p_id AND i.company_id = v_company
     AND (i.project_id IS NULL OR public.can_access_project(i.project_id))
     FOR UPDATE;
  IF v_i.id IS NULL THEN
    RAISE EXCEPTION 'La incidencia no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  IF v_i.estado = 'resuelta' THEN
    RETURN QUERY SELECT v_i.id, v_i.estado, true;
    RETURN;
  END IF;
  IF v_i.tipo = 'cobro_sin_confirmar'
     AND EXISTS (SELECT 1 FROM public.payment_requests pr WHERE pr.id = v_i.payment_request_id AND pr.estado = 'pending') THEN
    RAISE EXCEPTION 'INCIDENCIA_COBRO_PENDIENTE: el cobro sigue pendiente. Consulta al proveedor o solicita su resolución con respaldo; no se descarta a mano.'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.conta_incidencias_conciliacion i
     SET estado = 'resuelta', resuelta_por = auth.uid(), resuelta_at = now(), nota_resolucion = btrim(p_nota)
   WHERE i.id = v_i.id;
  RETURN QUERY SELECT v_i.id, 'resuelta'::text, false;
END;
$$;
