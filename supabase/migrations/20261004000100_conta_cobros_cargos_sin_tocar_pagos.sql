-- ============================================================================
-- CORRECTIVA DE 20261004000000: LAS GARANTÍAS DE LOS COBROS DE CARGOS SIN
-- TOCAR LAS CONSTRAINTS NI LOS TRIGGERS DE `pagos`
--
-- 20261004000000 ya está aplicada (sandbox); no se reescribe.
--
-- POR QUÉ. `pagos` tiene drift declarado en constraints y triggers
-- (scripts/schema-drift/drift-conocido.json, inventario #826): producción y
-- el repositorio ya difieren ahí. 20261004000000 agregó a esos dos grupos una
-- FK, un CHECK y un trigger, así que producción, la base y el PR decían tres
-- cosas distintas y el auditor de tres vías lo cierra —a propósito— como
-- CAMBIO AMBIGUO. Resolver #826 no es de este bloque.
--
-- QUÉ. Las mismas garantías, en lugares que no son esos dos grupos:
--   · la validación de escrituras de un cobro de cargo (sólo por las RPC,
--     vínculo inmutable, empresa/proyecto/responsable del cargo, exclusividad
--     frente a cuota/registro/convenio, cobro inborrable) pasa del trigger
--     BEFORE propio a `conta_tg_pagos`, que ya dispara en INSERT, UPDATE y
--     DELETE de `pagos`. Una excepción en un trigger AFTER aborta la sentencia
--     igual que en uno BEFORE, y la validación corre antes de contabilizar;
--   · la integridad referencial pago → cargo, que daba la FK: el alta valida
--     que el cargo existe y el vínculo no cambia nunca; borrar un cargo con
--     cobros lo impide el guard del cargo (ahora también en DELETE).
--   El índice y la columna se quedan (esos grupos no tienen drift declarado).
--
-- CÓMO SE REVIERTE: restaurar conta_tg_pagos y conta_tg_cargo_cobros_guard
-- desde 20261004000000, recrear trg_pagos_cobro_cargo_guard, trg_cargo_cobros_guard
-- (sólo UPDATE), pagos_cargo_adicional_exclusivo y la FK de
-- pagos.cargo_adicional_id, y DROP FUNCTION conta_cobro_cargo_validar_escritura.
-- ============================================================================

-- ── 1. Fuera de `pagos`: el trigger propio, la FK y el CHECK ────────────────
DROP TRIGGER trg_pagos_cobro_cargo_guard ON public.pagos;
DROP FUNCTION public.conta_tg_pagos_cobro_cargo_guard();

ALTER TABLE public.pagos
  DROP CONSTRAINT pagos_cargo_adicional_exclusivo,
  DROP CONSTRAINT pagos_cargo_adicional_id_fkey;

COMMENT ON COLUMN public.pagos.cargo_adicional_id IS
  'Cargo adicional que este cobro liquida (total o parcialmente). Lo fija conta_registrar_cobro_cargo; es inmutable. Su integridad (cargo existente, exclusivo frente a cuota/registro/convenio) la valida conta_tg_pagos y el guard del cargo impide borrar un cargo con cobros.';

-- ── 2. La validación, como función que llama conta_tg_pagos ────────────────
-- Misma lógica que el trigger de 20261004000000, más la exclusividad y la
-- existencia del cargo que daban el CHECK y la FK.
CREATE OR REPLACE FUNCTION public.conta_cobro_cargo_validar_escritura(
  p_op  text,
  p_old public.pagos,
  p_new public.pagos
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_marca text := current_setting('conta.cobro_cargo_pago', true);
  v_ca    public.cargos_adicionales_unidad;
BEGIN
  IF p_op = 'DELETE' THEN
    IF p_old.cargo_adicional_id IS NOT NULL THEN
      RAISE EXCEPTION 'COBRO_CARGO_INBORRABLE: un cobro de cargo adicional es historia contable; se anula, no se borra.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  IF p_op = 'INSERT' THEN
    IF p_new.cargo_adicional_id IS NULL THEN
      RETURN;
    END IF;
    IF v_marca IS DISTINCT FROM p_new.id::text THEN
      RAISE EXCEPTION 'COBRO_CARGO_SOLO_RPC: los cobros de cargos adicionales se registran con conta_registrar_cobro_cargo.'
        USING ERRCODE = '42501';
    END IF;
    IF p_new.cuota_id IS NOT NULL OR p_new.registro_id IS NOT NULL OR p_new.convenio_id IS NOT NULL THEN
      RAISE EXCEPTION 'COBRO_CARGO_EXCLUSIVO: un cobro de cargo adicional no es a la vez de una cuota, un registro de agua o un convenio.'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_new.cargo_adicional_id;
    IF v_ca.id IS NULL
       OR p_new.project_id IS DISTINCT FROM v_ca.project_id
       OR NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_new.project_id AND pr.company_id = v_ca.company_id)
       OR p_new.cliente_id IS DISTINCT FROM v_ca.responsable_cliente_id THEN
      RAISE EXCEPTION 'COBRO_CARGO_AJENO: el cobro no coincide con la empresa, el proyecto o el responsable histórico del cargo.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  -- UPDATE
  IF p_old.cargo_adicional_id IS NULL AND p_new.cargo_adicional_id IS NULL THEN
    RETURN;
  END IF;
  IF p_new.cargo_adicional_id IS DISTINCT FROM p_old.cargo_adicional_id THEN
    RAISE EXCEPTION 'COBRO_CARGO_VINCULO_INMUTABLE: un pago no se vincula ni se desvincula de un cargo adicional después de creado.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_new.cliente_id  IS DISTINCT FROM p_old.cliente_id
     OR p_new.project_id IS DISTINCT FROM p_old.project_id
     OR p_new.monto      IS DISTINCT FROM p_old.monto
     OR p_new.metodo     IS DISTINCT FROM p_old.metodo
     OR p_new.verified_at IS DISTINCT FROM p_old.verified_at
     OR p_new.created_at IS DISTINCT FROM p_old.created_at
     OR p_new.cuota_id   IS DISTINCT FROM p_old.cuota_id
     OR p_new.registro_id IS DISTINCT FROM p_old.registro_id
     OR p_new.convenio_id IS DISTINCT FROM p_old.convenio_id THEN
    RAISE EXCEPTION 'COBRO_CARGO_INMUTABLE: responsable, proyecto, importe, método y fecha de un cobro de cargo no cambian. Anúlalo y registra otro.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (p_new.estado IS DISTINCT FROM p_old.estado
      OR p_new.deleted_at IS DISTINCT FROM p_old.deleted_at
      OR p_new.verification_status IS DISTINCT FROM p_old.verification_status)
     AND v_marca IS DISTINCT FROM p_old.id::text THEN
    RAISE EXCEPTION 'COBRO_CARGO_SOLO_RPC: un cobro de cargo adicional se anula con conta_anular_cobro_cargo (Condominios › Cargos adicionales).'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cobro_cargo_validar_escritura(text, public.pagos, public.pagos)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_cobro_cargo_validar_escritura(text, public.pagos, public.pagos) IS
  'INTERNA. Valida una escritura sobre un cobro de cargo adicional: sólo por las RPC, cargo existente del mismo proyecto/empresa y responsable histórico, exclusivo frente a cuota/registro/convenio, vínculo y datos inmutables, inborrable. La llama conta_tg_pagos.';

