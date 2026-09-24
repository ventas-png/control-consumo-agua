-- ============================================================================
-- CORRECTIVA DE 20261002000100: BLOQUEO Y REVALIDACIÓN DEL PAGO ANTES DE
-- CONTABILIZAR SU COBRO
--
-- 20261002000000 y 20261002000100 ya están aplicadas (sandbox); no se
-- reescriben.
--
-- EL DEFECTO. El reproceso desde una CUOTA elegía sus cobros pendientes y los
-- contabilizaba sin bloquear la fila del pago. El candado por cuota
-- (pg_advisory_xact_lock) sólo serializa a quienes contabilizan; rechazar o
-- borrar un pago no lo toma. Así:
--   · el reproceso leía el pago «verificado» (versión confirmada) mientras
--     otra transacción lo rechazaba o borraba sin confirmar todavía;
--   · el trigger del rechazo no encontraba asiento que reversar (aún no
--     existía) y confirmaba;
--   · el reproceso confirmaba después un asiento de cobro VIVO, con su
--     aplicación descontando saldo, sobre un pago rechazado o eliminado.
--
-- LA CORRECCIÓN. Todo camino que contabiliza un cobro BLOQUEA la fila del pago
-- (FOR UPDATE) y la REVALIDA ya bloqueada: existe, no está borrado y sigue
-- verificado/aplicado. Si no, no se contabiliza. Un rechazo o borrado
-- concurrente espera a que el cobro se confirme y entonces su trigger lo
-- reversa, o se confirma primero y el cobro ya no se contabiliza.
--
-- ORDEN ÚNICO DE BLOQUEOS (para no provocar deadlocks):
--     fila de la cuota  →  filas de sus pagos (por id)  →  candado de cobros
--   · reproceso de cuota: bloquea la cuota, luego TODOS sus cobros pendientes
--     por id, y recién después contabiliza (candado); sólo contabiliza los
--     pagos que tiene bloqueados;
--   · reproceso de un cobro: bloquea el pago y luego el candado;
--   · trigger de pagos (verificación/alta): la fila del pago ya está tomada
--     por el propio UPDATE/INSERT; luego el candado;
--   · rechazo o borrado: sólo la fila del pago.
--   Nadie espera una fila de pago teniendo el candado de cobros.
--
-- CÓMO SE REVIERTE: restaurar conta_contabilizar_cobro_interno y
-- conta_reprocesar_cargo desde 20261002000100.
-- ============================================================================

