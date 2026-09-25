-- ============================================================================
-- CONTABILIDAD (4): COBROS DE CARGOS ADICIONALES
--
-- 20261002000000..20261003000200 ya están aplicadas: no se reescriben.
--
-- QUÉ HABÍA. Un cargo adicional por tipo devenga al emitirse (CxC contra
-- ingreso, con auxiliar, unidad y tipo de cargo). Su «pago» era sólo
-- `estado = 'pagado'`: ningún cobro, ningún asiento, y el estado de cuenta lo
-- marcaba «cobro_sin_vinculo» porque no había nada que acreditar.
--
-- QUÉ HAY AHORA.
--   · VÍNCULO EXPLÍCITO: `pagos.cargo_adicional_id`. Se reutilizan `pagos`
--     (el cobro), `conta_cobro_aplicaciones` (cuánto de cada cobro redujo qué
--     devengo) y `conta_intentos_contabilizacion` (pendientes y su motivo).
--   · ALTA en back-office: `conta_registrar_cobro_cargo`. Crea el cobro ya
--     verificado; empresa, proyecto, unidad y responsable HISTÓRICO salen del
--     cargo, en servidor. Varios cobros y cobros parciales por cargo.
--   · CONTABILIZACIÓN: cargo a la cuenta del método de pago, abono a la CxC y
--     dimensiones de la línea de cargo del DEVENGO ORIGINAL. No hay códigos
--     contables fijos ni se reconoce ingreso otra vez.
--   · PENDIENTES VISIBLES, sin inventar nada: devengo sin publicar
--     (configuración o responsable faltante, borrador), cobro anterior
--     pendiente, excedente sobre el saldo, cuenta del método sin configurar.
--     Un excedente NO se reparte entre otros documentos ni se vuelve anticipo:
--     el cobro queda pendiente con el motivo.
--   · ESTADO DERIVADO: un cargo por tipo está «pagado» cuando sus cobros vivos
--     cubren el devengo, y vuelve a «pendiente» si un reverso reabre saldo. No
--     se marca a mano. Los cargos que ya figuraban «pagados» sin cobro no se
--     tocan y no admiten cobros (no se inventan aplicaciones).
--   · ANULACIÓN DE UN COBRO: `conta_anular_cobro_cargo` lo rechaza con motivo;
--     su asiento se reversa, la aplicación queda como evidencia y deja de
--     contar. Nada se borra: un cobro de cargo no admite DELETE.
--   · El cargo no se anula ni cambia de importe con cobros vivos.
--
-- ORDEN ÚNICO DE BLOQUEOS (el de las cuotas, con el cargo en lugar de la cuota):
--     fila del cargo  →  filas de sus pagos (por id)  →  candado de cobros
--   Por eso las escrituras de un cobro de cargo (alta, cambio de estado,
--   borrado lógico) sólo entran por las RPC, que toman primero el cargo. Un
--   UPDATE directo sobre `pagos` tomaría la fila del pago antes que la del
--   cargo y podría cruzarse con un reproceso: el guard lo rechaza.
--
-- CÓMO SE REVIERTE (en este orden):
--   restaurar conta_tg_pagos, conta_reprocesar_un_cobro y conta_cargos_pendientes
--   desde 20261002000100; conta_reprocesar_cargo desde 20261002000200;
--   conta_ec_fuera_de_saldo, conta_ec_limitaciones y conta_estado_cuenta desde
--   20261003000200; conta_estado_cuenta_conciliacion desde 20261003000100;
--   DROP FUNCTION de conta_cargo_cobros, conta_cargos_cobro_resumen,
--   conta_anular_cobro_cargo, conta_registrar_cobro_cargo,
--   conta_contabilizar_cobro_cargo_seguro, conta_contabilizar_cobro_cargo_interno,
--   conta_cargo_sincronizar_estado, conta_cargo_estado_derivado,
--   conta_cargo_saldo_cobro;
--   DROP TRIGGER trg_cargo_cobros_guard, trg_pagos_cobro_cargo_guard y sus
--   funciones; y, sólo si no quedan cobros de cargos (son historia contable):
--   restaurar el CHECK de evento y NOT NULL de conta_cobro_aplicaciones.cuota_id,
--   DROP COLUMN conta_cobro_aplicaciones.cargo_adicional_id y
--   DROP COLUMN pagos.cargo_adicional_id.
-- ============================================================================

-- ── 1. El vínculo: un cobro liquida (total o parcialmente) UN cargo ──────────
ALTER TABLE public.pagos
  ADD COLUMN cargo_adicional_id uuid
    REFERENCES public.cargos_adicionales_unidad(id) ON DELETE RESTRICT;

-- Un cobro de cargo no es a la vez de agua, de cuota ni de convenio: no se
-- reparte un pago entre documentos.
ALTER TABLE public.pagos
  ADD CONSTRAINT pagos_cargo_adicional_exclusivo CHECK (
    cargo_adicional_id IS NULL
    OR (cuota_id IS NULL AND registro_id IS NULL AND convenio_id IS NULL));

CREATE INDEX idx_pagos_cargo_adicional ON public.pagos(cargo_adicional_id)
  WHERE cargo_adicional_id IS NOT NULL;

COMMENT ON COLUMN public.pagos.cargo_adicional_id IS
  'Cargo adicional que este cobro liquida (total o parcialmente). Lo fija conta_registrar_cobro_cargo; es inmutable.';

-- ── 2. Aplicaciones: también de cargos adicionales ──────────────────────────
ALTER TABLE public.conta_cobro_aplicaciones
  ALTER COLUMN cuota_id DROP NOT NULL,
  ADD COLUMN cargo_adicional_id uuid
    REFERENCES public.cargos_adicionales_unidad(id) ON DELETE RESTRICT,
  DROP CONSTRAINT conta_cobro_aplicaciones_evento_valido,
  ADD CONSTRAINT conta_cobro_aplicaciones_evento_valido CHECK (
    (cuota_id IS NOT NULL AND cargo_adicional_id IS NULL
       AND evento IN ('cuota_emitida','cuota_mora'))
    OR (cargo_adicional_id IS NOT NULL AND cuota_id IS NULL
       AND evento = 'cargo_adicional_emitido'));

CREATE INDEX idx_conta_cobro_aplicaciones_cargo ON public.conta_cobro_aplicaciones(cargo_adicional_id)
  WHERE cargo_adicional_id IS NOT NULL;

-- Doble aplicación imposible por construcción: un cobro de cargo tiene a lo
-- sumo UNA aplicación en toda su vida (un asiento reversado no se recrea).
CREATE UNIQUE INDEX uq_conta_cobro_aplicaciones_pago_cargo
  ON public.conta_cobro_aplicaciones(pago_id)
  WHERE cargo_adicional_id IS NOT NULL;

COMMENT ON TABLE public.conta_cobro_aplicaciones IS
  'Reparto de cada cobro contabilizado: de una cuota por tipo entre principal (cuota_emitida) y mora (cuota_mora), o de un cargo adicional contra su devengo (cargo_adicional_emitido). Sólo la escriben las funciones de contabilización de cobros; cuenta sólo si su asiento sigue vivo y nunca se borra al reversar.';

