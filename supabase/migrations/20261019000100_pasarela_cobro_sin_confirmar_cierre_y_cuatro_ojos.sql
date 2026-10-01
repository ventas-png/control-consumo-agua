-- ============================================================================
-- E8 (correctiva de 20261019000000): cuatro ojos SIN excepción para
-- resolver_cobro_en_linea y cierre trazable de «cobro_sin_confirmar».
--
-- 1. AUTOAPROBACIÓN. 20261012000000 deja que el company_owner apruebe su propia
--    solicitud confirmándolo (E1). Para resolver_cobro_en_linea (dar por
--    cobrado o no cobrado un dinero que sólo se verificó a mano) esa excepción
--    NO aplica: la aprueba otra persona, también si el solicitante es el dueño.
--    Se exige en el servidor (conta_ajuste_aprobar) y, como defensa en
--    profundidad, con una restricción (NOT VALID: no toca filas previas, sí
--    rige para las nuevas). Los demás tipos conservan sus excepciones.
--
-- 2. CIERRE DE LA INCIDENCIA. Cuando una consulta o un webhook del proveedor
--    deja el cobro resuelto (estado final: aprobado, rechazado o reembolsado, y
--    la solicitud ya no está pendiente), pasarela_registrar_estado cierra la
--    incidencia «cobro_sin_confirmar» con el evento como prueba
--    (resuelta_evento_id, sin persona: la cierra el proveedor). Idempotente: un
--    evento duplicado no la cierra dos veces ni abre otra. Un resultado
--    pendiente, «requiere acción» o un error NO la cierran. Si el resultado
--    exige otra revisión (cobro sobre una cuota anulada, reembolso…), se abre o
--    se conserva la incidencia ESPECÍFICA: sólo se cierra la de «sin
--    confirmar», porque el proveedor ya respondió. La resolución manual sigue
--    cerrando la suya con la solicitud aprobada.
--    El cron abre su incidencia con la solicitud bloqueada (FOR UPDATE ... SKIP
--    LOCKED) para no abrirla sobre un cobro que un aviso resuelve a la vez.
--
-- CÓMO SE REVIERTE: restaurar conta_ajuste_aprobar de 20261012000000,
-- pasarela_registrar_estado y reconciliar_payment_requests_pendientes de
-- 20261019000000; DROP de la restricción conta_ajustes_resolver_cobro_sin_auto,
-- de conta_incidencia_cobro_sin_confirmar_cerrar y de la columna
-- resuelta_evento_id (tras reabrir las incidencias cerradas por evento).
-- Numeración: 20261019000100, por debajo de la serie 20261020… del PR #907.
-- ============================================================================

-- ── 1. Cuatro ojos sin excepción ────────────────────────────────────────────
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_resolver_cobro_sin_auto
  CHECK (tipo <> 'resolver_cobro_en_linea' OR NOT autoaprobada) NOT VALID;