-- ── 1. Contabilizar un cobro: bloquea y revalida el pago ──────────────────────
-- Cuerpo idéntico a 20261002000100 salvo el bloqueo de la fila del pago al
-- principio y la revalidación tras el candado.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cobro_interno(
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
  v_pago        public.pagos;
  v_cuota       public.cuotas_condominio;
  v_cuota_id    uuid;
  v_company     uuid;
  v_project     uuid;
  v_ts          timestamptz;
  v_asiento     uuid;
  v_intento     uuid;
  v_codigo      text;
  v_motivo      text;
  v_prev_mora   numeric(14,2);
  v_prev_princ  numeric(14,2);
  v_mora        numeric(14,2);
  v_a_mora      numeric(14,2);
  v_a_princ     numeric(14,2);
  v_exceso      numeric(14,2);
  v_lm          record;
  v_lp          record;
  v_estado_dev  text;
  v_cta_mora    uuid;
  v_cta_princ   uuid;
  v_metodo      text;
  v_moneda      text;
  v_lineas      jsonb;
BEGIN
  IF p_disparo NOT IN ('cobro','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  -- 1) LA FILA DEL PAGO, antes que nada (orden: pago → candado). Si otra
  --    transacción lo está rechazando o borrando, se espera aquí y se ve el
  --    resultado confirmado.
  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_inexistente'::text,
      'El cobro ya no existe: no se contabiliza.'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_cuota_id := public.conta_cobro_cuota_por_tipo(p_pago_id);
  IF v_cuota_id IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_interno: el pago % no es de una cuota contabilizada por tipo', p_pago_id
      USING ERRCODE = '22023';
  END IF;

  -- CANDADO POR CUOTA, antes de leer saldos: dos cobros de la misma cuota (o
  -- un cobro y el reproceso de su cuota) se contabilizan uno detrás del otro.
  PERFORM pg_advisory_xact_lock(hashtext('conta_cobro_cuota'), hashtext(v_cuota_id::text));

  SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = v_cuota_id;
  v_company := v_cuota.company_id;
  v_project := v_cuota.project_id;
  v_ts      := COALESCE(v_pago.verified_at, v_pago.created_at, now());

  -- 2) REVALIDACIÓN con la fila bloqueada: un pago rechazado o borrado no se
  --    contabiliza, llegue por el camino que llegue.
  IF v_pago.deleted_at IS NOT NULL OR v_pago.estado NOT IN ('verificado','aplicado') THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'bloqueada', 'documento_anulado',
      'El cobro fue rechazado o eliminado antes de contabilizarse: no se contabiliza.', '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_anulado'::text,
      'El cobro fue rechazado o eliminado antes de contabilizarse: no se contabiliza.'::text, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ¿Ya tiene su asiento? (idempotencia; se relee DESPUÉS del candado)
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = 'pagos' AND a.origen_id = v_pago.id
     AND a.origen_evento = 'pago_contabilizado'
     AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
   ORDER BY a.created_at DESC LIMIT 1;
  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- ── Diagnóstico, en orden: el primer motivo manda ────────────────────────
  -- a) Un cobro ANTERIOR de la misma cuota sigue pendiente: el reparto de éste
  --    depende de aquél.
  IF EXISTS (
    SELECT 1 FROM public.pagos p2
     WHERE p2.id <> v_pago.id
       AND (p2.cuota_id = v_cuota.id OR p2.id = v_cuota.pago_id)
       AND p2.deleted_at IS NULL AND p2.estado IN ('verificado','aplicado')
       AND (COALESCE(p2.verified_at, p2.created_at), p2.id) < (v_ts, v_pago.id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                        WHERE a.company_id = v_company AND a.origen = 'automatico'
                          AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                          AND a.origen_evento = 'pago_contabilizado'
                          AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
  ) THEN
    v_codigo := 'cobro_anterior_pendiente';
    v_motivo := 'Otro cobro anterior de la misma cuota sigue pendiente y el reparto entre mora y principal depende del orden. Reprocesa la cuota: contabiliza sus cobros en orden.';
  END IF;

  -- b) Saldos: lo ya aplicado por cobros anteriores con asiento vivo. Los
  --    cobros de la cuota contabilizados por el camino histórico (antes de que
  --    la cuota entrara a la contabilización por tipo) cuentan como principal.
  IF v_codigo IS NULL THEN
    SELECT COALESCE(sum(ap.monto) FILTER (WHERE ap.evento = 'cuota_mora'), 0),
           COALESCE(sum(ap.monto) FILTER (WHERE ap.evento = 'cuota_emitida'), 0)
      INTO v_prev_mora, v_prev_princ
      FROM public.conta_cobro_aplicaciones ap
      JOIN public.conta_asientos a ON a.id = ap.asiento_id
     WHERE ap.cuota_id = v_cuota.id AND ap.pago_id <> v_pago.id
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL;

    v_prev_princ := v_prev_princ + COALESCE((
      SELECT sum(p2.monto) FROM public.pagos p2
       WHERE p2.id <> v_pago.id
         AND (p2.cuota_id = v_cuota.id OR p2.id = v_cuota.pago_id)
         AND EXISTS (SELECT 1 FROM public.conta_asientos a
                      WHERE a.company_id = v_company AND a.origen = 'automatico'
                        AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                        AND a.origen_evento = 'pago_contabilizado'
                        AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.conta_cobro_aplicaciones ap WHERE ap.pago_id = p2.id)
    ), 0);

    -- La mora cuenta sólo si ya existía cuando se cobró.
    v_mora := CASE WHEN COALESCE(v_cuota.mora_monto, 0) > 0
                    AND COALESCE(v_cuota.mora_aplicada_at, '-infinity'::timestamptz) <= v_ts
                   THEN v_cuota.mora_monto ELSE 0 END;

    -- MORA PRIMERO, luego principal.
    v_a_mora  := LEAST(v_pago.monto, GREATEST(v_mora - v_prev_mora, 0));
    v_a_princ := LEAST(v_pago.monto - v_a_mora, GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0));
    v_exceso  := v_pago.monto - v_a_mora - v_a_princ;

    IF v_exceso > 0.005 THEN
      v_codigo := 'excede_saldo';
      v_motivo := format('El cobro (%s) supera el saldo pendiente de la cuota: mora %s y principal %s. No se contabiliza un excedente sin cuenta decidida; corrige el cobro y reprocesa.',
                         v_pago.monto, GREATEST(v_mora - v_prev_mora, 0),
                         GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0));
    ELSIF COALESCE(v_pago.monto, 0) <= 0 THEN
      v_codigo := 'error';
      v_motivo := 'El cobro no tiene importe que contabilizar.';
    END IF;
  END IF;

  -- c) El devengo de cada evento que el cobro toca: publicado y vivo. Su
  --    línea de cargo da la cuenta y las dimensiones del abono.
  IF v_codigo IS NULL AND v_a_mora > 0 THEN
    SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo, a.estado AS estado INTO v_lm
      FROM public.conta_asientos a
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     WHERE a.company_id = v_company AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_cuota.id
       AND a.origen_evento = 'cuota_mora'
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
     ORDER BY l.orden LIMIT 1;
    v_estado_dev := v_lm.estado;
    v_cta_mora   := v_lm.cuenta_id;
    IF v_cta_mora IS NULL OR v_estado_dev <> 'publicado' THEN
      v_codigo := 'devengo_pendiente';
      v_motivo := CASE WHEN v_estado_dev = 'borrador'
        THEN 'El devengo de la mora de esta cuota está en borrador. Publícalo en Pólizas y reprocesa el cobro.'
        ELSE 'La mora de esta cuota todavía no está contabilizada. Resuelve su pendiente y reprocesa la cuota: el cobro se contabiliza después.' END;
    END IF;
  END IF;

  IF v_codigo IS NULL AND v_a_princ > 0 THEN
    SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo, a.estado AS estado INTO v_lp
      FROM public.conta_asientos a
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     WHERE a.company_id = v_company AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_cuota.id
       AND a.origen_evento = 'cuota_emitida'
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
     ORDER BY l.orden LIMIT 1;
    v_estado_dev := v_lp.estado;
    v_cta_princ  := v_lp.cuenta_id;
    IF v_cta_princ IS NULL OR v_estado_dev <> 'publicado' THEN
      v_codigo := 'devengo_pendiente';
      v_motivo := CASE WHEN v_estado_dev = 'borrador'
        THEN 'El devengo de esta cuota está en borrador. Publícalo en Pólizas y reprocesa el cobro.'
        ELSE 'Esta cuota todavía no está contabilizada. Resuelve su pendiente y reprocesa la cuota: el cobro se contabiliza después.' END;
    END IF;
  END IF;

  -- d) La cuenta del método de pago (mapeo del ledger, como cualquier cobro).
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
  IF v_codigo IS NULL AND public.conta_cuenta_para(v_company, v_project, v_metodo) IS NULL THEN
    v_codigo := 'sin_cuenta';
    v_motivo := format('Falta la cuenta del método de pago (%s) en el mapeo de esta contabilidad. Configúrala y reprocesa el cobro.', v_metodo);
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_cobro_interno: pago % pendiente (%) — asiento omitido', v_pago.id, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ── El asiento: cargo a la cuenta del método, abono a la mora y luego al
  --    principal, cada uno con la cuenta y las dimensiones de su devengo ─────
  v_lineas := jsonb_build_array(
    jsonb_build_object('evento', v_metodo, 'debe', v_pago.monto, 'descripcion', 'Cobro'));
  IF v_a_mora > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_lm.cuenta_id, 'haber', v_a_mora, 'descripcion', 'Aplicación a mora',
      'auxiliar_cliente_id', v_lm.auxiliar_cliente_id, 'unidad_id', v_lm.unidad_id, 'tipo_cargo', v_lm.tipo_cargo));
  END IF;
  IF v_a_princ > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_lp.cuenta_id, 'haber', v_a_princ, 'descripcion', 'Aplicación a principal',
      'auxiliar_cliente_id', v_lp.auxiliar_cliente_id, 'unidad_id', v_lp.unidad_id, 'tipo_cargo', v_lp.tipo_cargo));
  END IF;

  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_project;

  v_asiento := public.conta_generar_asiento(
    v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado',
    COALESCE(v_pago.verified_at, v_pago.created_at)::date,
    'Pago ' || v_pago.metodo || COALESCE(' ref. ' || NULLIF(v_pago.referencia, ''), ''),
    'ingreso', v_moneda, v_lineas);

  IF v_asiento IS NOT NULL THEN
    INSERT INTO public.conta_cobro_aplicaciones
      (company_id, project_id, pago_id, cuota_id, evento, monto, cuenta_id, asiento_id)
    SELECT v_company, v_project, v_pago.id, v_cuota.id, x.evento, x.monto, x.cuenta_id, v_asiento
      FROM (VALUES ('cuota_mora', v_a_mora, v_cta_mora),
                   ('cuota_emitida', v_a_princ, v_cta_princ)) AS x(evento, monto, cuenta_id)
     WHERE x.monto > 0;

    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'contabilizada', NULL, NULL,
      jsonb_build_array(jsonb_build_object('mora', v_a_mora, 'principal', v_a_princ)), v_asiento);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento del cobro. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento del cobro.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cobro_interno(uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_cobro_interno(uuid, text) IS
  'INTERNA. Bloquea y revalida el pago, y contabiliza el cobro de una cuota por tipo: mora primero, luego principal, cada porción contra la cuenta y dimensiones de su devengo. Pendiente visible si falta un devengo, si un cobro anterior está pendiente o si excede el saldo. Candado por cuota.';

-- ── 2. Reproceso de cuota: bloquea sus cobros pendientes antes de contabilizar ───
-- Cuerpo idéntico a 20261002000100 salvo el bloqueo previo de los cobros
-- pendientes (por id) y la contabilización restringida a los bloqueados.
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

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_reprocesar_cargo(text, uuid) IS
  'Reprocesa la contabilización de UNA cuota clasificada (y después sus cobros pendientes, en orden), UN cargo adicional o UN cobro de cuota por tipo sin asiento. Bloquea la fila (y, en una cuota, las de sus cobros pendientes antes de contabilizarlos), exige platform.contabilidad.create y change_status, no re-fecha en período cerrado, no recrea asientos reversados, no contabiliza documentos sin intento previo y usa la misma lógica que la emisión.';