-- ── 3. Saldo de un cargo para sus cobros (INTERNA) ──────────────────────────
-- El devengo VIVO (su línea de cargo: cuenta, dimensiones, importe y estado
-- del asiento) y lo ya aplicado por cobros con asiento vivo.
CREATE OR REPLACE FUNCTION public.conta_cargo_saldo_cobro(
  p_cargo_id    uuid,
  p_excluir_pago uuid DEFAULT NULL
)
RETURNS TABLE (
  devengo_asiento_id  uuid,
  devengo_estado      text,
  devengo_monto       numeric,
  cuenta_id           uuid,
  auxiliar_cliente_id uuid,
  unidad_id           uuid,
  tipo_cargo          text,
  aplicado            numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.asiento_id, d.estado, d.debe, d.cuenta_id, d.auxiliar_cliente_id, d.unidad_id, d.tipo_cargo,
         COALESCE((
           SELECT sum(ap.monto)
             FROM public.conta_cobro_aplicaciones ap
             JOIN public.conta_asientos a ON a.id = ap.asiento_id
            WHERE ap.cargo_adicional_id = p_cargo_id
              AND (p_excluir_pago IS NULL OR ap.pago_id <> p_excluir_pago)
              AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL), 0)::numeric(14,2)
    FROM (SELECT 1) uno
    LEFT JOIN LATERAL (
      SELECT a.id AS asiento_id, a.estado, l.debe, l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo
        FROM public.cargos_adicionales_unidad ca
        JOIN public.conta_asientos a
          ON a.company_id = ca.company_id AND a.origen = 'automatico'
         AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = ca.id
         AND a.origen_evento = 'cargo_adicional_emitido'
         AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
        JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
       WHERE ca.id = p_cargo_id
       ORDER BY a.created_at DESC, l.orden
       LIMIT 1
    ) d ON true
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_saldo_cobro(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_cargo_saldo_cobro(uuid, uuid) IS
  'INTERNA. Devengo vivo de un cargo adicional (línea de CxC con sus dimensiones) y lo aplicado por sus cobros con asiento vivo.';

-- ¿«pagado» o «pendiente»? Derivado de los cobros vivos; NULL si el cargo no
-- es por tipo (camino histórico: su estado sigue siendo manual).
CREATE OR REPLACE FUNCTION public.conta_cargo_estado_derivado(p_cargo_id uuid, p_monto numeric DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = p_cargo_id)
      THEN NULL
    WHEN s.aplicado > 0
     AND s.aplicado >= COALESCE(s.devengo_monto, p_monto,
                                (SELECT ca.monto FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_cargo_id))
      THEN 'pagado'
    ELSE 'pendiente'
  END
  FROM public.conta_cargo_saldo_cobro(p_cargo_id) s
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_estado_derivado(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- Aplica el estado derivado. Sólo a cargos con cobros vinculados: un cargo
-- «pagado» a mano antes de esta migración, sin cobros, no se toca.
CREATE OR REPLACE FUNCTION public.conta_cargo_sincronizar_estado(p_cargo_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_derivado text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = p_cargo_id) THEN
    RETURN;
  END IF;
  v_derivado := public.conta_cargo_estado_derivado(p_cargo_id);
  IF v_derivado IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.cargos_adicionales_unidad ca
     SET estado = v_derivado
   WHERE ca.id = p_cargo_id
     AND ca.estado IN ('pendiente','pagado')
     AND ca.estado IS DISTINCT FROM v_derivado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_sincronizar_estado(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. Guard del CARGO: estado derivado, anulación e importe ────────────────
CREATE OR REPLACE FUNCTION public.conta_tg_cargo_cobros_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_vivos    boolean;
  v_alguno   boolean;
  v_derivado text;
BEGIN
  v_alguno := EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = OLD.id);
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

CREATE TRIGGER trg_cargo_cobros_guard
  BEFORE UPDATE OF estado, monto, company_id, project_id, unidad_id ON public.cargos_adicionales_unidad
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cargo_cobros_guard();

-- ── 5. Guard del COBRO: sólo por las RPC, inmutable, inborrable ─────────────
-- Las RPC dejan en la transacción el id del pago que están escribiendo
-- (`conta.cobro_cargo_pago`); una escritura sin esa marca no pasó por el
-- bloqueo del cargo ni por sus validaciones.
CREATE OR REPLACE FUNCTION public.conta_tg_pagos_cobro_cargo_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_marca text := current_setting('conta.cobro_cargo_pago', true);
  v_ca    public.cargos_adicionales_unidad;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.cargo_adicional_id IS NOT NULL THEN
      RAISE EXCEPTION 'COBRO_CARGO_INBORRABLE: un cobro de cargo adicional es historia contable; se anula, no se borra.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.cargo_adicional_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF v_marca IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'COBRO_CARGO_SOLO_RPC: los cobros de cargos adicionales se registran con conta_registrar_cobro_cargo.'
        USING ERRCODE = '42501';
    END IF;
    -- Defensa en profundidad: la RPC ya lo resolvió desde el cargo.
    SELECT * INTO v_ca FROM public.cargos_adicionales_unidad ca WHERE ca.id = NEW.cargo_adicional_id;
    IF v_ca.id IS NULL
       OR NEW.project_id IS DISTINCT FROM v_ca.project_id
       OR NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = NEW.project_id AND pr.company_id = v_ca.company_id)
       OR NEW.cliente_id IS DISTINCT FROM v_ca.responsable_cliente_id THEN
      RAISE EXCEPTION 'COBRO_CARGO_AJENO: el cobro no coincide con la empresa, el proyecto o el responsable histórico del cargo.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.cargo_adicional_id IS NULL AND NEW.cargo_adicional_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.cargo_adicional_id IS DISTINCT FROM OLD.cargo_adicional_id THEN
    RAISE EXCEPTION 'COBRO_CARGO_VINCULO_INMUTABLE: un pago no se vincula ni se desvincula de un cargo adicional después de creado.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.cliente_id  IS DISTINCT FROM OLD.cliente_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.monto      IS DISTINCT FROM OLD.monto
     OR NEW.metodo     IS DISTINCT FROM OLD.metodo
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.cuota_id   IS DISTINCT FROM OLD.cuota_id
     OR NEW.registro_id IS DISTINCT FROM OLD.registro_id
     OR NEW.convenio_id IS DISTINCT FROM OLD.convenio_id THEN
    RAISE EXCEPTION 'COBRO_CARGO_INMUTABLE: responsable, proyecto, importe, método y fecha de un cobro de cargo no cambian. Anúlalo y registra otro.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.estado IS DISTINCT FROM OLD.estado
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.verification_status IS DISTINCT FROM OLD.verification_status)
     AND v_marca IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION 'COBRO_CARGO_SOLO_RPC: un cobro de cargo adicional se anula con conta_anular_cobro_cargo (Condominios › Cargos adicionales).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_pagos_cobro_cargo_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_pagos_cobro_cargo_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_pagos_cobro_cargo_guard();

-- ── 6. Contabilizar un cobro de cargo (INTERNA) ─────────────────────────────
-- Misma estructura que el cobro de cuota (20261002000200): bloquea y revalida
-- el pago, candado por cargo, idempotente, primer motivo manda.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cobro_cargo_interno(
  p_pago_id uuid,
  p_disparo text
)
RETURNS TABLE (
  resultado  text,
  codigo     text,
  motivo     text,
  asiento_id uuid,
  intento_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pago     public.pagos;
  v_cargo    public.cargos_adicionales_unidad;
  v_ts       timestamptz;
  v_asiento  uuid;
  v_intento  uuid;
  v_codigo   text;
  v_motivo   text;
  v_s        record;
  v_saldo    numeric(14,2);
  v_dev_i    record;
  v_metodo   text;
  v_moneda   text;
BEGIN
  IF p_disparo NOT IN ('cobro','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_cargo_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_inexistente'::text,
      'El cobro ya no existe: no se contabiliza.'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  IF v_pago.cargo_adicional_id IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_cargo_interno: el pago % no es de un cargo adicional', p_pago_id
      USING ERRCODE = '22023';
  END IF;

  -- CANDADO POR CARGO, antes de leer saldos.
  PERFORM pg_advisory_xact_lock(hashtext('conta_cobro_cargo'), hashtext(v_pago.cargo_adicional_id::text));

  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_pago.cargo_adicional_id;
  v_ts := COALESCE(v_pago.verified_at, v_pago.created_at, now());

  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'documento_anulado',
      'El cobro fue anulado o eliminado antes de contabilizarse: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_anulado'::text,
      'El cobro fue anulado o eliminado antes de contabilizarse: no se contabiliza.'::text, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- Idempotencia: ya tiene asiento vivo.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_cargo.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
     AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- Un asiento reversado no se recrea: eso lo decide una persona.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_cargo.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'asiento_reversado',
      'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.', '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'bloqueada'::text, 'asiento_reversado'::text,
      'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.'::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- ── Diagnóstico, en orden: el primer motivo manda ────────────────────────
  -- a) El cargo dejó de estar vigente (no debería: no se anula con cobros vivos).
  IF v_cargo.estado = 'anulado' THEN
    v_codigo := 'documento_anulado';
    v_motivo := 'El cargo está anulado: su cobro no se contabiliza. Anula el cobro.';
  END IF;

  -- b) Un cobro ANTERIOR del mismo cargo sigue pendiente: el saldo de éste
  --    depende de aquél.
  IF v_codigo IS NULL AND EXISTS (
    SELECT 1 FROM public.pagos p2
     WHERE p2.id <> v_pago.id
       AND p2.cargo_adicional_id = v_cargo.id
       AND p2.deleted_at IS NULL AND p2.estado IN ('verificado','aplicado')
       AND (COALESCE(p2.verified_at, p2.created_at), p2.id) < (v_ts, v_pago.id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                        WHERE a.company_id = v_cargo.company_id AND a.origen = 'automatico'
                          AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                          AND a.origen_evento = 'pago_contabilizado'
                          AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
  ) THEN
    v_codigo := 'cobro_anterior_pendiente';
    v_motivo := 'Otro cobro anterior de este cargo sigue pendiente y el saldo que éste reduce depende de aquél. Resuelve o anula el anterior y reprocesa el cargo: sus cobros se contabilizan en orden.';
  END IF;

  -- c) El devengo: publicado y vivo. Su línea de cargo da la cuenta y las
  --    dimensiones del abono. Si falta, el motivo del cargo dice por qué
  --    (configuración, cuenta, responsable).
  IF v_codigo IS NULL THEN
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id, v_pago.id);
    IF v_s.devengo_asiento_id IS NULL OR v_s.devengo_estado <> 'publicado' THEN
      v_codigo := 'devengo_pendiente';
      IF v_s.devengo_estado = 'borrador' THEN
        v_motivo := 'El devengo de este cargo está en borrador. Publícalo en Pólizas y reprocesa el cargo: sus cobros se contabilizan después.';
      ELSE
        SELECT i.codigo, i.motivo INTO v_dev_i FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = v_cargo.id
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1;
        v_motivo := 'Este cargo todavía no está contabilizado'
          || COALESCE(' (' || v_dev_i.codigo || ': ' || v_dev_i.motivo || ')', '')
          || '. Resuelve su pendiente y reprocesa el cargo: sus cobros se contabilizan después.';
      END IF;
    END IF;
  END IF;

  -- d) Dimensiones del devengo = responsable histórico y unidad del cargo.
  IF v_codigo IS NULL AND (v_s.auxiliar_cliente_id IS DISTINCT FROM v_pago.cliente_id
                           OR v_s.unidad_id IS DISTINCT FROM v_cargo.unidad_id) THEN
    v_codigo := 'error';
    v_motivo := 'El devengo del cargo no lleva el responsable o la unidad del cobro: no se aplica a ciegas. Revisa el asiento del cargo.';
  END IF;

  -- e) Saldo: el cobro no puede exceder lo que queda del devengo. El
  --    excedente NO se reparte ni se vuelve anticipo.
  IF v_codigo IS NULL THEN
    v_saldo := GREATEST(v_s.devengo_monto - v_s.aplicado, 0);
    IF v_pago.monto - v_saldo > 0.005 THEN
      v_codigo := 'excede_saldo';
      v_motivo := format('El cobro (%s) supera el saldo pendiente del cargo (%s). El excedente no se reparte a otros documentos ni se convierte en anticipo sin una decisión explícita: anula este cobro y registra uno por el saldo.',
                         v_pago.monto, v_saldo);
    END IF;
  END IF;

  -- f) La cuenta del método de pago (mapeo del ledger).
  v_metodo := CASE v_pago.metodo
    WHEN 'efectivo'        THEN 'metodo_efectivo'
    WHEN 'transferencia'   THEN 'metodo_transferencia'
    WHEN 'deposito'        THEN 'metodo_deposito'
    WHEN 'cheque'          THEN 'metodo_cheque'
    WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
    WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
    WHEN 'paypal'          THEN 'metodo_pasarela'
    ELSE 'metodo_otro'
  END;
  IF v_codigo IS NULL AND public.conta_cuenta_para(v_cargo.company_id, v_cargo.project_id, v_metodo) IS NULL THEN
    v_codigo := 'sin_cuenta';
    v_motivo := format('Falta la cuenta del método de pago (%s) en el mapeo de esta contabilidad. Configúrala y reprocesa el cobro.', v_metodo);
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_cobro_cargo_interno: pago % pendiente (%) — asiento omitido', v_pago.id, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ── El asiento: cargo al método, abono a la CxC del devengo ──────────────
  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_cargo.project_id;

  v_asiento := public.conta_generar_asiento(
    v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado',
    COALESCE(v_pago.verified_at, v_pago.created_at)::date,
    'Pago ' || v_pago.metodo || COALESCE(' ref. ' || NULLIF(v_pago.referencia, ''), '') || ' · cargo ' || v_cargo.concepto,
    'ingreso', v_moneda,
    jsonb_build_array(
      jsonb_build_object('evento', v_metodo, 'debe', v_pago.monto, 'descripcion', 'Cobro'),
      jsonb_build_object('cuenta_id', v_s.cuenta_id, 'haber', v_pago.monto,
                         'descripcion', 'Aplicación a cargo adicional',
                         'auxiliar_cliente_id', v_s.auxiliar_cliente_id, 'unidad_id', v_s.unidad_id,
                         'tipo_cargo', v_s.tipo_cargo)));

  IF v_asiento IS NOT NULL THEN
    INSERT INTO public.conta_cobro_aplicaciones
      (company_id, project_id, pago_id, cargo_adicional_id, evento, monto, cuenta_id, asiento_id)
    VALUES (v_cargo.company_id, v_cargo.project_id, v_pago.id, v_cargo.id, 'cargo_adicional_emitido',
            v_pago.monto, v_s.cuenta_id, v_asiento);

    v_intento := public.conta_registrar_intento_cargo(
      v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'contabilizada', NULL, NULL,
      jsonb_build_array(jsonb_build_object('cargo', v_pago.monto, 'saldo_restante', v_saldo - v_pago.monto)), v_asiento);

    PERFORM public.conta_cargo_sincronizar_estado(v_cargo.id);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_cargo.company_id, v_cargo.project_id, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento del cobro. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento del cobro.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cobro_cargo_interno(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_cobro_cargo_interno(uuid, text) IS
  'INTERNA. Contabiliza el cobro de un cargo adicional por tipo contra la CxC y dimensiones de su devengo: cargo a la cuenta del método, abono a la CxC. Pendiente visible si falta el devengo publicado, si un cobro anterior está pendiente, si excede el saldo o si falta la cuenta del método. Candado por cargo; idempotente; deriva el estado del cargo.';

-- Envoltorio para el trigger: la contabilidad nunca rompe el cobro.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cobro_cargo_seguro(
  p_pago_id uuid,
  p_disparo text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_project uuid;
BEGIN
  BEGIN
    PERFORM public.conta_contabilizar_cobro_cargo_interno(p_pago_id, p_disparo);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_contabilizar_cobro_cargo_seguro(%): %', p_pago_id, SQLERRM;
    BEGIN
      SELECT ca.company_id, ca.project_id INTO v_company, v_project
        FROM public.pagos p
        JOIN public.cargos_adicionales_unidad ca ON ca.id = p.cargo_adicional_id
       WHERE p.id = p_pago_id;
      IF v_company IS NOT NULL THEN
        PERFORM public.conta_registrar_intento_cargo(
          v_company, v_project, 'pagos', p_pago_id, 'pago_contabilizado', p_disparo,
          'pendiente', 'error',
          'Error inesperado al contabilizar el cobro. Reprocesa; si persiste, consulta el registro del servidor.',
          '[]'::jsonb, NULL);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'conta_contabilizar_cobro_cargo_seguro: no se pudo registrar el intento: %', SQLERRM;
    END;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cobro_cargo_seguro(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── 7. Permiso y ámbito de las RPC de cobro de cargos (INTERNA) ─────────────
-- Devuelve la empresa de la sesión o lanza. Escribir exige lo mismo que
-- operar Condominios (dueño/admin o platform.condominios.edit); leer, ver
-- Condominios o la contabilidad.
CREATE OR REPLACE FUNCTION public.conta_cobro_cargo_autorizar(p_escribir boolean)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
          OR public.user_has_permission('platform.condominios.edit')
          OR (NOT p_escribir AND (public.user_has_permission('platform.condominios.view')
                                  OR public.user_has_permission('platform.contabilidad.view')))) THEN
    RAISE EXCEPTION 'No autorizado para % cobros de cargos adicionales.',
      CASE WHEN p_escribir THEN 'registrar o anular' ELSE 'consultar' END USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cobro_cargo_autorizar(boolean) FROM PUBLIC, anon, authenticated;

-- ── 8. RPC: registrar un cobro de cargo (back-office, ya verificado) ────────
-- p_pago_id: clave de idempotencia que genera el cliente. Repetir la misma
-- llamada devuelve el cobro ya registrado y no crea otro.
CREATE OR REPLACE FUNCTION public.conta_registrar_cobro_cargo(
  p_cargo_id   uuid,
  p_monto      numeric,
  p_metodo     text,
  p_fecha      date,
  p_referencia text DEFAULT NULL,
  p_notas      text DEFAULT NULL,
  p_pago_id    uuid DEFAULT NULL
)
RETURNS TABLE (
  pago_id        uuid,
  repetido       boolean,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  estado_cargo   text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_cargo    public.cargos_adicionales_unidad;
  v_id       uuid := COALESCE(p_pago_id, gen_random_uuid());
  v_existe   public.pagos;
  v_repetido boolean := false;
  v_ts       timestamptz;
  v_s        record;
  v_i        record;
BEGIN
  v_company := public.conta_cobro_cargo_autorizar(true);

  -- BLOQUEO del cargo, primero (orden: cargo → pago → candado). Otra
  -- empresa o un proyecto no autorizado responden como inexistente.
  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
   WHERE ca.id = p_cargo_id AND ca.company_id = v_company
     AND public.can_access_project(ca.project_id)
     FOR UPDATE;
  IF v_cargo.id IS NULL THEN
    RAISE EXCEPTION 'El cargo no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_cargo.company_id);

  -- Idempotencia: la misma clave devuelve lo ya registrado.
  SELECT * INTO v_existe FROM public.pagos p WHERE p.id = v_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.cargo_adicional_id IS DISTINCT FROM v_cargo.id
       OR v_existe.monto IS DISTINCT FROM round(p_monto, 2)
       OR v_existe.metodo IS DISTINCT FROM p_metodo THEN
      RAISE EXCEPTION 'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica otro cobro distinto.' USING ERRCODE = '23505';
    END IF;
    v_repetido := true;
  ELSE
    -- Validaciones del alta.
    IF v_cargo.estado = 'anulado' THEN
      RAISE EXCEPTION 'COBRO_CARGO_ANULADO: el cargo está anulado; no admite cobros.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = v_cargo.id) THEN
      RAISE EXCEPTION 'COBRO_CARGO_HISTORICO: el cargo es anterior a la contabilización por tipo de cargo (no tiene devengo por tipo); su cobro no se registra aquí.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_cargo.estado = 'pagado'
       AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = v_cargo.id) THEN
      RAISE EXCEPTION 'COBRO_CARGO_PAGADO_SIN_COBRO: el cargo figura como pagado desde antes de los cobros por cargo, sin cobro vinculado. No se registran cobros sobre él ni se inventan aplicaciones.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_cargo.responsable_cliente_id IS NULL THEN
      RAISE EXCEPTION 'COBRO_CARGO_SIN_RESPONSABLE: el cargo no tiene responsable histórico; asígnalo y reprocesa el cargo antes de registrar cobros.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_monto IS NULL OR p_monto <= 0 OR p_monto <> round(p_monto, 2) THEN
      RAISE EXCEPTION 'COBRO_CARGO_IMPORTE: el importe debe ser positivo y con dos decimales como máximo.' USING ERRCODE = '22023';
    END IF;
    IF p_metodo IS NULL OR p_metodo NOT IN
       ('efectivo','transferencia','deposito','cheque','tarjeta_credito','tarjeta_debito','otro') THEN
      RAISE EXCEPTION 'COBRO_CARGO_METODO: método de pago inválido: %', p_metodo USING ERRCODE = '22023';
    END IF;
    IF p_fecha IS NULL OR p_fecha > CURRENT_DATE THEN
      RAISE EXCEPTION 'COBRO_CARGO_FECHA: la fecha del cobro es obligatoria y no puede ser futura.' USING ERRCODE = '22023';
    END IF;
    IF p_fecha < v_cargo.fecha_cargo THEN
      RAISE EXCEPTION 'COBRO_CARGO_FECHA: la fecha del cobro es anterior al cargo (%); un anticipo no se registra aquí.',
        v_cargo.fecha_cargo USING ERRCODE = '22023';
    END IF;

    -- La hora conserva el orden de registro dentro del mismo día.
    v_ts := CASE WHEN p_fecha = CURRENT_DATE THEN now()
                 ELSE (p_fecha + (now() - date_trunc('day', now())))::timestamptz END;
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id);

    PERFORM set_config('conta.cobro_cargo_pago', v_id::text, true);
    INSERT INTO public.pagos (
      id, cliente_id, project_id, cargo_adicional_id, monto, metodo, referencia, notas,
      estado, verification_status, verified_at, verified_by, created_by, created_at, tipo_aplicacion)
    VALUES (
      v_id, v_cargo.responsable_cliente_id, v_cargo.project_id, v_cargo.id, p_monto, p_metodo,
      NULLIF(btrim(COALESCE(p_referencia, '')), ''), NULLIF(btrim(COALESCE(p_notas, '')), ''),
      'verificado', 'verificado', v_ts, auth.uid(), auth.uid(), v_ts,
      CASE WHEN p_monto >= COALESCE(v_s.devengo_monto, v_cargo.monto) - v_s.aplicado THEN 'pago_total' ELSE 'abono' END);
    PERFORM set_config('conta.cobro_cargo_pago', '', true);
  END IF;

  SELECT i.resultado, i.codigo, i.motivo, i.asiento_id INTO v_i
    FROM public.conta_intentos_contabilizacion i
   WHERE i.origen_tabla = 'pagos' AND i.origen_id = v_id
   ORDER BY i.created_at DESC, i.id DESC LIMIT 1;

  RETURN QUERY
  SELECT v_id, v_repetido,
         CASE WHEN v_repetido AND v_i.resultado = 'ya_contabilizada' THEN 'contabilizada' ELSE v_i.resultado END,
         v_i.codigo, v_i.motivo, a.id, a.numero::bigint,
         (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_cargo.id)
    FROM (SELECT 1) uno
    LEFT JOIN public.conta_asientos a
      ON a.id = COALESCE(v_i.asiento_id,
                         (SELECT x.id FROM public.conta_asientos x
                           WHERE x.company_id = v_company AND x.origen = 'automatico'
                             AND x.origen_tabla = 'pagos' AND x.origen_id = v_id
                             AND x.origen_evento = 'pago_contabilizado'
                           ORDER BY x.created_at DESC LIMIT 1));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_registrar_cobro_cargo(uuid, numeric, text, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_registrar_cobro_cargo(uuid, numeric, text, date, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_registrar_cobro_cargo(uuid, numeric, text, date, text, text, uuid) IS
  'Registra en back-office un cobro YA VERIFICADO de un cargo adicional por tipo y lo contabiliza contra la CxC de su devengo. Empresa, proyecto, unidad y responsable histórico salen del cargo (bloqueado). Admite cobros parciales y varios por cargo; un excedente queda pendiente con su motivo. Idempotente por p_pago_id.';

-- ── 9. RPC: anular un cobro de cargo (rechazo con motivo; nada se borra) ────
CREATE OR REPLACE FUNCTION public.conta_anular_cobro_cargo(
  p_pago_id uuid,
  p_motivo  text
)
RETURNS TABLE (
  pago_id          uuid,
  resultado        text,
  asiento_id       uuid,
  reverso_id       uuid,
  reverso_numero   bigint,
  estado_cargo     text,
  cobros_pendientes bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_cargo_id uuid;
  v_cargo    public.cargos_adicionales_unidad;
  v_pago     public.pagos;
  v_res      text;
BEGIN
  v_company := public.conta_cobro_cargo_autorizar(true);
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación.' USING ERRCODE = '22023';
  END IF;

  SELECT p.cargo_adicional_id INTO v_cargo_id FROM public.pagos p WHERE p.id = p_pago_id;
  -- Orden: cargo → pago.
  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
   WHERE ca.id = v_cargo_id AND ca.company_id = v_company
     AND public.can_access_project(ca.project_id)
     FOR UPDATE;
  IF v_cargo.id IS NULL THEN
    RAISE EXCEPTION 'El cobro no existe, no es de un cargo adicional o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_cargo.company_id);

  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;

  IF v_pago.estado = 'rechazado' OR v_pago.deleted_at IS NOT NULL THEN
    v_res := 'ya_anulado';
  ELSE
    PERFORM set_config('conta.cobro_cargo_pago', v_pago.id::text, true);
    UPDATE public.pagos p
       SET estado = 'rechazado', verification_status = 'rechazado',
           verification_notes = btrim(p_motivo), updated_at = now()
     WHERE p.id = v_pago.id;
    PERFORM set_config('conta.cobro_cargo_pago', '', true);
    v_res := 'anulado';
  END IF;

  RETURN QUERY
  SELECT v_pago.id, v_res, a.id, r.id, r.numero::bigint,
         (SELECT ca.estado FROM public.cargos_adicionales_unidad ca WHERE ca.id = v_cargo.id),
         (SELECT count(*) FROM public.pagos p
           WHERE p.cargo_adicional_id = v_cargo.id AND p.deleted_at IS NULL
             AND p.estado IN ('verificado','aplicado')
             AND NOT EXISTS (SELECT 1 FROM public.conta_asientos x
                              WHERE x.company_id = v_company AND x.origen = 'automatico'
                                AND x.origen_tabla = 'pagos' AND x.origen_id = p.id
                                AND x.origen_evento = 'pago_contabilizado'))
    FROM (SELECT 1) uno
    LEFT JOIN public.conta_asientos a
      ON a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id AND a.origen_evento = 'pago_contabilizado'
    LEFT JOIN public.conta_asientos r ON r.id = a.anulado_por_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_anular_cobro_cargo(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_anular_cobro_cargo(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.conta_anular_cobro_cargo(uuid, text) IS
  'Anula (rechaza con motivo) un cobro de cargo adicional: bloquea el cargo y el cobro, reversa su asiento si lo tenía (la aplicación queda como evidencia y deja de contar) y vuelve a derivar el estado del cargo. Idempotente. Los cobros posteriores que quedaron pendientes se contabilizan al reprocesar el cargo.';

-- ── 10. Lecturas para Condominios ───────────────────────────────────────────
-- Resumen por cargo del proyecto: lo que la pestaña necesita para decidir si
-- ofrece «Registrar cobro» y mostrar lo cobrado.
CREATE OR REPLACE FUNCTION public.conta_cargos_cobro_resumen(p_project_id uuid)
RETURNS TABLE (
  cargo_id          uuid,
  por_tipo          boolean,
  devengo_estado    text,
  devengado         numeric,
  aplicado          numeric,
  en_proceso        numeric,
  saldo             numeric,
  cobros            bigint,
  pagado_sin_cobro  boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := public.conta_cobro_cargo_autorizar(false);
  IF p_project_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id));
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ca.id,
         t.por_tipo,
         s.devengo_estado,
         COALESCE(s.devengo_monto, ca.monto)::numeric(14,2),
         s.aplicado,
         COALESCE((SELECT sum(p.monto) FROM public.pagos p
                    WHERE p.cargo_adicional_id = ca.id AND p.deleted_at IS NULL
                      AND p.estado IN ('verificado','aplicado')
                      AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                                       WHERE a.company_id = v_company AND a.origen = 'automatico'
                                         AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                                         AND a.origen_evento = 'pago_contabilizado'
                                         AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)), 0)::numeric(14,2),
         GREATEST(COALESCE(s.devengo_monto, ca.monto) - s.aplicado, 0)::numeric(14,2),
         (SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = ca.id),
         (ca.estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = ca.id))
    FROM public.cargos_adicionales_unidad ca
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = ca.id) AS por_tipo) t
    CROSS JOIN LATERAL public.conta_cargo_saldo_cobro(ca.id) s
   WHERE ca.company_id = v_company AND ca.project_id = p_project_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargos_cobro_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargos_cobro_resumen(uuid) TO authenticated;

-- Detalle de los cobros de UN cargo, con su asiento, reverso y pendiente.
CREATE OR REPLACE FUNCTION public.conta_cargo_cobros(p_cargo_id uuid)
RETURNS TABLE (
  pago_id         uuid,
  fecha           date,
  monto           numeric,
  metodo          text,
  referencia      text,
  estado          text,
  anulacion_motivo text,
  aplicado        numeric,
  asiento_id      uuid,
  asiento_numero  bigint,
  asiento_estado  text,
  reverso_id      uuid,
  reverso_numero  bigint,
  reverso_fecha   date,
  codigo          text,
  motivo          text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_cargo   public.cargos_adicionales_unidad;
BEGIN
  v_company := public.conta_cobro_cargo_autorizar(false);
  SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca
   WHERE ca.id = p_cargo_id AND ca.company_id = v_company
     AND public.can_access_project(ca.project_id);
  IF v_cargo.id IS NULL THEN
    RAISE EXCEPTION 'El cargo no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.assert_company_scope(v_cargo.company_id);

  RETURN QUERY
  SELECT p.id, COALESCE(p.verified_at, p.created_at)::date, p.monto, p.metodo, p.referencia, p.estado,
         CASE WHEN p.estado = 'rechazado' THEN p.verification_notes END,
         COALESCE(ap.monto, 0)::numeric(14,2),
         a.id, a.numero::bigint, a.estado::text, r.id, r.numero::bigint, r.fecha,
         CASE WHEN a.id IS NULL AND p.estado IN ('verificado','aplicado') AND p.deleted_at IS NULL THEN ui.codigo END,
         CASE WHEN a.id IS NULL AND p.estado IN ('verificado','aplicado') AND p.deleted_at IS NULL THEN ui.motivo END
    FROM public.pagos p
    LEFT JOIN LATERAL (
      SELECT x.id, x.numero, x.estado, x.anulado_por_id FROM public.conta_asientos x
       WHERE x.company_id = v_company AND x.origen = 'automatico'
         AND x.origen_tabla = 'pagos' AND x.origen_id = p.id AND x.origen_evento = 'pago_contabilizado'
       ORDER BY x.created_at DESC LIMIT 1) a ON true
    LEFT JOIN public.conta_asientos r ON r.id = a.anulado_por_id
    LEFT JOIN public.conta_cobro_aplicaciones ap ON ap.pago_id = p.id AND ap.cargo_adicional_id = p.cargo_adicional_id
    LEFT JOIN LATERAL (
      SELECT i.codigo, i.motivo FROM public.conta_intentos_contabilizacion i
       WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id
       ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
   WHERE p.cargo_adicional_id = v_cargo.id
   ORDER BY COALESCE(p.verified_at, p.created_at), p.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_cobros(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargo_cobros(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_cargos_cobro_resumen(uuid) IS
  'Por cargo adicional del proyecto: si es por tipo, estado del devengo, devengado, aplicado por cobros vivos, cobros pendientes de contabilizar, saldo y si figura pagado sin cobro (histórico).';
COMMENT ON FUNCTION public.conta_cargo_cobros(uuid) IS
  'Cobros de un cargo adicional con su aplicación, asiento, reverso y, si está pendiente, el motivo.';

-- ── 11. Trigger de PAGOS: el cobro de un cargo va a su propia contabilización ─
-- Cuerpo idéntico a 20261002000100 salvo: (a) el cobro de un cargo adicional
-- se contabiliza con conta_contabilizar_cobro_cargo_seguro; (b) tras el
-- reverso de un cobro de cargo, el estado del cargo se vuelve a derivar.
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

-- ── 12. Reprocesar UN cobro: también de cargos adicionales ──────────────────
-- Cuerpo idéntico a 20261002000100 salvo el proyecto (del cargo) y la
-- función de contabilización que corresponde.
CREATE OR REPLACE FUNCTION public.conta_reprocesar_un_cobro(
  p_pago_id    uuid,
  p_company_id uuid
)
RETURNS TABLE (
  evento         text,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_estado text,
  intento_id     uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_pago     public.pagos;
  v_project  uuid;
  v_a        record;
  v_res      record;
  v_intento  uuid;
  v_periodo  text;
BEGIN
  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id;
  IF v_pago.cargo_adicional_id IS NOT NULL THEN
    SELECT ca.project_id INTO v_project FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = v_pago.cargo_adicional_id;
  ELSE
    SELECT c.project_id INTO v_project FROM public.cuotas_condominio c
     WHERE c.id = public.conta_cobro_cuota_por_tipo(p_pago_id);
  END IF;

  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
      'pago_contabilizado', 'reproceso', 'bloqueada', 'documento_anulado',
      'El cobro está rechazado, sin verificar o eliminado: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pago_contabilizado'::text, 'bloqueada'::text, 'documento_anulado'::text,
      'El cobro está rechazado, sin verificar o eliminado: no se contabiliza.'::text,
      NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  SELECT a.id, a.numero, a.estado, a.anulado_por_id INTO v_a
    FROM public.conta_asientos a
   WHERE a.company_id = p_company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = p_pago_id
     AND a.origen_evento = 'pago_contabilizado'
   ORDER BY (a.estado <> 'anulado' AND a.anulado_por_id IS NULL) DESC, a.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_a.estado <> 'anulado' AND v_a.anulado_por_id IS NULL THEN
      v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
        'pago_contabilizado', 'reproceso', 'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_a.id);
      RETURN QUERY SELECT 'pago_contabilizado'::text, 'ya_contabilizada'::text, NULL::text,
        'El cobro ya está contabilizado.'::text, v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
    ELSE
      v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
        'pago_contabilizado', 'reproceso', 'bloqueada', 'asiento_reversado',
        'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.', '[]'::jsonb, v_a.id);
      RETURN QUERY SELECT 'pago_contabilizado'::text, 'bloqueada'::text, 'asiento_reversado'::text,
        'El asiento de este cobro fue anulado o reversado: no se recrea automáticamente.'::text,
        v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
    END IF;
    RETURN;
  END IF;

  v_periodo := to_char(public.conta_fecha_evento_cargo('pagos', p_pago_id, 'pago_contabilizado'), 'YYYY-MM');
  IF v_project IS NOT NULL AND public.conta_periodo_cerrado(v_project, v_periodo) THEN
    v_intento := public.conta_registrar_intento_cargo(p_company_id, v_project, 'pagos', p_pago_id,
      'pago_contabilizado', 'reproceso', 'bloqueada', 'periodo_cerrado',
      format('El período %s del cobro está cerrado. No se cambia la fecha ni se abre el período: resuélvelo con el cierre y vuelve a intentar.', v_periodo),
      '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pago_contabilizado'::text, 'bloqueada'::text, 'periodo_cerrado'::text,
      format('El período %s del cobro está cerrado. No se cambia la fecha ni se abre el período.', v_periodo),
      NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  IF v_pago.cargo_adicional_id IS NOT NULL THEN
    SELECT * INTO v_res FROM public.conta_contabilizar_cobro_cargo_interno(p_pago_id, 'reproceso');
  ELSE
    SELECT * INTO v_res FROM public.conta_contabilizar_cobro_interno(p_pago_id, 'reproceso');
  END IF;
  IF v_res.asiento_id IS NOT NULL THEN
    SELECT a.numero, a.estado INTO v_a FROM public.conta_asientos a WHERE a.id = v_res.asiento_id;
    RETURN QUERY SELECT 'pago_contabilizado'::text, v_res.resultado, v_res.codigo,
      CASE WHEN v_a.estado = 'borrador'
           THEN 'Asiento generado en borrador: falta el tipo de cambio de la fecha. Publícalo desde Pólizas.'
           ELSE NULL END,
      v_res.asiento_id, v_a.numero::bigint, v_a.estado::text, v_res.intento_id;
  ELSE
    RETURN QUERY SELECT 'pago_contabilizado'::text, v_res.resultado, v_res.codigo, v_res.motivo,
      NULL::uuid, NULL::bigint, NULL::text, v_res.intento_id;
  END IF;
END;
$$;

-- ── 13. Reproceso: cobros de cargos y cargos con cobros pendientes ─────────
-- Cuerpo idéntico a 20261002000200 salvo: un cobro de cargo bloquea primero
-- el cargo y después el pago; el reproceso de un cargo contabiliza después
-- sus cobros pendientes, bloqueados por id y en orden cronológico.
CREATE OR REPLACE FUNCTION public.conta_reprocesar_cargo(
  p_origen_tabla text,
  p_origen_id    uuid
)
RETURNS TABLE (
  evento         text,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_estado text,
  intento_id     uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_doc_co   uuid;
  v_project  uuid;
  v_anulado  boolean;
  v_fecha    date;
  v_evento   text;
  v_a        record;
  v_res      record;
  v_intento  uuid;
  v_periodo  text;
  v_alguno   boolean := false;
  v_pago_id  uuid;
  v_pagos    uuid[] := '{}';
  v_cargo_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;

  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  -- Genera y publica un asiento: exige crear Y cambiar estado.
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para contabilizar cargos.' USING ERRCODE = '42501';
  END IF;

  IF p_origen_tabla IS NULL OR p_origen_tabla NOT IN ('cuotas_condominio','cargos_adicionales_unidad','pagos') THEN
    RAISE EXCEPTION 'Origen inválido: %', p_origen_tabla USING ERRCODE = '22023';
  END IF;
  IF p_origen_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere el id del documento.' USING ERRCODE = '22023';
  END IF;

  -- BLOQUEO: serializa con otro reproceso, con la anulación y con el borrado.
  -- Otra empresa o un proyecto no autorizado responden igual que un
  -- documento inexistente: no se confirma la existencia de lo ajeno.
  -- Un COBRO: se bloquea su fila y se reprocesa él solo. Su cuota da empresa y
  -- proyecto; fuera de ámbito responde como inexistente.
  -- Un COBRO DE CARGO ADICIONAL (20261004000000): mismo orden que el resto
  -- de caminos de un cargo — fila del cargo → fila del pago → candado.
  IF p_origen_tabla = 'pagos' THEN
    SELECT p.cargo_adicional_id INTO v_cargo_id FROM public.pagos p WHERE p.id = p_origen_id;
  END IF;
  IF p_origen_tabla = 'pagos' AND v_cargo_id IS NOT NULL THEN
    SELECT ca.company_id INTO v_doc_co
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = v_cargo_id AND ca.company_id = v_company
       AND public.can_access_project(ca.project_id)
       FOR UPDATE;
    IF v_doc_co IS NOT NULL THEN
      PERFORM 1 FROM public.pagos p WHERE p.id = p_origen_id FOR UPDATE;
    END IF;
    IF v_doc_co IS NULL THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
        'El documento no existe o no está en tu ámbito.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p_origen_id) THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
        'Este cobro no pasó por la contabilización por tipo de cargo: no se contabiliza retroactivamente.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(p_origen_id, v_doc_co);
    RETURN;
  END IF;

  IF p_origen_tabla = 'pagos' THEN
    SELECT c.company_id INTO v_doc_co
      FROM public.pagos p
      JOIN public.cuotas_condominio c
        ON c.id = COALESCE(p.cuota_id,
                           (SELECT c2.id FROM public.cuotas_condominio c2 WHERE c2.pago_id = p.id
                             ORDER BY c2.created_at, c2.id LIMIT 1))
     WHERE p.id = p_origen_id AND c.company_id = v_company
       AND public.can_access_project(c.project_id)
       FOR UPDATE OF p;
    IF v_doc_co IS NULL THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
        'El documento no existe o no está en tu ámbito.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    IF public.conta_cobro_cuota_por_tipo(p_origen_id) IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                       WHERE i.origen_tabla = 'pagos' AND i.origen_id = p_origen_id) THEN
      RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
        'Este cobro no pasó por la contabilización por tipo de cargo: no se contabiliza retroactivamente.'::text,
        NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(p_origen_id, v_doc_co);
    RETURN;
  END IF;

  IF p_origen_tabla = 'cuotas_condominio' THEN
    SELECT c.company_id, c.project_id, c.deleted_at IS NOT NULL, c.created_at::date
      INTO v_doc_co, v_project, v_anulado, v_fecha
      FROM public.cuotas_condominio c
     WHERE c.id = p_origen_id AND c.company_id = v_company
       AND public.can_access_project(c.project_id)
       FOR UPDATE;
  ELSE
    SELECT ca.company_id, ca.project_id, ca.estado = 'anulado', ca.fecha_cargo
      INTO v_doc_co, v_project, v_anulado, v_fecha
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = p_origen_id AND ca.company_id = v_company
       AND public.can_access_project(ca.project_id)
       FOR UPDATE;
  END IF;

  IF v_doc_co IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
      'El documento no existe o no está en tu ámbito.'::text,
      NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  FOR v_evento IN
    SELECT DISTINCT i.evento
      FROM public.conta_intentos_contabilizacion i
     WHERE i.origen_tabla = p_origen_tabla AND i.origen_id = p_origen_id
     ORDER BY 1
  LOOP
    v_alguno := true;

    IF v_anulado THEN
      v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
        v_evento, 'reproceso', 'bloqueada', 'documento_anulado',
        'El documento está anulado o eliminado: no se contabiliza.', '[]'::jsonb, NULL);
      RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'documento_anulado'::text,
        'El documento está anulado o eliminado: no se contabiliza.'::text,
        NULL::uuid, NULL::bigint, NULL::text, v_intento;
      CONTINUE;
    END IF;

    -- ¿Ya tiene asiento? Vivo → ya contabilizado. Reversado o anulado → no
    -- se recrea: eso lo decide una persona, no un botón.
    SELECT a.id, a.numero, a.estado, a.anulado_por_id INTO v_a
      FROM public.conta_asientos a
     WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
       AND a.origen_tabla = p_origen_tabla AND a.origen_id = p_origen_id
       AND a.origen_evento = v_evento
     ORDER BY (a.estado <> 'anulado' AND a.anulado_por_id IS NULL) DESC, a.created_at DESC
     LIMIT 1;

    IF FOUND THEN
      IF v_a.estado <> 'anulado' AND v_a.anulado_por_id IS NULL THEN
        v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
          v_evento, 'reproceso', 'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_a.id);
        RETURN QUERY SELECT v_evento, 'ya_contabilizada'::text, NULL::text,
          'El documento ya está contabilizado.'::text,
          v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
      ELSE
        v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
          v_evento, 'reproceso', 'bloqueada', 'asiento_reversado',
          'El asiento de este documento fue anulado o reversado: no se recrea automáticamente.',
          '[]'::jsonb, v_a.id);
        RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'asiento_reversado'::text,
          'El asiento de este documento fue anulado o reversado: no se recrea automáticamente.'::text,
          v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
      END IF;
      CONTINUE;
    END IF;

    -- Período cerrado: el reproceso no re-fecha ni abre el período.
    -- La fecha del EVENTO: la mora tiene la suya (20261002000100).
    v_periodo := to_char(public.conta_fecha_evento_cargo(p_origen_tabla, p_origen_id, v_evento), 'YYYY-MM');
    IF v_project IS NOT NULL AND public.conta_periodo_cerrado(v_project, v_periodo) THEN
      v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
        v_evento, 'reproceso', 'bloqueada', 'periodo_cerrado',
        format('El período %s está cerrado. No se cambia la fecha ni se abre el período: resuélvelo con el cierre y vuelve a intentar.', v_periodo),
        '[]'::jsonb, NULL);
      RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'periodo_cerrado'::text,
        format('El período %s está cerrado. No se cambia la fecha ni se abre el período.', v_periodo),
        NULL::uuid, NULL::bigint, NULL::text, v_intento;
      CONTINUE;
    END IF;

    -- La MISMA lógica que la emisión.
    SELECT * INTO v_res FROM public.conta_contabilizar_cargo_interno(p_origen_tabla, p_origen_id, v_evento, 'reproceso');
    IF v_res.asiento_id IS NOT NULL THEN
      SELECT a.numero, a.estado INTO v_a FROM public.conta_asientos a WHERE a.id = v_res.asiento_id;
      RETURN QUERY SELECT v_evento, v_res.resultado, v_res.codigo,
        CASE WHEN v_a.estado = 'borrador'
             THEN 'Asiento generado en borrador: falta el tipo de cambio de la fecha. Publícalo desde Pólizas.'
             ELSE NULL END,
        v_res.asiento_id, v_a.numero::bigint, v_a.estado::text, v_res.intento_id;
    ELSE
      RETURN QUERY SELECT v_evento, v_res.resultado, v_res.codigo, v_res.motivo,
        NULL::uuid, NULL::bigint, NULL::text, v_res.intento_id;
    END IF;
  END LOOP;

  -- Cobros de la cuota que esperaban su devengo: ahora, en orden cronológico
  -- (el reparto de cada uno depende de los anteriores).
  IF p_origen_tabla = 'cuotas_condominio' AND NOT v_anulado THEN
    -- BLOQUEO de los cobros pendientes, por id, ANTES de contabilizar ninguno
    -- (orden: cuota → pagos → candado de cobros). Un rechazo o borrado en
    -- curso se espera aquí; al confirmarse, la fila deja de cumplir el filtro
    -- (se re-evalúa sobre la versión nueva) o desaparece, y no se toca.
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE (p.cuota_id = p_origen_id
              OR p.id = (SELECT c.pago_id FROM public.cuotas_condominio c WHERE c.id = p_origen_id))
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id)
       ORDER BY p.id
       FOR UPDATE OF p
    LOOP
      v_pagos := v_pagos || v_pago_id;
    END LOOP;

    -- Sólo los pagos BLOQUEADOS, en orden cronológico y revalidados.
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE p.id = ANY (v_pagos)
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                          WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
                            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                            AND a.origen_evento = 'pago_contabilizado')
       ORDER BY COALESCE(p.verified_at, p.created_at), p.id
    LOOP
      v_alguno := true;
      RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(v_pago_id, v_doc_co);
    END LOOP;
  END IF;

  -- Cobros del CARGO ADICIONAL que esperaban su devengo (20261004000000):
  -- mismo patrón que la cuota — se bloquean por id y se contabilizan en orden.
  IF p_origen_tabla = 'cargos_adicionales_unidad' AND NOT v_anulado THEN
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE p.cargo_adicional_id = p_origen_id
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id)
       ORDER BY p.id
       FOR UPDATE OF p
    LOOP
      v_pagos := v_pagos || v_pago_id;
    END LOOP;

    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE p.id = ANY (v_pagos)
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                          WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
                            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                            AND a.origen_evento = 'pago_contabilizado')
       ORDER BY COALESCE(p.verified_at, p.created_at), p.id
    LOOP
      v_alguno := true;
      RETURN QUERY SELECT * FROM public.conta_reprocesar_un_cobro(v_pago_id, v_doc_co);
    END LOOP;
  END IF;

  -- Sin intentos previos: documento anterior a esta contabilización, o cuota
  -- sin clasificar. No se contabiliza retroactivamente, y NO se registra un
  -- intento (eso lo volvería elegible).
  IF NOT v_alguno THEN
    RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
      'Este documento no pasó por la contabilización por tipo de cargo (es anterior a ella o no está clasificado): no se contabiliza retroactivamente.'::text,
      NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
  END IF;