CREATE OR REPLACE FUNCTION public.conta_ajuste_aprobar(
  p_id                        uuid,
  p_nota                      text DEFAULT NULL,
  p_confirmar_autoaprobacion  boolean DEFAULT false,
  p_respaldos_revisados       uuid[] DEFAULT NULL
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean, autoaprobada boolean,
               resultado jsonb, error_ejecucion text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sol   public.conta_ajustes_solicitudes;
  v_auto  boolean := false;
  v_foto  jsonb;
  v_hay   uuid[];
  v_vistos uuid[];
BEGIN
  v_sol := public.conta_ajuste_bloquear_para_revision(p_id);

  -- Doble clic / dos sesiones: la segunda entra cuando la primera ya
  -- confirmó y ve el resultado. No ejecuta otra vez.
  IF v_sol.estado = 'ejecutada' THEN
    RETURN QUERY SELECT v_sol.id, v_sol.estado, true, v_sol.autoaprobada, v_sol.resultado, v_sol.error_ejecucion;
    RETURN;
  END IF;
  IF v_sol.estado = 'fallida' THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: la solicitud ya se aprobó y su ejecución falló (%). Usa «Reintentar» o recházala.',
      v_sol.error_ejecucion USING ERRCODE = 'check_violation';
  END IF;
  IF v_sol.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'AJUSTE_ESTADO: la solicitud está % y ya no se puede aprobar.', v_sol.estado
      USING ERRCODE = 'check_violation';
  END IF;

  -- E1: cuatro ojos. Sólo el company_owner se autoaprueba, y confirmándolo.
  IF v_sol.solicitado_por = auth.uid() THEN
    -- E8: resolver un cobro en línea a mano NUNCA se autoaprueba, ni el dueño.
    IF v_sol.tipo = 'resolver_cobro_en_linea' THEN
      RAISE EXCEPTION 'AJUSTE_AUTOAPROBACION_NO_PERMITIDA: la resolución manual de un cobro en línea la aprueba otra persona, también si eres el dueño de la empresa.'
        USING ERRCODE = '42501';
    END IF;
    IF public.current_user_role() IS DISTINCT FROM 'company_owner' THEN
      RAISE EXCEPTION 'AJUSTE_AUTOAPROBACION_NO_PERMITIDA: quien solicita un ajuste no lo aprueba; debe aprobarlo otra persona con permiso.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT COALESCE(p_confirmar_autoaprobacion, false) THEN
      RAISE EXCEPTION 'AJUSTE_AUTOAPROBACION_SIN_CONFIRMAR: vas a aprobar tu propia solicitud. Confírmalo explícitamente; quedará registrado como autoaprobación.'
        USING ERRCODE = '42501';
    END IF;
    v_auto := true;
  END IF;

  -- RESPALDOS: se aprueba lo que se revisó. Si hay archivos, quien aprueba
  -- declara cuáles vio; si difieren de los registrados (llegó uno después
  -- de abrir la solicitud) o alguno cambió en storage, no se aprueba.
  SELECT COALESCE(array_agg(r.id ORDER BY r.id), '{}') INTO v_hay
    FROM public.conta_ajustes_respaldos r WHERE r.solicitud_id = v_sol.id;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_vistos
    FROM unnest(COALESCE(p_respaldos_revisados, '{}'::uuid[])) x;
  IF cardinality(v_hay) > 0 AND p_respaldos_revisados IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDOS_SIN_REVISAR: la solicitud tiene % respaldo(s); ábrelos e indica cuáles revisaste.',
      cardinality(v_hay) USING ERRCODE = 'check_violation';
  END IF;
  IF p_respaldos_revisados IS NOT NULL AND v_vistos IS DISTINCT FROM v_hay THEN
    RAISE EXCEPTION 'AJUSTE_RESPALDOS_CAMBIARON: los respaldos de la solicitud no son los que revisaste (hay %, revisaste %). Vuelve a abrirla.',
      cardinality(v_hay), cardinality(v_vistos) USING ERRCODE = 'check_violation';
  END IF;
  v_foto := public.conta_ajuste_respaldos_foto(v_sol.id);

  UPDATE public.conta_ajustes_solicitudes s
     SET revisado_por = auth.uid(), revisado_at = now(),
         motivo_revision = NULLIF(btrim(COALESCE(p_nota, '')), ''),
         autoaprobada = v_auto, respaldos_revisados = v_foto, updated_at = now()
   WHERE s.id = v_sol.id
  RETURNING * INTO v_sol;
  PERFORM public.conta_ajuste_evento(v_sol, CASE WHEN v_auto THEN 'autoaprobada' ELSE 'aprobada' END,
    'pendiente', 'pendiente', NULLIF(btrim(COALESCE(p_nota, '')), ''));

  v_sol := public.conta_ajuste_ejecutar(v_sol, 'aprobar');
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false, v_sol.autoaprobada, v_sol.resultado, v_sol.error_ejecucion;
END;
$$;

COMMENT ON FUNCTION public.conta_ajuste_aprobar(uuid, text, boolean, uuid[]) IS
  'Aprueba una solicitud de ajuste y la ejecuta en la misma transacción, revalidando documento, período y saldo con el documento bloqueado. Quien solicita no aprueba (E1); sólo el company_owner puede autoaprobarse, con p_confirmar_autoaprobacion = true, y queda marcado, SALVO resolver_cobro_en_linea (E8): esa la aprueba siempre otra persona. Con respaldos, p_respaldos_revisados debe listar exactamente los registrados y ninguno puede haber cambiado. Repetirla devuelve el resultado sin ejecutar otra vez. Si la ejecución falla no queda nada escrito y la solicitud queda «fallida».';

-- ── 2. Cierre trazable de «cobro_sin_confirmar» ─────────────────────────────
ALTER TABLE public.conta_incidencias_conciliacion
  ADD COLUMN resuelta_evento_id uuid REFERENCES public.pasarela_eventos(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.conta_incidencias_conciliacion.resuelta_evento_id IS
  'Evento del proveedor (consulta o webhook) que resolvió el cobro y cerró la incidencia sin intervención de una persona (E8).';
ALTER TABLE public.conta_incidencias_conciliacion DROP CONSTRAINT conta_incidencias_resolucion;
ALTER TABLE public.conta_incidencias_conciliacion ADD CONSTRAINT conta_incidencias_resolucion CHECK (
  (estado = 'abierta' AND resuelta_por IS NULL AND resuelta_at IS NULL AND resuelta_evento_id IS NULL)
  OR (estado = 'resuelta' AND resuelta_at IS NOT NULL
      AND (resuelta_por IS NOT NULL OR resuelta_evento_id IS NOT NULL)
      AND length(btrim(COALESCE(nota_resolucion, ''))) >= 5));

CREATE FUNCTION public.conta_incidencia_cobro_sin_confirmar_cerrar(
  p_payment_request_id uuid,
  p_evento_id          uuid,
  p_provider           text,
  p_clave_evento       text,
  p_estado_cobro       text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_n integer;
BEGIN
  PERFORM public.pasarela_exigir_service_role();
  UPDATE public.conta_incidencias_conciliacion i
     SET estado = 'resuelta', resuelta_at = now(), resuelta_evento_id = p_evento_id,
         nota_resolucion = 'Resuelta por el proveedor (' || p_provider || ', evento ' || p_clave_evento
           || '): el cobro quedó «' || p_estado_cobro || '»'
           || CASE WHEN EXISTS (SELECT 1 FROM public.conta_incidencias_conciliacion x
                                 WHERE x.payment_request_id = p_payment_request_id
                                   AND x.tipo <> 'cobro_sin_confirmar' AND x.estado = 'abierta')
                   THEN '; queda abierta la incidencia específica que exige revisión.'
                   ELSE '.' END
   WHERE i.payment_request_id = p_payment_request_id AND i.tipo = 'cobro_sin_confirmar' AND i.estado = 'abierta';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.conta_incidencia_cobro_sin_confirmar_cerrar(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_incidencia_cobro_sin_confirmar_cerrar(uuid, uuid, text, text, text) TO service_role;
COMMENT ON FUNCTION public.conta_incidencia_cobro_sin_confirmar_cerrar(uuid, uuid, text, text, text) IS
  'E8: cierra (idempotente) la incidencia cobro_sin_confirmar de un cobro que el proveedor resolvió, con el evento como prueba. Sólo la llama pasarela_registrar_estado.';

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
  v_dup_ev uuid;
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
  SELECT e.id INTO v_dup_ev FROM public.pasarela_eventos e
   WHERE e.provider = v_pr.provider AND e.clave_evento = v_clave;
  IF v_dup_ev IS NOT NULL THEN
    IF v_pr.estado = 'succeeded' THEN
      v_conc := public.conciliar_pago_externo(v_pr.id, NULL, NULL);
    END IF;
    -- Idempotente: si el evento ya resolvió el cobro y la incidencia sigue
    -- abierta, se cierra aquí (cierra una sola vez; repetir no hace nada).
    IF p_origen <> 'manual' AND p_estado IN ('aprobado','rechazado','reembolsado') AND v_pr.estado <> 'pending' THEN
      PERFORM public.conta_incidencia_cobro_sin_confirmar_cerrar(v_pr.id, v_dup_ev, v_pr.provider, v_clave, v_pr.estado);
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

  -- E8: el proveedor dio un estado FINAL y el cobro ya no está pendiente →
  -- la incidencia «cobro_sin_confirmar» se cierra con el evento como prueba.
  -- Pendiente, requiere acción o error no la cierran. La incidencia
  -- específica (cuota anulada, reembolso…) se abre/conserva abajo. La
  -- resolución manual cierra la suya (con su solicitud) en la ejecución.
  IF p_origen <> 'manual' AND p_estado IN ('aprobado','rechazado','reembolsado') AND v_nuevo <> 'pending' THEN
    PERFORM public.conta_incidencia_cobro_sin_confirmar_cerrar(v_pr.id, v_ev, v_pr.provider, v_clave, v_nuevo);
  END IF;

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
     -- Con la solicitud bloqueada: si un aviso la resuelve mientras tanto, no
     -- se abre una incidencia sobre un cobro ya resuelto.
     FOR UPDATE OF pr SKIP LOCKED
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_incidencias = ROW_COUNT;

  RAISE NOTICE 'reconciliar_payment_requests: % consultas enviadas, % sin referencia, % incidencias nuevas',
    v_enviados, v_sin_ref, v_incidencias;
  RETURN v_enviados;
END $$;

REVOKE EXECUTE ON FUNCTION public.reconciliar_payment_requests_pendientes() FROM PUBLIC, anon, authenticated;
