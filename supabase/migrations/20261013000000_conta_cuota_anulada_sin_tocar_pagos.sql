-- ============================================================================
-- CORRECTIVA DE 20261012000000: LA GUARDA «COBRO SOBRE CUOTA ANULADA» SIN
-- TOCAR LOS TRIGGERS DE `pagos`
--
-- 20261012000000 ya se aplicó en la rama de previsualización; no se reescribe.
--
-- POR QUÉ. `pagos` tiene drift declarado en sus triggers
-- (scripts/schema-drift/drift-conocido.json, inventario #826): producción y
-- el repositorio ya difieren ahí. 20261012000000 agregó trg_pago_cuota_anulada
-- a ese grupo, así que producción, la base y el PR decían tres cosas distintas
-- y el auditor de tres vías lo cierra —a propósito— como CAMBIO AMBIGUO.
-- Mismo caso y mismo criterio que 20261004000100.
--
-- QUÉ. La misma garantía (un cobro vivo nuevo, reactivado o que cambia de
-- cuota no entra en una cuota anulada; la cuota se bloquea FOR SHARE y así se
-- serializa con la aprobación de la anulación) la llama conta_tg_pagos, que ya
-- dispara en INSERT y UPDATE de pagos. Una excepción en un trigger AFTER aborta
-- la sentencia igual que en uno BEFORE.
--
-- CÓMO SE REVIERTE: restaurar conta_tg_pagos de 20261007000000, DROP FUNCTION
-- conta_pago_cuota_no_anulada y recrear trg_pago_cuota_anulada de
-- 20261012000000.
-- ============================================================================

DROP TRIGGER trg_pago_cuota_anulada ON public.pagos;
DROP FUNCTION public.conta_tg_pago_cuota_anulada();

-- Un cobro vivo NUEVO (o que vuelve a estar vivo, o que cambia de cuota)
-- sobre una cuota anulada. FOR SHARE: espera a una anulación en curso (que
-- tiene la cuota FOR UPDATE) y la ve; o la anulación espera a este cobro y
-- lo encuentra como dependencia. La llama conta_tg_pagos: `pagos` tiene
-- drift declarado en sus triggers (drift-conocido.json, #826), así que no se
-- agrega un trigger propio (mismo criterio que 20261004000100).
CREATE FUNCTION public.conta_pago_cuota_no_anulada(p_op text, p_old public.pagos, p_new public.pagos)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  IF p_new.cuota_id IS NULL OR p_new.deleted_at IS NOT NULL OR p_new.estado = 'rechazado' THEN
    RETURN;
  END IF;
  IF p_op = 'UPDATE'
     AND p_new.cuota_id IS NOT DISTINCT FROM p_old.cuota_id
     AND p_old.deleted_at IS NULL AND p_old.estado IS DISTINCT FROM 'rechazado' THEN
    RETURN;
  END IF;
  SELECT c.cuota_estado INTO v_estado FROM public.cuotas_condominio c WHERE c.id = p_new.cuota_id FOR SHARE;
  IF v_estado = 'anulada' THEN
    RAISE EXCEPTION 'COBRO_CUOTA_ANULADA: la cuota está anulada; no admite cobros.' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_pago_cuota_no_anulada(text, public.pagos, public.pagos) FROM PUBLIC, anon, authenticated;

-- Cuerpo IDÉNTICO a 20261007000000 salvo el bloque «CUOTA ANULADA» inicial.
CREATE OR REPLACE FUNCTION public.conta_tg_pagos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_project    uuid;
  v_company    uuid;
  v_moneda     text;
  v_metodo     text;
  v_contra     text;
  v_es_cuota   boolean;
  v_reg_estado text;
  v_anticipo   boolean;
BEGIN
  -- CUOTA ANULADA (20261012000000): un cobro vivo nuevo, que vuelve a estar
  -- vivo o que cambia de cuota no entra en una cuota anulada. Aquí y no en
  -- un trigger propio: `pagos` tiene drift declarado en sus triggers (#826).
  IF TG_OP <> 'DELETE' AND NEW.cuota_id IS NOT NULL THEN
    PERFORM public.conta_pago_cuota_no_anulada(
      TG_OP, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD END, NEW);
  END IF;

  -- SALDOS A FAVOR (20261007000000). Un anticipo sólo se escribe por sus RPC
  -- y sus datos no cambian; un cobro cuyo saldo a favor tiene aplicaciones
  -- VIVAS no se rechaza, anula ni borra: primero se revierten las
  -- aplicaciones (así ninguna queda sin respaldo). Lanzar aquí aborta la
  -- sentencia entera, como en un trigger BEFORE.
  v_anticipo := EXISTS (SELECT 1 FROM public.conta_anticipos an
                         WHERE an.pago_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  IF v_anticipo THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'ANTICIPO_INBORRABLE: un anticipo es historia contable; se anula con conta_anular_anticipo, no se borra.'
        USING ERRCODE = 'check_violation';
    ELSIF TG_OP = 'INSERT' THEN
      IF current_setting('conta.anticipo_pago', true) IS DISTINCT FROM NEW.id::text THEN
        RAISE EXCEPTION 'ANTICIPO_SOLO_RPC: los anticipos se registran con conta_registrar_anticipo.' USING ERRCODE = '42501';
      END IF;
      IF NEW.cuota_id IS NOT NULL OR NEW.registro_id IS NOT NULL OR NEW.convenio_id IS NOT NULL
         OR NEW.cargo_adicional_id IS NOT NULL THEN
        RAISE EXCEPTION 'ANTICIPO_EXCLUSIVO: un anticipo no se vincula a ningún documento.' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
         OR NEW.monto IS DISTINCT FROM OLD.monto OR NEW.metodo IS DISTINCT FROM OLD.metodo
         OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
         OR NEW.cuota_id IS DISTINCT FROM OLD.cuota_id OR NEW.registro_id IS DISTINCT FROM OLD.registro_id
         OR NEW.convenio_id IS DISTINCT FROM OLD.convenio_id
         OR NEW.cargo_adicional_id IS DISTINCT FROM OLD.cargo_adicional_id THEN
        RAISE EXCEPTION 'ANTICIPO_INMUTABLE: titular, proyecto, importe, método y fecha de un anticipo no cambian. Anúlalo y registra otro.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW.estado IS DISTINCT FROM OLD.estado OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
          OR NEW.verification_status IS DISTINCT FROM OLD.verification_status)
         AND current_setting('conta.anticipo_pago', true) IS DISTINCT FROM OLD.id::text THEN
        RAISE EXCEPTION 'ANTICIPO_SOLO_RPC: un anticipo se anula con conta_anular_anticipo (Contabilidad › Estado de cuenta › Saldos a favor).'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF (TG_OP = 'DELETE'
      OR (TG_OP = 'UPDATE'
          AND ((NEW.estado = 'rechazado' AND OLD.estado IS DISTINCT FROM 'rechazado')
               OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL))))
     AND EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                  WHERE x.pago_id = OLD.id AND public.conta_sf_asiento_vivo(x.asiento_id)) THEN
    RAISE EXCEPTION 'COBRO_SALDO_FAVOR_APLICADO: el saldo a favor de este cobro ya se aplicó a otros documentos. Revierte esas aplicaciones (Contabilidad › Estado de cuenta › Saldos a favor) y después rechaza o anula el cobro.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cobros de cargos adicionales (20261004000100): la validación que antes
  -- hacía un trigger BEFORE propio. Lanzar aquí aborta la sentencia igual.
  IF (TG_OP <> 'INSERT' AND OLD.cargo_adicional_id IS NOT NULL)
     OR (TG_OP <> 'DELETE' AND NEW.cargo_adicional_id IS NOT NULL) THEN
    PERFORM public.conta_cobro_cargo_validar_escritura(
      TG_OP,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW END);
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Hard delete de un pago contabilizado → reverso (company vía proyecto).
    v_project := COALESCE(OLD.project_id, (SELECT project_id FROM public.clientes WHERE id = OLD.cliente_id));
    SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
    IF v_company IS NOT NULL THEN
      PERFORM public.conta_reversar_automatico(v_company, 'pagos', OLD.id,
        'pago_contabilizado', 'Pago eliminado');
    END IF;
    RETURN OLD;
  END IF;

  v_project := COALESCE(NEW.project_id, (SELECT project_id FROM public.clientes WHERE id = NEW.cliente_id));
  SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  -- Evidencia del rechazo (20261005000000). La hora es la del servidor y el
  -- actor el de la sesión: nada de lo que manda el cliente. Sólo la
  -- TRANSICIÓN escribe: repetir un rechazo no deja otra fila.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'rechazado' AND NEW.estado = 'rechazado'
     AND (NEW.verification_notes IS DISTINCT FROM OLD.verification_notes
          OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
    RAISE EXCEPTION 'PAGO_RECHAZADO_INMUTABLE: el cobro ya está rechazado; su motivo y sus datos de revisión no se reescriben.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado = 'rechazado'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'rechazado') THEN
    INSERT INTO public.pagos_rechazo_eventos
      (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, motivo, actor,
       verified_at_anterior)
    VALUES
      (NEW.id, v_company, v_project, 'rechazo',
       CASE WHEN TG_OP = 'INSERT' THEN 'alta' ELSE COALESCE(OLD.estado, '-') END,
       'rechazado', NULLIF(btrim(COALESCE(NEW.verification_notes, '')), ''), auth.uid(),
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.verified_at END);
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'rechazado'
        AND NEW.estado IS DISTINCT FROM 'rechazado' THEN
    INSERT INTO public.pagos_rechazo_eventos
      (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, motivo, actor,
       verified_at_anterior)
    VALUES
      (NEW.id, v_company, v_project, 'reactivacion', 'rechazado', COALESCE(NEW.estado, '-'),
       NULL, auth.uid(), OLD.verified_at);
  END IF;

  -- Reverso: rechazado o soft-delete después de contabilizado.
  IF TG_OP = 'UPDATE'
     AND OLD.estado IN ('verificado','aplicado')
     AND (NEW.estado = 'rechazado'
          OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    PERFORM public.conta_reversar_automatico(v_company, 'pagos', NEW.id,
      'pago_contabilizado',
      CASE WHEN NEW.estado = 'rechazado' THEN 'Pago rechazado' ELSE 'Pago eliminado' END);
    -- Cobro de un cargo adicional (20261004000000): el reverso reabre el saldo
    -- y el estado del cargo se vuelve a derivar de sus cobros vivos.
    IF NEW.cargo_adicional_id IS NOT NULL THEN
      PERFORM public.conta_cargo_sincronizar_estado(NEW.cargo_adicional_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Contabilizar: primera transición a verificado/aplicado (pago vivo).
  IF NEW.estado IN ('verificado','aplicado')
     AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('verificado','aplicado'))
     AND COALESCE(NEW.monto, 0) > 0 THEN

    -- ANTICIPO sin deuda (20261007000000): a la cuenta de anticipos con su
    -- titular; nunca a ingreso_otros.
    IF v_anticipo THEN
      PERFORM public.conta_contabilizar_anticipo_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    -- Cobro de un CARGO ADICIONAL (20261004000000): se aplica contra la CxC
    -- de su devengo, nunca el mapeo general ni ingreso directo.
    IF NEW.cargo_adicional_id IS NOT NULL THEN
      PERFORM public.conta_contabilizar_cobro_cargo_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    -- Cobro de una cuota contabilizada por tipo (20261002000100): NUNCA el
    -- mapeo general. Reparto mora→principal contra la cuenta y dimensiones de
    -- cada devengo, o pendiente visible si falta alguno.
    IF public.conta_cobro_cuota_por_tipo(NEW.id) IS NOT NULL THEN
      PERFORM public.conta_contabilizar_cobro_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    v_metodo := CASE NEW.metodo
      WHEN 'efectivo'        THEN 'metodo_efectivo'
      WHEN 'transferencia'   THEN 'metodo_transferencia'
      WHEN 'deposito'        THEN 'metodo_deposito'
      WHEN 'cheque'          THEN 'metodo_cheque'
      WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
      WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
      WHEN 'paypal'          THEN 'metodo_pasarela'
      ELSE 'metodo_otro'
    END;

    -- Contrapartida: CxC si el documento origen ya devengó; ingreso directo si no.
    v_es_cuota := EXISTS (SELECT 1 FROM public.cuotas_condominio WHERE pago_id = NEW.id);
    IF NEW.registro_id IS NOT NULL THEN
      SELECT factura_estado INTO v_reg_estado FROM public.registros WHERE id = NEW.registro_id;
      v_contra := CASE WHEN v_reg_estado IN ('emitida','vencida','pagada')
                       THEN 'cxc_agua' ELSE 'ingreso_agua' END;
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    ELSIF v_es_cuota THEN
      v_contra := 'cxc_cuotas';
      SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
      FROM public.projects WHERE id = v_project;
    ELSE
      v_contra := 'ingreso_otros';
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    END IF;

    PERFORM public.conta_generar_asiento(
      v_company, v_project, 'pagos', NEW.id, 'pago_contabilizado',
      COALESCE(NEW.verified_at::date, CURRENT_DATE),
      'Pago ' || NEW.metodo || COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
      'ingreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_metodo, 'debe', NEW.monto),
        jsonb_build_object('evento', v_contra, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;