END;
$$;

-- ── 14. Bandeja: también los cobros de cargos adicionales ──────────────────
-- Cuerpo idéntico a 20261002000100 salvo la rama de cobros de cargos (y que
-- la de cuotas excluye pagos vinculados a un cargo).
CREATE OR REPLACE FUNCTION public.conta_cargos_pendientes(
  p_project_id uuid    DEFAULT NULL,
  p_codigo     text    DEFAULT NULL,
  p_busqueda   text    DEFAULT NULL,
  p_limite     integer DEFAULT 25,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE (
  origen_tabla      text,
  origen_id         uuid,
  evento            text,
  concepto          text,
  unidad_id         uuid,
  unidad_nombre     text,
  responsable_id    uuid,
  responsable_nombre text,
  tipo_cargo        text,
  fecha             date,
  monto             numeric,
  project_id        uuid,
  codigo            text,
  motivo            text,
  ultimo_intento_at timestamptz,
  ultimo_disparo    text,
  intentos          bigint,
  puede_reprocesar  boolean,
  total_filas       bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_puede    boolean;
  v_busqueda text;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
          OR public.user_has_permission('platform.contabilidad.view')) THEN
    RAISE EXCEPTION 'No autorizado para ver la contabilidad.' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  IF p_codigo IS NOT NULL AND p_codigo NOT IN
     ('sin_configuracion','cuenta_invalida','sin_responsable','periodo_cerrado',
      'devengo_pendiente','excede_saldo','otro') THEN
    RAISE EXCEPTION 'Filtro de motivo inválido: %', p_codigo USING ERRCODE = '22023';
  END IF;

  v_puede := public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status');
  v_busqueda := NULLIF(btrim(COALESCE(p_busqueda, '')), '');

  RETURN QUERY
  WITH docs AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, c.concepto || ' ' || c.periodo AS o_concepto,
           c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp, c.created_at::date AS o_fecha,
           c.monto AS o_monto, c.mora_monto AS o_mora, c.project_id AS o_project
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND c.deleted_at IS NULL AND c.tipo_cargo IS NOT NULL
    UNION ALL
    SELECT 'cargos_adicionales_unidad', ca.id, ca.concepto, ca.unidad_id, ca.responsable_cliente_id,
           ca.fecha_cargo, ca.monto, NULL::numeric, ca.project_id
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.company_id = v_company AND ca.project_id IS NOT DISTINCT FROM p_project_id
       AND ca.estado IS DISTINCT FROM 'anulado'
    UNION ALL
    SELECT 'pagos', p.id,
           'Cobro ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' — ' || c.concepto || ' ' || c.periodo,
           c.unidad_id, c.responsable_cliente_id, COALESCE(p.verified_at, p.created_at)::date,
           p.monto, NULL::numeric, c.project_id
      FROM public.pagos p
      JOIN public.cuotas_condominio c
        ON c.id = COALESCE(p.cuota_id,
                           (SELECT c2.id FROM public.cuotas_condominio c2 WHERE c2.pago_id = p.id
                             ORDER BY c2.created_at, c2.id LIMIT 1))
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND p.cargo_adicional_id IS NULL
       AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
    UNION ALL
    -- Cobros de cargos adicionales (20261004000000)
    SELECT 'pagos', p.id,
           'Cobro ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' — cargo ' || ca.concepto,
           ca.unidad_id, ca.responsable_cliente_id, COALESCE(p.verified_at, p.created_at)::date,
           p.monto, NULL::numeric, ca.project_id
      FROM public.pagos p
      JOIN public.cargos_adicionales_unidad ca ON ca.id = p.cargo_adicional_id
     WHERE ca.company_id = v_company AND ca.project_id IS NOT DISTINCT FROM p_project_id
       AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
  ),
  eventos AS (
    SELECT DISTINCT d.*, i.evento AS o_evento
      FROM docs d
      JOIN public.conta_intentos_contabilizacion i
        ON i.origen_tabla = d.o_tabla AND i.origen_id = d.o_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.conta_asientos a
        WHERE a.company_id = v_company AND a.origen = 'automatico'
          AND a.origen_tabla = d.o_tabla AND a.origen_id = d.o_id
          AND a.origen_evento = i.evento)
  ),
  diag AS (
    SELECT e.*, ui.created_at AS i_at, ui.disparo AS i_disparo, ui.resultado AS i_resultado,
           ui.codigo AS i_codigo, ui.motivo AS i_motivo,
           (SELECT count(*) FROM public.conta_intentos_contabilizacion i2
             WHERE i2.origen_tabla = e.o_tabla AND i2.origen_id = e.o_id AND i2.evento = e.o_evento) AS n_intentos,
           u.nombre AS u_nombre, cl.nombre AS r_nombre,
           public.conta_tipo_cargo_de_documento(e.o_tabla, e.o_id, e.o_evento) AS o_tipo
      FROM eventos e
      LEFT JOIN LATERAL (
        SELECT i.* FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
      LEFT JOIN public.unidades u ON u.id = e.o_unidad
      LEFT JOIN public.clientes cl ON cl.id = e.o_resp
     WHERE v_busqueda IS NULL
        OR e.o_concepto ILIKE '%' || v_busqueda || '%'
        OR u.nombre ILIKE '%' || v_busqueda || '%'
        OR cl.nombre ILIKE '%' || v_busqueda || '%'
  ),
  clasif AS (
    SELECT d.*,
      CASE WHEN d.i_resultado IN ('pendiente','bloqueada') THEN d.i_codigo ELSE 'error' END AS c_codigo,
      CASE WHEN d.i_resultado IN ('pendiente','bloqueada') THEN d.i_motivo
           ELSE 'El último intento no dejó asiento vigente. Reprocesa para diagnosticar.' END AS c_motivo
      FROM diag d
  ),
  filtrado AS (
    SELECT c.* FROM clasif c
     WHERE p_codigo IS NULL
        OR (p_codigo = 'otro' AND c.c_codigo NOT IN ('sin_configuracion','cuenta_invalida','sin_responsable','periodo_cerrado',
                                                       'devengo_pendiente','excede_saldo'))
        OR c.c_codigo = p_codigo
  )
  SELECT f.o_tabla, f.o_id, f.o_evento, f.o_concepto, f.o_unidad, f.u_nombre, f.o_resp, f.r_nombre,
         f.o_tipo, f.o_fecha,
         (CASE WHEN f.o_evento = 'cuota_mora' THEN f.o_mora ELSE f.o_monto END)::numeric,
         f.o_project, f.c_codigo, f.c_motivo, f.i_at, f.i_disparo, f.n_intentos, v_puede,
         count(*) OVER ()
    FROM filtrado f
   ORDER BY f.i_at DESC NULLS LAST, f.o_id, f.o_evento
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

-- ── 15. Estado de cuenta: cobros de cargos como abonos del sujeto ──────────
-- conta_ec_fuera_de_saldo: cuerpo idéntico a 20261003000200 salvo la rama de
-- cobros de cargos y «cobro_sin_vinculo», que queda sólo para cargos
-- «pagados» sin ningún cobro vinculado.
CREATE OR REPLACE FUNCTION public.conta_ec_fuera_de_saldo(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (
  clase          text,
  naturaleza     text,
  origen_tabla   text,
  origen_id      uuid,
  evento         text,
  fecha          date,
  concepto       text,
  tipo_cargo     text,
  unidad_id      uuid,
  responsable_id uuid,
  monto          numeric,
  estado_actual  text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_fecha  date,
  limitacion     text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH par AS (
    SELECT COALESCE(p_hasta, 'infinity'::date) AS h,
           (p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE) AS historico
  ),
  cu AS (
    SELECT c.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id) AS por_tipo,
           LEAST(c.deleted_at, c.anulada_at) AS cancelado_at
      FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  ca AS (
    SELECT x.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id) AS por_tipo
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
  ),
  -- Eventos: devengos de cuota, mora y cargo adicional; y cobros de cuotas.
  -- o_cancel = cuándo dejó de estar vigente, si se sabe por el documento.
  -- o_cancel_por_reverso = el documento está anulado/rechazado hoy y su fecha
  -- sólo se conoce por el registro del reverso de su asiento.
  ev AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, 'cuota_emitida'::text AS o_evento,
           'cargo'::text AS o_nat,
           c.created_at::date AS o_fecha, c.concepto || ' ' || c.periodo AS o_concepto,
           c.tipo_cargo AS o_tipo, c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp,
           c.monto AS o_monto, c.estado AS o_estado, c.por_tipo AS o_por_tipo,
           c.cancelado_at AS o_cancel, false AS o_cancel_por_reverso
      FROM cu c WHERE COALESCE(c.monto, 0) > 0
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', 'cargo',
           public.conta_fecha_evento_cargo('cuotas_condominio', c.id, 'cuota_mora'),
           'Mora · ' || c.concepto || ' ' || c.periodo,
           'recargo_mora', c.unidad_id, c.responsable_cliente_id,
           c.mora_monto, c.estado, c.por_tipo, c.cancelado_at, false
      FROM cu c WHERE COALESCE(c.mora_monto, 0) > 0
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', 'cargo', x.fecha_cargo, x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, x.monto, x.estado, x.por_tipo,
           NULL::timestamptz, x.estado = 'anulado'
      FROM ca x WHERE COALESCE(x.monto, 0) > 0
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (p.id)
             'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
             COALESCE(p.verified_at, p.created_at)::date,
             'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · ' || c.concepto || ' ' || c.periodo,
             c.tipo_cargo, c.unidad_id, c.responsable_cliente_id, p.monto, p.estado, c.por_tipo,
             -- el cobro de una cuota anulada deja de estar vigente con ella
             LEAST(p.deleted_at, c.cancelado_at), p.estado = 'rechazado'
        FROM cu c
        JOIN public.pagos p ON (p.cuota_id = c.id OR c.pago_id = p.id)
       WHERE p.estado IN ('verificado', 'aplicado', 'rechazado')
         AND p.cargo_adicional_id IS NULL
       ORDER BY p.id, c.id
    ) pg
    UNION ALL
    -- Cobros de cargos adicionales (20261004000000). El cargo no se puede
    -- anular con cobros vivos: la vigencia del cobro es la suya.
    SELECT 'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
           COALESCE(p.verified_at, p.created_at)::date,
           'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · cargo ' || x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, p.monto, p.estado, x.por_tipo,
           p.deleted_at, p.estado = 'rechazado'
      FROM ca x
      JOIN public.pagos p ON p.cargo_adicional_id = x.id
     WHERE p.estado IN ('verificado', 'aplicado', 'rechazado')
  ),
  -- Asientos del evento evaluados al corte.
  ev_a AS (
    SELECT e.*, par.h, par.historico,
           sal.id AS a_saldo,
           pos.id AS a_post, pos.fecha AS a_post_fecha,
           rev.id AS a_rev, rev.r_fecha, rev.r_creado,
           bor.id AS a_borr, bor.fecha AS a_borr_fecha,
           anu.r_creado AS anul_creado,
           ih.codigo AS ih_codigo, ih.motivo AS ih_motivo,
           ia.motivo AS ia_motivo
      FROM ev e
      CROSS JOIN par
      LEFT JOIN LATERAL (
        SELECT a.id FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha <= par.h
           AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                            WHERE r.id = a.anulado_por_id AND r.estado = 'publicado' AND r.fecha <= par.h)
         ORDER BY a.fecha, a.created_at LIMIT 1
      ) sal ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.fecha FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha > par.h
         ORDER BY a.fecha, a.created_at LIMIT 1
      ) pos ON true
      LEFT JOIN LATERAL (
        SELECT a.id, r.fecha AS r_fecha, r.created_at AS r_creado
          FROM public.conta_asientos a
          JOIN public.conta_asientos r ON r.id = a.anulado_por_id AND r.estado = 'publicado'
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha <= par.h AND r.fecha <= par.h
         ORDER BY r.created_at DESC LIMIT 1
      ) rev ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.fecha FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'borrador' AND a.created_at::date <= par.h
         ORDER BY a.created_at DESC LIMIT 1
      ) bor ON true
      -- Registro del reverso que acompañó la anulación/rechazo (sin corte):
      -- es la única fecha que el sistema guarda de ese cambio de estado.
      LEFT JOIN LATERAL (
        SELECT r.created_at AS r_creado
          FROM public.conta_asientos a
          JOIN public.conta_asientos r ON r.id = a.anulado_por_id AND r.estado = 'publicado'
         WHERE e.o_cancel_por_reverso
           AND a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
         ORDER BY r.created_at DESC LIMIT 1
      ) anu ON true
      LEFT JOIN LATERAL (
        SELECT i.codigo, i.motivo FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
           AND i.created_at::date <= par.h
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1
      ) ih ON true
      LEFT JOIN LATERAL (
        SELECT i.motivo FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1
      ) ia ON true
  ),
  -- Vigencia AL CORTE. Sin fecha de anulación/rechazo conocida, un documento
  -- que hoy está anulado/rechazado no se puede situar: queda fuera (y cuenta
  -- en conta_ec_limitaciones).
  vig AS (
    SELECT s.*,
           CASE WHEN s.o_cancel IS NOT NULL AND s.o_cancel::date > s.h THEN s.o_cancel::date
                WHEN s.o_cancel_por_reverso AND s.anul_creado::date > s.h THEN s.anul_creado::date
           END AS cancelado_despues,
           -- Asiento del camino histórico (sin dimensiones), vivo al corte.
           (SELECT a.id FROM public.conta_asientos a
             WHERE NOT s.o_por_tipo
               AND a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = s.o_tabla AND a.origen_id = s.o_id
               AND a.origen_evento NOT LIKE '%\_revertido'
               AND a.estado = 'publicado' AND a.fecha <= s.h
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                                WHERE r.id = a.anulado_por_id AND r.estado = 'publicado' AND r.fecha <= s.h)
             ORDER BY a.fecha DESC, a.created_at DESC LIMIT 1) AS a_hist
      FROM ev_a s
     WHERE s.o_fecha <= s.h
       AND (s.o_cancel IS NULL OR s.o_cancel::date > s.h)
       AND (NOT s.o_cancel_por_reverso OR s.anul_creado::date > s.h)
  ),
  clas AS (
    SELECT v.*,
           CASE
             WHEN NOT v.o_por_tipo THEN 'fuera_del_auxiliar'
             WHEN v.a_saldo IS NOT NULL THEN 'cobro_sin_vinculo'
             WHEN v.a_post IS NOT NULL THEN 'contabilizado_despues'
             WHEN v.a_borr IS NOT NULL THEN 'borrador'
             ELSE 'pendiente'
           END AS k
      FROM vig v
     WHERE NOT v.o_por_tipo
        OR v.a_saldo IS NULL
        -- «pagado» SIN cobro vinculado (marcado antes de 20261004000000): el
        -- estado de cuenta no puede acreditarlo. Con cobros, el estado se
        -- deriva de ellos y sus abonos ya están en el saldo.
        OR (v.o_tabla = 'cargos_adicionales_unidad' AND v.o_estado = 'pagado'
            AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = v.o_id))
  )
  SELECT c.k, c.o_nat, c.o_tabla, c.o_id, c.o_evento, c.o_fecha, c.o_concepto, c.o_tipo,
         c.o_unidad, c.o_resp, c.o_monto, c.o_estado,
         CASE c.k
           WHEN 'contabilizado_despues' THEN 'contabilizado_despues_del_corte'
           WHEN 'pendiente' THEN
             CASE WHEN c.a_rev IS NOT NULL THEN 'asiento_reversado'
                  ELSE COALESCE(c.ih_codigo, 'sin_intento_al_corte') END
         END,
         CASE c.k
           WHEN 'fuera_del_auxiliar' THEN
             CASE WHEN c.a_hist IS NOT NULL THEN
               CASE WHEN c.o_nat = 'abono'
                 THEN 'Cobro contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.'
                 ELSE 'Contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.' END
             ELSE
               CASE WHEN c.o_nat = 'abono'
                 THEN 'Cobro de una cuota del camino histórico: no entra en este saldo.'
                 ELSE 'Anterior a la contabilización por tipo o sin clasificar: no se contabiliza retroactivamente.' END
             END
           WHEN 'cobro_sin_vinculo' THEN
             'Hoy el documento figura como pagado, pero los cargos adicionales no tienen pago vinculado: el estado de cuenta no puede acreditarlo.'
             || CASE WHEN c.historico THEN ' El documento no registra cuándo se marcó como pagado: es su estado de hoy, no necesariamente el del corte.' ELSE '' END
           WHEN 'contabilizado_despues' THEN
             'Contabilizado con fecha ' || to_char(c.a_post_fecha, 'YYYY-MM-DD')
             || ', posterior al corte: a esa fecha no estaba en el saldo. Entra al saldo en los cortes desde el '
             || to_char(c.a_post_fecha, 'YYYY-MM-DD') || '.'
           WHEN 'borrador' THEN
             CASE WHEN c.o_nat = 'abono'
               THEN 'Su asiento está en borrador: no reduce el saldo hasta publicarse.'
               ELSE 'Su asiento está en borrador: no suma al saldo hasta publicarse.' END
           ELSE
             CASE
               WHEN c.a_rev IS NOT NULL AND c.cancelado_despues IS NOT NULL THEN
                 'Al corte seguía vigente; se anuló el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD')
                 || ' y el reverso de su asiento lleva fecha contable ' || to_char(c.r_fecha, 'YYYY-MM-DD')
                 || ', no posterior al corte: no está en el saldo a esa fecha.'
               WHEN c.a_rev IS NOT NULL THEN
                 'Su asiento fue reversado con fecha ' || to_char(c.r_fecha, 'YYYY-MM-DD')
                 || ' y el documento sigue vigente: no se recrea automáticamente.'
               WHEN c.ih_codigo IS NOT NULL THEN
                 COALESCE(c.ih_motivo, 'Sin asiento contabilizado.')
               ELSE
                 'Sin intento de contabilización registrado a la fecha de corte.'
                 || COALESCE(' Motivo de hoy: ' || c.ia_motivo, '')
             END
             || CASE WHEN c.a_rev IS NULL AND c.cancelado_despues IS NOT NULL THEN
                  ' El documento se anuló después del corte, el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD') || '.'
                ELSE '' END
         END,
         a.id, a.numero, a.fecha,
         CASE WHEN c.k = 'cobro_sin_vinculo' AND c.historico THEN 'estado_actual_sin_fecha' END
    FROM clas c
    LEFT JOIN public.conta_asientos a ON a.id = CASE c.k
           WHEN 'fuera_del_auxiliar' THEN c.a_hist
           WHEN 'cobro_sin_vinculo' THEN c.a_saldo
           WHEN 'contabilizado_despues' THEN c.a_post
           WHEN 'borrador' THEN c.a_borr
           ELSE c.a_rev
         END
