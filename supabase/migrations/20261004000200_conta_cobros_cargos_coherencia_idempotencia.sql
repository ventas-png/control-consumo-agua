-- ============================================================================
-- CORRECTIVA DE 20261004000000/0100: COHERENCIA ENTRE CARGO Y DEVENGO, E
-- IDEMPOTENCIA DEL CONTENIDO COMPLETO DE UN COBRO DE CARGO
--
-- 20261004000000 y 20261004000100 ya están aplicadas (sandbox); no se
-- reescriben.
--
-- 1. COHERENCIA CARGO ↔ DEVENGO. Un cargo por tipo devenga al emitirse con
--    su importe de ese momento. Si después se modifica (sin cobros vivos el
--    guard lo permite) el devengo NO se recalcula: el cargo dice 150 y la
--    CxC 100. Antes, un cobro de 100 se aplicaba contra la CxC y el cargo
--    quedaba «pagado» debiendo 50. Ahora:
--      · `conta_cargo_coherencia_devengo` compara el importe del cargo con el
--        de su devengo vigente EN LA MISMA MONEDA (la del documento: el
--        importe de origen de la línea de CxC y su moneda, contra el importe
--        del cargo y la moneda vigente del proyecto). Moneda distinta o
--        importe distinto → `devengo_desalineado`, con un motivo accionable;
--      · el alta de un cobro se RECHAZA (COBRO_CARGO_DESALINEADO) sin escribir
--        nada: dejar el cobro vivo bloquearía corregir el importe;
--      · la contabilización de un cobro ya registrado queda PENDIENTE con ese
--        código (defensa en profundidad: con cobros vivos el importe no
--        cambia, pero sí puede cambiar la moneda del proyecto);
--      · el estado derivado nunca es «pagado» mientras no concuerden;
--      · el resumen de Condominios expone código y motivo.
--    No hay redevengo automático ni se alteran asientos publicados.
--
-- 2. IDEMPOTENCIA DEL CONTENIDO. La misma clave (`p_pago_id`) con los mismos
--    datos —importe, método, fecha, referencia y notas, normalizados como en
--    el alta— devuelve el cobro ya registrado; con datos distintos se rechaza
--    (COBRO_CARGO_CLAVE_REUSADA, diciendo qué campos difieren) y NO se
--    devuelve como éxito el anterior. La misma clave usada a la vez en dos
--    cargos también se rechaza así (antes era un error de clave primaria).
--
-- De paso, el saldo de un cargo para sus cobros usa el importe del devengo en
-- la moneda del documento (el importe de origen de la línea, si lo hay), que
-- es la de los cobros: los importes que se restan están en la misma moneda.
--
-- CÓMO SE REVIERTE (en este orden): restaurar conta_cargo_saldo_cobro,
-- conta_cargo_estado_derivado, conta_contabilizar_cobro_cargo_interno y
-- conta_registrar_cobro_cargo desde 20261004000000; DROP FUNCTION
-- conta_cargos_cobro_resumen(uuid) y recrearla desde 20261004000000 (con su
-- REVOKE/GRANT/COMMENT); DROP FUNCTION conta_cargo_coherencia_devengo; y, sólo
-- si ningún intento usa 'devengo_desalineado', restaurar
-- conta_intentos_codigo_valido desde 20261002000100.
-- ============================================================================

-- ── 1. Bitácora: el código nuevo ────────────────────────────────────────────
ALTER TABLE public.conta_intentos_contabilizacion
  DROP CONSTRAINT conta_intentos_codigo_valido,
  ADD CONSTRAINT conta_intentos_codigo_valido
    CHECK (codigo IS NULL OR codigo IN (
      'sin_cuenta','cuenta_invalida','configuracion_incompleta','reparto_lineas',
      'periodo_cerrado','documento_anulado','documento_no_aprobado',
      'asiento_reversado','error',
      'sin_configuracion','sin_responsable',
      'devengo_pendiente','excede_saldo','cobro_anterior_pendiente',
      'devengo_desalineado'));