-- ── 3. Trigger de PAGOS: valida antes de contabilizar ───────────────────────
-- Cuerpo idéntico a 20261004000000 salvo la llamada inicial a la validación.
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
BEGIN
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

REVOKE EXECUTE ON FUNCTION public.conta_tg_pagos() FROM PUBLIC, anon, authenticated;

-- ── 4. Guard del CARGO: también en DELETE (lo que daba la FK) ───────────────
-- Cuerpo idéntico a 20261004000000 salvo la rama DELETE al principio.
CREATE OR REPLACE FUNCTION public.conta_tg_cargo_cobros_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_vivos    boolean;
  v_alguno   boolean;
  v_derivado text;
BEGIN
  v_alguno := EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = OLD.id);

  IF TG_OP = 'DELETE' THEN
    IF v_alguno THEN
      RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros registrados (historia contable); no se borra. Anúlalo si no tiene cobros vivos.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;

  v_vivos  := EXISTS (SELECT 1 FROM public.pagos p
                       WHERE p.cargo_adicional_id = OLD.id
                         AND p.deleted_at IS NULL AND p.estado <> 'rechazado');

  -- Con cobros, el cargo es el documento que respalda su aplicación: no
  -- cambia de empresa, proyecto ni unidad.
  IF v_alguno AND (NEW.company_id IS DISTINCT FROM OLD.company_id
                   OR NEW.project_id IS DISTINCT FROM OLD.project_id
                   OR NEW.unidad_id  IS DISTINCT FROM OLD.unidad_id) THEN
    RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros registrados; no cambia de empresa, proyecto ni unidad.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_vivos AND NEW.monto IS DISTINCT FROM OLD.monto THEN
    RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros vivos; su importe no cambia. Anula los cobros primero.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF NEW.estado = 'anulado' THEN
    IF v_vivos THEN
      RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros vivos; anula cada cobro antes de anular el cargo.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Cargo por tipo: «pagado»/«pendiente» es el que dan sus cobros.
  v_derivado := public.conta_cargo_estado_derivado(OLD.id, NEW.monto);
  IF v_derivado IS NOT NULL AND NEW.estado IN ('pagado','pendiente') AND NEW.estado <> v_derivado THEN
    RAISE EXCEPTION 'CARGO_ESTADO_DERIVADO: el estado de este cargo sale de sus cobros (hoy: %). Registra o anula un cobro en lugar de cambiarlo a mano.',
      v_derivado USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_cargo_cobros_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER trg_cargo_cobros_guard ON public.cargos_adicionales_unidad;
CREATE TRIGGER trg_cargo_cobros_guard
  BEFORE UPDATE OF estado, monto, company_id, project_id, unidad_id OR DELETE ON public.cargos_adicionales_unidad
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cargo_cobros_guard();