$$;

-- conta_ec_limitaciones: los cobros de cargos rechazados sin asiento tampoco
-- tienen fecha de rechazo.
CREATE OR REPLACE FUNCTION public.conta_ec_limitaciones(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (codigo text, documentos bigint, monto numeric, descripcion text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH cu AS (
    SELECT c.id, c.pago_id FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  rech AS (
    SELECT DISTINCT p.id, p.monto
      FROM (SELECT c.id AS cuota_id, c.pago_id, NULL::uuid AS cargo_id FROM cu c
            UNION ALL
            -- cobros de cargos adicionales (20261004000000)
            SELECT NULL, NULL, x.id FROM public.cargos_adicionales_unidad x
             WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
               AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
               AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)) d
      JOIN public.pagos p ON (p.cuota_id = d.cuota_id OR d.pago_id = p.id OR p.cargo_adicional_id = d.cargo_id)
     WHERE p.estado = 'rechazado'
       AND COALESCE(p.verified_at, p.created_at)::date <= p_hasta
       AND (p.deleted_at IS NULL OR p.deleted_at::date > p_hasta)
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id AND a.origen_evento = 'pago_contabilizado'
            AND a.anulado_por_id IS NOT NULL)
  ),
  anul AS (
    SELECT x.id, x.monto FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
       AND x.estado = 'anulado' AND x.fecha_cargo <= p_hasta
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = x.id
            AND a.origen_evento = 'cargo_adicional_emitido'
            AND a.anulado_por_id IS NOT NULL)
  )
  SELECT 'rechazo_sin_fecha'::text, count(*), sum(r.monto)::numeric(14,2),
         'Cobros HOY rechazados que nunca tuvieron asiento: el sistema no registra cuándo se rechazaron, así que no se puede saber si estaban vigentes al corte. No se listan como pendientes.'::text
    FROM rech r
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
  UNION ALL
  SELECT 'anulacion_sin_fecha', count(*), sum(n.monto)::numeric(14,2),
         'Cargos adicionales HOY anulados que nunca tuvieron asiento: el sistema no registra cuándo se anularon, así que no se puede saber si estaban vigentes al corte. No se listan como pendientes.'
    FROM anul n
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
$$;