-- ── 2. Saldo de un cargo para sus cobros (INTERNA) ──────────────────────────
-- Idéntica a 20261004000000 salvo `devengo_monto`: el importe de la línea de
-- CxC en la moneda del DOCUMENTO (monto_origen si el asiento se convirtió),
-- que es la moneda de los cobros y de sus aplicaciones.
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
  SELECT d.asiento_id, d.estado, d.monto_doc, d.cuenta_id, d.auxiliar_cliente_id, d.unidad_id, d.tipo_cargo,
         COALESCE((
           SELECT sum(ap.monto)
             FROM public.conta_cobro_aplicaciones ap
             JOIN public.conta_asientos a ON a.id = ap.asiento_id
            WHERE ap.cargo_adicional_id = p_cargo_id
              AND (p_excluir_pago IS NULL OR ap.pago_id <> p_excluir_pago)
              AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL), 0)::numeric(14,2)
    FROM (SELECT 1) uno
    LEFT JOIN LATERAL (
      SELECT a.id AS asiento_id, a.estado, COALESCE(l.monto_origen, l.debe)::numeric(14,2) AS monto_doc,
             l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo
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
  'INTERNA. Devengo vivo de un cargo adicional (línea de CxC con sus dimensiones; importe en la moneda del documento) y lo aplicado por sus cobros con asiento vivo.';

-- ── 3. ¿El cargo concuerda con su devengo vigente? (INTERNA) ────────────────
-- Una fila siempre (si el cargo existe). `codigo` NULL: concuerda o todavía
-- no hay devengo vivo (de eso se ocupa `devengo_pendiente`). `p_monto`
-- permite evaluar un importe propuesto (el guard, con NEW.monto).
CREATE OR REPLACE FUNCTION public.conta_cargo_coherencia_devengo(
  p_cargo_id uuid,
  p_monto    numeric DEFAULT NULL
)
RETURNS TABLE (
  codigo         text,
  motivo         text,
  cargo_monto    numeric,
  cargo_moneda   text,
  devengo_monto  numeric,
  devengo_moneda text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (
    SELECT COALESCE(p_monto, ca.monto)::numeric(14,2) AS monto,
           public.conta_moneda_base(ca.company_id, ca.project_id) AS moneda
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = p_cargo_id
  ), d AS (
    SELECT COALESCE(l.monto_origen, l.debe)::numeric(14,2) AS monto,
           COALESCE(public.conta_normalizar_moneda(l.moneda_origen),
                    public.conta_normalizar_moneda(a.moneda_base)) AS moneda
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
  )
  SELECT
    CASE WHEN d.monto IS NULL THEN NULL
         WHEN c.moneda IS DISTINCT FROM d.moneda OR c.monto <> d.monto THEN 'devengo_desalineado'
    END,
    CASE WHEN d.monto IS NULL THEN NULL
         WHEN c.moneda IS DISTINCT FROM d.moneda THEN
           format('El cargo está en %s y su devengo vigente en %s: los importes no se comparan entre monedas distintas. '
                  'No se aplican cobros ni se marca pagado. Anula el cargo y emítelo de nuevo en la moneda vigente del proyecto.',
                  COALESCE(c.moneda, '¿?'), COALESCE(d.moneda, '¿?'))
         WHEN c.monto <> d.monto THEN
           format('El importe del cargo (%s %s) no coincide con su devengo vigente (%s %s): el cargo se modificó después de contabilizarse y el devengo no se recalcula solo. '
                  'No se aplican cobros ni se marca pagado. Restablece el importe del cargo a %s %s, o anula el cargo y emite uno nuevo por el importe correcto.',
                  c.monto, c.moneda, d.monto, d.moneda, d.monto, d.moneda)
    END,
    c.monto, c.moneda, d.monto, d.moneda
  FROM c LEFT JOIN d ON true
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_coherencia_devengo(uuid, numeric) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_cargo_coherencia_devengo(uuid, numeric) IS
  'INTERNA. ¿El importe del cargo (o p_monto) concuerda, en la misma moneda, con el de su devengo vigente? devengo_desalineado con motivo accionable si no; NULL si concuerda o aún no hay devengo vivo.';

-- ── 4. Estado derivado: nunca «pagado» si el cargo no concuerda ─────────────
-- Idéntica a 20261004000000 salvo la condición de coherencia.
CREATE OR REPLACE FUNCTION public.conta_cargo_estado_derivado(p_cargo_id uuid, p_monto numeric DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = p_cargo_id)
      THEN NULL
    WHEN (SELECT k.codigo FROM public.conta_cargo_coherencia_devengo(p_cargo_id, p_monto) k) IS NOT NULL
      THEN 'pendiente'
    WHEN s.aplicado > 0
     AND s.aplicado >= COALESCE(s.devengo_monto, p_monto,
                                (SELECT ca.monto FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_cargo_id))
      THEN 'pagado'
    ELSE 'pendiente'
  END
  FROM public.conta_cargo_saldo_cobro(p_cargo_id) s
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargo_estado_derivado(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- ── 5. Contabilizar un cobro de cargo (INTERNA) ─────────────────────────────
-- Idéntica a 20261004000000 salvo el paso c') (coherencia con el devengo).
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
  v_coh      record;
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

  -- c') El cargo concuerda con su devengo vigente: mismo importe, en la misma
  --     moneda (20261004000200). Si el cargo se modificó después de
  --     devengarse, el cobro no se aplica: el devengo no se recalcula solo ni
  --     se tocan asientos publicados.
  IF v_codigo IS NULL THEN
    SELECT k.codigo, k.motivo INTO v_coh FROM public.conta_cargo_coherencia_devengo(v_cargo.id) k;
    IF v_coh.codigo IS NOT NULL THEN
      v_codigo := v_coh.codigo;
      v_motivo := v_coh.motivo;
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
  'INTERNA. Contabiliza el cobro de un cargo adicional por tipo contra la CxC y dimensiones de su devengo: cargo a la cuenta del método, abono a la CxC. Pendiente visible si falta el devengo publicado, si el cargo no concuerda con su devengo (importe o moneda), si un cobro anterior está pendiente, si excede el saldo o si falta la cuenta del método. Candado por cargo; idempotente; deriva el estado del cargo.';

-- ── 6. RPC: registrar un cobro de cargo ─────────────────────────────────────
-- Idéntica a 20261004000000 salvo: la idempotencia compara el contenido
-- completo; el alta se rechaza si el cargo no concuerda con su devengo; y la
-- misma clave usada a la vez en otro cargo se informa como clave reusada.
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
  v_coh      record;
  v_difiere  text[];
  v_cons     text;
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

  -- Idempotencia del CONTENIDO COMPLETO (20261004000200): la misma clave con
  -- los mismos datos devuelve el cobro ya registrado; con datos distintos se
  -- rechaza explícitamente y NO se devuelve como éxito el cobro anterior.
  -- Normalización: la misma del alta (importe exacto, referencia y notas sin
  -- espacios sobrantes y vacías = sin dato; la fecha es la del cobro).
  SELECT * INTO v_existe FROM public.pagos p WHERE p.id = v_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.cargo_adicional_id IS DISTINCT FROM v_cargo.id THEN
      -- De otro cargo (o de otro documento): no se describe lo ajeno.
      RAISE EXCEPTION 'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica otro cobro. No se registró nada: usa una clave nueva.'
        USING ERRCODE = '23505';
    END IF;
    v_difiere := array_remove(ARRAY[
      CASE WHEN v_existe.monto IS DISTINCT FROM p_monto THEN 'importe' END,
      CASE WHEN v_existe.metodo IS DISTINCT FROM p_metodo THEN 'método' END,
      CASE WHEN COALESCE(v_existe.verified_at, v_existe.created_at)::date IS DISTINCT FROM p_fecha THEN 'fecha' END,
      CASE WHEN NULLIF(btrim(COALESCE(v_existe.referencia, '')), '')
                IS DISTINCT FROM NULLIF(btrim(COALESCE(p_referencia, '')), '') THEN 'referencia' END,
      CASE WHEN NULLIF(btrim(COALESCE(v_existe.notas, '')), '')
                IS DISTINCT FROM NULLIF(btrim(COALESCE(p_notas, '')), '') THEN 'notas' END], NULL);
    IF cardinality(v_difiere) > 0 THEN
      RAISE EXCEPTION 'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica un cobro de este cargo registrado con otros datos (difiere: %). No se registró otro cobro ni se modificó el anterior. Revisa los cobros del cargo: si el anterior es correcto, no hace falta nada; si falta otro cobro, regístralo como cobro nuevo.',
        array_to_string(v_difiere, ', ') USING ERRCODE = '23505';
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
    -- El cargo concuerda con su devengo vigente (20261004000200). Se rechaza
    -- el alta —nada queda escrito— en lugar de dejar un cobro pendiente: con
    -- un cobro vivo el importe del cargo ya no se podría corregir.
    SELECT k.codigo, k.motivo INTO v_coh FROM public.conta_cargo_coherencia_devengo(v_cargo.id) k;
    IF v_coh.codigo IS NOT NULL THEN
      RAISE EXCEPTION 'COBRO_CARGO_DESALINEADO: %', v_coh.motivo USING ERRCODE = 'check_violation';
    END IF;

    -- La hora conserva el orden de registro dentro del mismo día.
    v_ts := CASE WHEN p_fecha = CURRENT_DATE THEN now()
                 ELSE (p_fecha + (now() - date_trunc('day', now())))::timestamptz END;
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id);

    -- Misma clave en dos cargos a la vez: cada llamada bloqueó SU cargo, así
    -- que la segunda choca con la clave primaria. También es clave reusada.
    BEGIN
      PERFORM set_config('conta.cobro_cargo_pago', v_id::text, true);
      INSERT INTO public.pagos (
        id, cliente_id, project_id, cargo_adicional_id, monto, metodo, referencia, notas,
        estado, verification_status, verified_at, verified_by, created_by, created_at, tipo_aplicacion)
      VALUES (
        v_id, v_cargo.responsable_cliente_id, v_cargo.project_id, v_cargo.id, p_monto, p_metodo,
        NULLIF(btrim(COALESCE(p_referencia, '')), ''), NULLIF(btrim(COALESCE(p_notas, '')), ''),
        'verificado', 'verificado', v_ts, auth.uid(), auth.uid(), v_ts,
        CASE WHEN p_monto >= COALESCE(v_s.devengo_monto, v_cargo.monto) - v_s.aplicado THEN 'pago_total' ELSE 'abono' END);
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
      IF v_cons = 'pagos_pkey' THEN
        RAISE EXCEPTION 'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica otro cobro. No se registró nada: usa una clave nueva.'
          USING ERRCODE = '23505';
      END IF;
      RAISE;
    END;
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
  'Registra en back-office un cobro YA VERIFICADO de un cargo adicional por tipo y lo contabiliza contra la CxC de su devengo. Empresa, proyecto, unidad y responsable histórico salen del cargo (bloqueado). Admite cobros parciales y varios por cargo; un excedente queda pendiente con su motivo. Rechaza el alta si el cargo no concuerda con su devengo. Idempotente por p_pago_id sobre el contenido completo: mismos datos devuelven el mismo cobro; datos distintos se rechazan (COBRO_CARGO_CLAVE_REUSADA).';

-- ── 7. Resumen para Condominios: con la coherencia ──────────────────────────
-- Cambia el tipo de retorno (columnas nuevas): DROP y CREATE. Sólo la usa la
-- pantalla de Cargos adicionales.
DROP FUNCTION public.conta_cargos_cobro_resumen(uuid);

CREATE FUNCTION public.conta_cargos_cobro_resumen(p_project_id uuid)
RETURNS TABLE (
  cargo_id          uuid,
  por_tipo          boolean,
  devengo_estado    text,
  devengado         numeric,
  aplicado          numeric,
  en_proceso        numeric,
  saldo             numeric,
  cobros            bigint,
  pagado_sin_cobro  boolean,
  cargo_monto       numeric,
  moneda            text,
  devengo_moneda    text,
  coherencia_codigo text,
  coherencia_motivo text
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
         (ca.estado = 'pagado' AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = ca.id)),
         k.cargo_monto,
         k.cargo_moneda,
         k.devengo_moneda,
         CASE WHEN ca.estado <> 'anulado' THEN k.codigo END,
         CASE WHEN ca.estado <> 'anulado' THEN k.motivo END
    FROM public.cargos_adicionales_unidad ca
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = ca.id) AS por_tipo) t
    CROSS JOIN LATERAL public.conta_cargo_saldo_cobro(ca.id) s
    CROSS JOIN LATERAL public.conta_cargo_coherencia_devengo(ca.id) k
   WHERE ca.company_id = v_company AND ca.project_id = p_project_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargos_cobro_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargos_cobro_resumen(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_cargos_cobro_resumen(uuid) IS
  'Por cargo adicional del proyecto: si es por tipo, estado del devengo, devengado, aplicado por cobros vivos, cobros pendientes de contabilizar, saldo, si figura pagado sin cobro (histórico), importe y moneda del cargo, moneda del devengo y, si no concuerdan, devengo_desalineado con su motivo.';