-- conta_estado_cuenta: cuerpo idéntico a 20261003000200 salvo el rótulo
-- «· cargo X», el componente «cargo» y cargo_adicional_id del cobro.
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta(
  p_project_id uuid,
  p_cliente_id uuid    DEFAULT NULL,
  p_unidad_id  uuid    DEFAULT NULL,
  p_desde      date    DEFAULT NULL,
  p_hasta      date    DEFAULT NULL,
  p_limite     integer DEFAULT 100,
  p_offset     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_sujeto  jsonb;
  v_res     jsonb;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));

  IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_desde > p_hasta THEN
    RAISE EXCEPTION 'La fecha inicial es posterior a la final.' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
    RAISE EXCEPTION 'El tamaño de página debe estar entre 1 y 500.' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'El desplazamiento no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT jsonb_build_object('tipo', 'cliente', 'id', cl.id, 'nombre', cl.nombre,
                              'codigo_auxiliar', ax.codigo)
      INTO v_sujeto
      FROM public.clientes cl
      LEFT JOIN public.conta_auxiliares ax ON ax.company_id = v_company AND ax.cliente_id = cl.id
     WHERE cl.id = p_cliente_id;
  ELSE
    SELECT jsonb_build_object('tipo', 'unidad', 'id', u.id, 'nombre', u.nombre)
      INTO v_sujeto
      FROM public.unidades u WHERE u.id = p_unidad_id;
  END IF;

  WITH base AS (
    SELECT * FROM public.conta_ec_lineas(v_company, p_project_id, p_cliente_id, p_unidad_id) b
     WHERE p_hasta IS NULL OR b.fecha <= p_hasta
  ),
  ini AS (
    SELECT COALESCE(sum(b.debe - b.haber), 0)::numeric(14,2) AS saldo
      FROM base b WHERE p_desde IS NOT NULL AND b.fecha < p_desde
  ),
  per AS (
    SELECT b.*,
           (SELECT saldo FROM ini)
             + sum(b.debe - b.haber) OVER w AS saldo,
           row_number() OVER w AS n
      FROM base b
     WHERE p_desde IS NULL OR b.fecha >= p_desde
    WINDOW w AS (ORDER BY b.fecha, b.asiento_numero NULLS LAST, b.asiento_creado, b.asiento_id,
                          b.linea_orden, b.linea_id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  ),
  tot AS (
    SELECT count(*) AS movimientos,
           COALESCE(sum(p.debe), 0)::numeric(14,2)  AS cargos,
           COALESCE(sum(p.haber), 0)::numeric(14,2) AS abonos
      FROM per p
  ),
  por_tipo AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'tipo_cargo', t.tipo_cargo,
             'saldo_inicial', t.ini, 'cargos', t.cargos, 'abonos', t.abonos,
             'saldo_final', t.ini + t.cargos - t.abonos) ORDER BY t.tipo_cargo NULLS LAST), '[]'::jsonb) AS j
      FROM (
        SELECT b.tipo_cargo,
               COALESCE(sum(b.debe - b.haber) FILTER (WHERE p_desde IS NOT NULL AND b.fecha < p_desde), 0)::numeric(14,2) AS ini,
               COALESCE(sum(b.debe)  FILTER (WHERE p_desde IS NULL OR b.fecha >= p_desde), 0)::numeric(14,2) AS cargos,
               COALESCE(sum(b.haber) FILTER (WHERE p_desde IS NULL OR b.fecha >= p_desde), 0)::numeric(14,2) AS abonos
          FROM base b GROUP BY b.tipo_cargo
      ) t
  ),
  pagina AS (
    SELECT p.* FROM per p
     WHERE p.n > p_offset AND p.n <= p_offset + p_limite
  ),
  filas AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'n', p.n,
             'linea_id', p.linea_id,
             'asiento_id', p.asiento_id,
             'asiento_numero', p.asiento_numero,
             'fecha', p.fecha,
             'origen', p.origen,
             'documento_tabla', CASE WHEN p.origen = 'automatico' THEN p.origen_tabla END,
             'documento_id', CASE WHEN p.origen = 'automatico' THEN p.origen_id END,
             'evento', p.origen_evento,
             'documento', CASE
                WHEN p.origen <> 'automatico' THEN 'Póliza manual'
                WHEN p.origen_tabla = 'cuotas_condominio' THEN
                  COALESCE('Cuota ' || c.concepto || ' ' || c.periodo, 'Cuota')
                WHEN p.origen_tabla = 'cargos_adicionales_unidad' THEN
                  COALESCE('Cargo ' || ca.concepto, 'Cargo adicional')
                WHEN p.origen_tabla = 'pagos' THEN
                  'Pago' || COALESCE(' ' || pg.metodo, '')
                    || COALESCE(' ref. ' || NULLIF(pg.referencia, ''), '')
                    || COALESCE(' · cuota ' || cap.concepto || ' ' || cap.periodo, '')
                    || COALESCE(' · cargo ' || cag.concepto, '')
                ELSE p.origen_tabla
              END,
             'concepto', p.asiento_concepto,
             'descripcion', p.linea_descripcion,
             'tipo_cargo', p.tipo_cargo,
             'componente', CASE
                WHEN p.origen_tabla = 'pagos' AND p.origen = 'automatico' THEN
                  CASE WHEN ap.cargo_adicional_id IS NOT NULL THEN 'cargo'
                       WHEN p.tipo_cargo = 'recargo_mora' THEN 'mora' ELSE 'principal' END
                WHEN p.origen_evento LIKE 'cuota_mora%' THEN 'mora'
                WHEN p.origen_evento LIKE 'cuota_emitida%' THEN 'principal'
                WHEN p.origen_evento LIKE 'cargo_adicional_emitido%' THEN 'cargo'
              END,
             'cuota_id', ap.cuota_id,
             'cargo_adicional_id', ap.cargo_adicional_id,
             'cuenta_id', p.cuenta_id,
             'cuenta_codigo', cta.codigo,
             'cuenta_nombre', cta.nombre,
             'unidad_id', p.unidad_id,
             'unidad_nombre', un.nombre,
             'auxiliar_id', p.auxiliar_cliente_id,
             'auxiliar_nombre', cl.nombre,
             'es_reverso', p.reversa_de_id IS NOT NULL,
             'reversa_de_id', p.reversa_de_id,
             'reversa_de_numero', ro.numero,
             -- Un reverso con fecha POSTERIOR al corte no existía a esa fecha:
             -- no se presenta como reverso, se avisa aparte.
             'reversado_por_id', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.id END,
             'reversado_por_numero', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.numero END,
             'reversado_por_fecha', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.fecha END,
             'reversado_despues_del_corte', rv.id IS NOT NULL AND p_hasta IS NOT NULL AND rv.fecha > p_hasta,
             'reversado_despues_fecha', CASE WHEN rv.id IS NOT NULL AND p_hasta IS NOT NULL AND rv.fecha > p_hasta THEN rv.fecha END,
             'cargo', p.debe,
             'abono', p.haber,
             'saldo', p.saldo::numeric(14,2)
           ) ORDER BY p.n), '[]'::jsonb) AS j
      FROM pagina p
      LEFT JOIN public.conta_cuentas cta ON cta.id = p.cuenta_id
      LEFT JOIN public.unidades un ON un.id = p.unidad_id
      LEFT JOIN public.clientes cl ON cl.id = p.auxiliar_cliente_id
      LEFT JOIN public.conta_asientos ro ON ro.id = p.reversa_de_id
      LEFT JOIN public.conta_asientos rv ON rv.id = p.anulado_por_id
      LEFT JOIN public.cuotas_condominio c
        ON p.origen = 'automatico' AND p.origen_tabla = 'cuotas_condominio' AND c.id = p.origen_id
      LEFT JOIN public.cargos_adicionales_unidad ca
        ON p.origen = 'automatico' AND p.origen_tabla = 'cargos_adicionales_unidad' AND ca.id = p.origen_id
      LEFT JOIN public.pagos pg
        ON p.origen = 'automatico' AND p.origen_tabla = 'pagos' AND pg.id = p.origen_id
      LEFT JOIN LATERAL (
        SELECT x.cuota_id, x.cargo_adicional_id FROM public.conta_cobro_aplicaciones x
         WHERE p.origen = 'automatico' AND p.origen_tabla = 'pagos'
           AND x.asiento_id = COALESCE(p.reversa_de_id, p.asiento_id)
           AND (x.cargo_adicional_id IS NOT NULL
                OR x.evento = CASE WHEN p.tipo_cargo = 'recargo_mora' THEN 'cuota_mora' ELSE 'cuota_emitida' END)
         LIMIT 1
      ) ap ON true
      LEFT JOIN public.cuotas_condominio cap ON cap.id = ap.cuota_id
      LEFT JOIN public.cargos_adicionales_unidad cag ON cag.id = ap.cargo_adicional_id
  ),
  fuera_filas AS (
    SELECT * FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta)
  ),
  fuera AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'clase', f.clase, 'naturaleza', f.naturaleza, 'documentos', f.n, 'monto', f.monto)
             ORDER BY f.clase, f.naturaleza), '[]'::jsonb) AS j
      FROM (
        SELECT x.clase, x.naturaleza, count(*) AS n, sum(x.monto)::numeric(14,2) AS monto
          FROM fuera_filas x
         GROUP BY x.clase, x.naturaleza
      ) f
  ),
  -- Lo que NO se puede reconstruir al corte con los datos existentes: se dice,
  -- con cuántos documentos afecta, en vez de presentar el estado de hoy como
  -- si fuera el de entonces.
  limitaciones AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'codigo', l.codigo, 'documentos', l.documentos, 'monto', l.monto, 'descripcion', l.descripcion)
             ORDER BY l.codigo), '[]'::jsonb) AS j
      FROM (
        SELECT * FROM public.conta_ec_limitaciones(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta)
        UNION ALL
        SELECT 'estado_actual_sin_fecha', count(*), sum(x.monto)::numeric(14,2),
               'Cargos adicionales que HOY figuran como pagados: el documento no registra cuándo se marcaron, así que no se sabe si ya lo estaban al corte. Se informan con su estado de hoy.'
          FROM fuera_filas x WHERE x.limitacion = 'estado_actual_sin_fecha'
        HAVING count(*) > 0
      ) l
  )
  SELECT jsonb_build_object(
           'sujeto', v_sujeto,
           'project_id', p_project_id,
           'desde', p_desde,
           'hasta', p_hasta,
           'resumen', jsonb_build_object(
             'saldo_inicial', (SELECT saldo FROM ini),
             'cargos', tot.cargos,
             'abonos', tot.abonos,
             'saldo_final', ((SELECT saldo FROM ini) + tot.cargos - tot.abonos)::numeric(14,2),
             'movimientos', tot.movimientos),
           'por_tipo', (SELECT j FROM por_tipo),
           'fuera_de_saldo', (SELECT j FROM fuera),
           'limitaciones', (SELECT j FROM limitaciones),
           'limite', p_limite,
           'offset', p_offset,
           'movimientos', (SELECT j FROM filas))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

-- conta_estado_cuenta_conciliacion: cuerpo idéntico a 20261003000100 salvo
-- que un cobro de cargo se concilia contra su cargo y sus aplicaciones
-- descuentan del documento.
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta_conciliacion(
  p_project_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_unidad_id  uuid DEFAULT NULL,
  p_corte      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_res     jsonb;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));

  WITH lin AS (
    SELECT l.*,
           -- el asiento «raíz» de un reverso es el reversado
           COALESCE(l.reversa_de_id, l.asiento_id) AS raiz_id
      FROM public.conta_ec_lineas(v_company, p_project_id, p_cliente_id, p_unidad_id) l
     WHERE p_corte IS NULL OR l.fecha <= p_corte
  ),
  lin_doc AS (
    SELECT l.*,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_tabla
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND ap.cuota_id IS NOT NULL
               THEN 'cuotas_condominio'
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND ap.cargo_adicional_id IS NOT NULL
               THEN 'cargos_adicionales_unidad'
           END AS doc_tabla,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_id
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos'
               THEN COALESCE(ap.cuota_id, ap.cargo_adicional_id)
           END AS doc_id
      FROM lin l
      LEFT JOIN LATERAL (
        SELECT x.cuota_id, x.cargo_adicional_id FROM public.conta_cobro_aplicaciones x
         WHERE l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND x.asiento_id = l.raiz_id
         ORDER BY x.evento LIMIT 1
      ) ap ON true
  ),
  -- documentos por tipo del sujeto, por evento
  ev AS (
    SELECT 'cuotas_condominio'::text AS t, c.id, 'cuota_emitida'::text AS e, c.monto AS monto
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR c.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR c.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', COALESCE(c.mora_monto, 0)
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR c.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR c.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', x.monto
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = v_company AND x.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR x.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR x.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id)
  ),
  ev_doc AS (
    SELECT e.t, e.id, e.e,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.conta_asientos a
              WHERE a.company_id = v_company AND a.origen = 'automatico'
                AND a.origen_tabla = e.t AND a.origen_id = e.id AND a.origen_evento = e.e
                AND a.estado = 'publicado'
                AND (p_corte IS NULL OR a.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = a.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte)))
           THEN e.monto ELSE 0 END::numeric(14,2) AS devengado,
           COALESCE((
             SELECT sum(ap.monto) FROM public.conta_cobro_aplicaciones ap
               JOIN public.conta_asientos pa ON pa.id = ap.asiento_id
              WHERE ((e.t = 'cuotas_condominio' AND ap.cuota_id = e.id)
                     OR (e.t = 'cargos_adicionales_unidad' AND ap.cargo_adicional_id = e.id))
                AND ap.evento = e.e
                AND pa.estado = 'publicado'
                AND (p_corte IS NULL OR pa.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = pa.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte))
           ), 0)::numeric(14,2) AS aplicado
      FROM ev e
  ),
  doc_saldo AS (
    SELECT d.t, d.id, sum(d.devengado - d.aplicado)::numeric(14,2) AS documentos
      FROM ev_doc d GROUP BY d.t, d.id
  ),
  lin_saldo AS (
    SELECT l.doc_tabla AS t, l.doc_id AS id, sum(l.debe - l.haber)::numeric(14,2) AS contable
      FROM lin_doc l WHERE l.doc_id IS NOT NULL
     GROUP BY l.doc_tabla, l.doc_id
  ),
  disc_doc AS (
    SELECT 'documento'::text AS clase, COALESCE(d.t, s.t) AS origen_tabla, COALESCE(d.id, s.id) AS origen_id,
           NULL::uuid AS asiento_id,
           COALESCE(s.contable, 0)::numeric(14,2) AS contable,
           COALESCE(d.documentos, 0)::numeric(14,2) AS documentos
      FROM doc_saldo d
      FULL JOIN lin_saldo s ON s.t = d.t AND s.id = d.id
     WHERE COALESCE(s.contable, 0) <> COALESCE(d.documentos, 0)
  ),
  -- asientos de cobro (originales) con líneas del sujeto: sus abonos en CxC
  -- por cuenta contra sus aplicaciones por cuenta
  cobro_lin AS (
    SELECT l.asiento_id, l.cuenta_id, sum(l.haber - l.debe)::numeric(14,2) AS abonado
      FROM lin l
     WHERE l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND l.reversa_de_id IS NULL
       -- sólo cobros vivos al corte: uno reversado ya no aplica nada, y si su
       -- pago se eliminó, sus aplicaciones se fueron con él
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                        WHERE r.id = l.anulado_por_id AND r.estado = 'publicado'
                          AND (p_corte IS NULL OR r.fecha <= p_corte))
     GROUP BY l.asiento_id, l.cuenta_id
  ),
  cobro_ap AS (
    SELECT ap.asiento_id, ap.cuenta_id, sum(ap.monto)::numeric(14,2) AS aplicado
      FROM public.conta_cobro_aplicaciones ap
     WHERE ap.asiento_id IN (SELECT DISTINCT c.asiento_id FROM cobro_lin c)
     GROUP BY ap.asiento_id, ap.cuenta_id
  ),
  disc_ap AS (
    SELECT 'aplicacion'::text, 'pagos'::text,
           (SELECT a.origen_id FROM public.conta_asientos a WHERE a.id = COALESCE(c.asiento_id, x.asiento_id)),
           COALESCE(c.asiento_id, x.asiento_id),
           COALESCE(c.abonado, 0)::numeric(14,2), COALESCE(x.aplicado, 0)::numeric(14,2)
      FROM cobro_lin c
      FULL JOIN cobro_ap x ON x.asiento_id = c.asiento_id AND x.cuenta_id = c.cuenta_id
     WHERE COALESCE(c.abonado, 0) <> COALESCE(x.aplicado, 0)
  ),
  -- agrupado por el asiento raíz: un asiento y su reverso se compensan y no
  -- son una discrepancia
  disc_sin AS (
    SELECT 'sin_documento'::text, CASE WHEN l.origen = 'automatico' THEN l.origen_tabla END,
           CASE WHEN l.origen = 'automatico' THEN l.origen_id END,
           l.raiz_id, sum(l.debe - l.haber)::numeric(14,2), 0::numeric(14,2)
      FROM lin_doc l
     WHERE l.doc_id IS NULL
     GROUP BY l.origen, l.origen_tabla, l.origen_id, l.raiz_id
    HAVING sum(l.debe - l.haber) <> 0
  ),
  disc AS (
    SELECT * FROM disc_doc
    UNION ALL SELECT * FROM disc_ap
    UNION ALL SELECT * FROM disc_sin
  ),
  por_cuenta AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cuenta_id', q.cuenta_id, 'codigo', c.codigo, 'nombre', c.nombre, 'saldo', q.saldo)
             ORDER BY c.codigo), '[]'::jsonb) AS j
      FROM (SELECT l.cuenta_id, sum(l.debe - l.haber)::numeric(14,2) AS saldo
              FROM lin l GROUP BY l.cuenta_id) q
      JOIN public.conta_cuentas c ON c.id = q.cuenta_id
  ),
  tot AS (
    SELECT (SELECT COALESCE(sum(l.debe - l.haber), 0) FROM lin l)::numeric(14,2) AS contable,
           (SELECT COALESCE(sum(d.documentos), 0) FROM doc_saldo d)::numeric(14,2) AS documentos
  )
  SELECT jsonb_build_object(
           'corte', p_corte,
           'saldo_contable', tot.contable,
           'saldo_documentos', tot.documentos,
           'diferencia', (tot.contable - tot.documentos)::numeric(14,2),
           'cuadra', tot.contable = tot.documentos AND NOT EXISTS (SELECT 1 FROM disc),
           'por_cuenta', (SELECT j FROM por_cuenta),
           'total_discrepancias', (SELECT count(*) FROM disc),
           'discrepancias', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'clase', d.clase, 'origen_tabla', d.origen_tabla, 'origen_id', d.origen_id,
                      'asiento_id', d.asiento_id, 'asiento_numero', a.numero,
                      'contable', d.contable, 'documentos', d.documentos,
                      'diferencia', (d.contable - d.documentos)::numeric(14,2))
                      ORDER BY d.clase, d.origen_tabla, d.origen_id, d.asiento_id)
               FROM (SELECT * FROM disc ORDER BY clase, origen_tabla, origen_id, asiento_id LIMIT 200) d
               LEFT JOIN public.conta_asientos a ON a.id = d.asiento_id), '[]'::jsonb))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

-- ── 16. Permisos de ejecución (CREATE OR REPLACE los conserva; se reafirman) ─
REVOKE EXECUTE ON FUNCTION public.conta_tg_pagos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_un_cobro(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_ec_limitaciones(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) TO authenticated;

COMMENT ON FUNCTION public.conta_reprocesar_cargo(text, uuid) IS
  'Reprocesa la contabilización de UNA cuota clasificada o UN cargo adicional (y después sus cobros pendientes, en orden), o UN cobro por tipo (de cuota o de cargo) sin asiento. Bloquea el documento antes que sus cobros, exige platform.contabilidad.create y change_status, no re-fecha en período cerrado, no recrea asientos reversados, no contabiliza documentos sin intento previo y usa la misma lógica que la emisión.';
COMMENT ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) IS
  'Bandeja de cuotas clasificadas, cargos adicionales y cobros por tipo (de cuotas y de cargos adicionales) con un evento contable SIN asiento y con al menos un intento, de la contabilidad indicada, acotada a la empresa de la sesión y a los proyectos del usuario. Filtro por motivo y búsqueda, paginada en servidor.';
