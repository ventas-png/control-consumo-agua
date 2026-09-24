-- ============================================================================
-- CORRECTIVA DE 20261002000000: COBROS DE CUOTAS POR TIPO Y FECHA DE LA MORA
--
-- 20261002000000 ya está aplicada (sandbox); no se reescribe. Esta migración
-- corrige tres hallazgos de su revisión:
--
-- 1 · COBRO SIN DEVENGO PUBLICADO. El pago de una cuota contabilizada por tipo
--     buscaba el devengo publicado y, si no lo encontraba (pendiente de
--     configuración, en borrador…), caía EN SILENCIO al mapeo general
--     (cxc_cuotas, o ingreso_otros si el pago sólo tenía cuota_id). Ahora:
--       · un cobro de una cuota que ENTRÓ a la contabilización por tipo (tiene
--         intentos registrados) nunca usa el mapeo general;
--       · si falta el devengo que el cobro necesita, el cobro queda PENDIENTE
--         visible («devengo_pendiente») en la bandeja, con su motivo;
--       · al reprocesar la cuota, sus cobros pendientes se contabilizan después
--         de los devengos, en orden cronológico; también se reprocesan uno a
--         uno desde la bandeja. Un cobro = un asiento vivo (índice único de
--         origen), bajo un candado por cuota.
--
-- 2 · REPARTO ENTRE PRINCIPAL Y MORA. Regla de aplicación decidida por el
--     negocio: MORA PRIMERO, luego principal. Cada porción abona la cuenta por
--     cobrar y las dimensiones (auxiliar, unidad, tipo) de la línea de cargo
--     del devengo de SU evento, sean la misma cuenta o distintas. Abonos
--     parciales: el saldo de cada evento se descuenta de lo ya aplicado por
--     cobros anteriores, que queda registrado en conta_cobro_aplicaciones.
--     Excedente sobre el saldo: el cobro NO se contabiliza y queda pendiente
--     («excede_saldo»), también decisión del negocio. Una mora aplicada DESPUÉS
--     del cobro no absorbe ese cobro. Un cobro no se contabiliza mientras otro
--     ANTERIOR de la misma cuota siga pendiente («cobro_anterior_pendiente»):
--     el reparto depende del orden.
--
-- 3 · FECHA DE LA MORA. El evento de mora usaba la fecha de la CUOTA. Ahora
--     usa su propia fecha, cuotas_condominio.mora_aplicada_at (la que ya sella
--     el cron), para contabilizar y para comprobar el período al reprocesar.
--     Un trigger la sella si algún escritor pone mora sin ella.
--
-- QUÉ NO CAMBIA. Cuotas sin clasificar, cuotas clasificadas anteriores a la
-- contabilización por tipo (sin intentos), agua y cualquier otro pago siguen
-- el camino histórico de conta_tg_pagos. No se contabiliza nada retroactivo.
--
-- CÓMO SE REVIERTE (en este orden):
--   restaurar conta_cargos_pendientes, conta_reprocesar_cargo, conta_tg_pagos
--   y conta_contabilizar_cargo_interno desde 20261002000000;
--   DROP FUNCTION public.conta_reprocesar_un_cobro(uuid, uuid);
--   DROP FUNCTION public.conta_contabilizar_cobro_seguro(uuid, text);
--   DROP FUNCTION public.conta_contabilizar_cobro_interno(uuid, text);
--   DROP FUNCTION public.conta_cobro_cuota_por_tipo(uuid);
--   DROP TABLE public.conta_cobro_aplicaciones;
--   DROP TRIGGER trg_cuota_sellar_fecha_mora ON public.cuotas_condominio;
--   DROP FUNCTION public.conta_tg_cuota_sellar_fecha_mora();
--   DROP FUNCTION public.conta_fecha_evento_cargo(text, uuid, text);
--   restaurar los CHECK de conta_intentos_contabilizacion de 20261002000000
--   (tras borrar las filas de origen «pagos», que son sólo historial).
-- ============================================================================

-- ── 1. Bitácora: el cobro como origen, su disparo y sus motivos ──────────────
ALTER TABLE public.conta_intentos_contabilizacion
  DROP CONSTRAINT conta_intentos_origen_valido,
  ADD CONSTRAINT conta_intentos_origen_valido
    CHECK (origen_tabla IN ('facturas_proveedor','cuotas_condominio','cargos_adicionales_unidad','pagos')),
  DROP CONSTRAINT conta_intentos_disparo_valido,
  ADD CONSTRAINT conta_intentos_disparo_valido
    CHECK (disparo IN ('aprobacion','reproceso','emision','cobro')),
  DROP CONSTRAINT conta_intentos_codigo_valido,
  ADD CONSTRAINT conta_intentos_codigo_valido
    CHECK (codigo IS NULL OR codigo IN (
      'sin_cuenta','cuenta_invalida','configuracion_incompleta','reparto_lineas',
      'periodo_cerrado','documento_anulado','documento_no_aprobado',
      'asiento_reversado','error',
      'sin_configuracion','sin_responsable',
      'devengo_pendiente','excede_saldo','cobro_anterior_pendiente')),
  DROP CONSTRAINT conta_intentos_evento_valido,
  ADD CONSTRAINT conta_intentos_evento_valido
    CHECK (
      (origen_tabla = 'facturas_proveedor' AND evento IS NULL)
      OR (origen_tabla = 'cuotas_condominio' AND evento IN ('cuota_emitida','cuota_mora'))
      OR (origen_tabla = 'cargos_adicionales_unidad' AND evento = 'cargo_adicional_emitido')
      OR (origen_tabla = 'pagos' AND evento = 'pago_contabilizado')
    );

-- ── 2. Aplicaciones de cobros: cuánto de cada cobro fue a cada evento ────────
-- Una fila por (asiento de cobro, evento). Sólo cuentan las de asientos VIVOS:
-- si el cobro se rechaza o se borra, su asiento se reversa y su aplicación
-- deja de descontar saldo sin tocar esta tabla.
CREATE TABLE public.conta_cobro_aplicaciones (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid          REFERENCES public.projects(id) ON DELETE CASCADE,
  pago_id     uuid          NOT NULL REFERENCES public.pagos(id) ON DELETE CASCADE,
  cuota_id    uuid          NOT NULL REFERENCES public.cuotas_condominio(id) ON DELETE CASCADE,
  evento      text          NOT NULL,
  monto       numeric(14,2) NOT NULL,
  cuenta_id   uuid          NOT NULL REFERENCES public.conta_cuentas(id),
  asiento_id  uuid          NOT NULL REFERENCES public.conta_asientos(id) ON DELETE CASCADE,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conta_cobro_aplicaciones_evento_valido CHECK (evento IN ('cuota_emitida','cuota_mora')),
  CONSTRAINT conta_cobro_aplicaciones_monto_positivo CHECK (monto > 0),
  CONSTRAINT conta_cobro_aplicaciones_unica UNIQUE (asiento_id, evento)
);

CREATE INDEX idx_conta_cobro_aplicaciones_cuota ON public.conta_cobro_aplicaciones(cuota_id);
CREATE INDEX idx_conta_cobro_aplicaciones_pago  ON public.conta_cobro_aplicaciones(pago_id);
CREATE INDEX idx_conta_cobro_aplicaciones_company_project ON public.conta_cobro_aplicaciones(company_id, project_id);
CREATE INDEX idx_conta_cobro_aplicaciones_cuenta ON public.conta_cobro_aplicaciones(cuenta_id);

COMMENT ON TABLE public.conta_cobro_aplicaciones IS
  'Reparto de cada cobro contabilizado de una cuota por tipo entre su principal (cuota_emitida) y su mora (cuota_mora). Sólo la escribe conta_contabilizar_cobro_interno; cuenta sólo si su asiento sigue vivo.';

ALTER TABLE public.conta_cobro_aplicaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conta_cobro_aplicaciones_select" ON public.conta_cobro_aplicaciones;
CREATE POLICY "conta_cobro_aplicaciones_select" ON public.conta_cobro_aplicaciones
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND public.can_access_project(project_id))
  );

REVOKE ALL ON public.conta_cobro_aplicaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_cobro_aplicaciones TO authenticated;
GRANT SELECT ON public.conta_cobro_aplicaciones TO service_role;

-- ── 3. Fecha propia de cada evento ───────────────────────────────────────────
-- La mora tiene la suya: mora_aplicada_at. Si faltara (mora anterior al
-- sello), el primer intento de contabilizarla es cuando ocurrió el evento.
CREATE OR REPLACE FUNCTION public.conta_fecha_evento_cargo(
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text
)
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_origen_tabla = 'cuotas_condominio' AND p_evento = 'cuota_emitida' THEN
      (SELECT c.created_at::date FROM public.cuotas_condominio c WHERE c.id = p_origen_id)
    WHEN p_origen_tabla = 'cuotas_condominio' AND p_evento = 'cuota_mora' THEN
      (SELECT COALESCE(c.mora_aplicada_at,
                       (SELECT min(i.created_at) FROM public.conta_intentos_contabilizacion i
                         WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id
                           AND i.evento = 'cuota_mora'),
                       c.created_at)::date
         FROM public.cuotas_condominio c WHERE c.id = p_origen_id)
    WHEN p_origen_tabla = 'cargos_adicionales_unidad' THEN
      (SELECT ca.fecha_cargo FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_origen_id)
    WHEN p_origen_tabla = 'pagos' THEN
      (SELECT COALESCE(p.verified_at, p.created_at)::date FROM public.pagos p WHERE p.id = p_origen_id)
  END
$$;

REVOKE EXECUTE ON FUNCTION public.conta_fecha_evento_cargo(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_fecha_evento_cargo(text, uuid, text) IS
  'INTERNA. Fecha contable de un evento: emisión de la cuota, aplicación de su mora (mora_aplicada_at), fecha del cargo adicional o verificación del cobro.';

-- El sello: quien ponga mora sin fecha, la recibe ahora. El cron ya la pone.
CREATE OR REPLACE FUNCTION public.conta_tg_cuota_sellar_fecha_mora()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(NEW.mora_monto, 0) > 0 AND NEW.mora_aplicada_at IS NULL
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.mora_monto, 0) = 0) THEN
    NEW.mora_aplicada_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_cuota_sellar_fecha_mora() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_cuota_sellar_fecha_mora
  BEFORE INSERT OR UPDATE OF mora_monto ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cuota_sellar_fecha_mora();

-- ── 4. ¿Este cobro es de una cuota contabilizada por tipo? ───────────────────
-- Devuelve la cuota si el pago la liquida (pagos.cuota_id o cuotas.pago_id) y
-- la cuota está clasificada Y entró a la contabilización por tipo (tiene
-- intentos). Si no, NULL: el pago sigue el camino histórico.
CREATE OR REPLACE FUNCTION public.conta_cobro_cuota_por_tipo(p_pago_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id
    FROM public.pagos p
    JOIN public.cuotas_condominio c
      ON c.id = COALESCE(p.cuota_id,
                         (SELECT c2.id FROM public.cuotas_condominio c2 WHERE c2.pago_id = p.id
                           ORDER BY c2.created_at, c2.id LIMIT 1))
   WHERE p.id = p_pago_id
     AND c.tipo_cargo IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                  WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cobro_cuota_por_tipo(uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Contabilizar un cobro de cuota por tipo (INTERNO) ─────────────────────
-- Única lógica, compartida por el trigger de pagos y el reproceso. Corre bajo
-- un candado por cuota: el reparto de un cobro depende de los anteriores.
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

  v_cuota_id := public.conta_cobro_cuota_por_tipo(p_pago_id);
  IF v_cuota_id IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cobro_interno: el pago % no es de una cuota contabilizada por tipo', p_pago_id
      USING ERRCODE = '22023';
  END IF;

  -- CANDADO POR CUOTA, antes de leer saldos: dos cobros de la misma cuota (o
  -- un cobro y el reproceso de su cuota) se contabilizan uno detrás del otro.
  PERFORM pg_advisory_xact_lock(hashtext('conta_cobro_cuota'), hashtext(v_cuota_id::text));

  SELECT * INTO v_pago FROM public.pagos p WHERE p.id = p_pago_id;
  SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = v_cuota_id;
  v_company := v_cuota.company_id;
  v_project := v_cuota.project_id;
  v_ts      := COALESCE(v_pago.verified_at, v_pago.created_at, now());

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
  'INTERNA. Contabiliza el cobro de una cuota por tipo: mora primero, luego principal, cada porción contra la cuenta y dimensiones de su devengo. Pendiente visible si falta un devengo, si un cobro anterior está pendiente o si excede el saldo. Candado por cuota.';

-- Envoltorio para el trigger: la contabilidad nunca rompe el cobro.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cobro_seguro(
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
    PERFORM public.conta_contabilizar_cobro_interno(p_pago_id, p_disparo);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_contabilizar_cobro_seguro(%): %', p_pago_id, SQLERRM;
    BEGIN
      SELECT c.company_id, c.project_id INTO v_company, v_project
        FROM public.cuotas_condominio c
       WHERE c.id = public.conta_cobro_cuota_por_tipo(p_pago_id);
      IF v_company IS NOT NULL THEN
        PERFORM public.conta_registrar_intento_cargo(
          v_company, v_project, 'pagos', p_pago_id, 'pago_contabilizado', p_disparo,
          'pendiente', 'error',
          'Error inesperado al contabilizar el cobro. Reprocesa; si persiste, consulta el registro del servidor.',
          '[]'::jsonb, NULL);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'conta_contabilizar_cobro_seguro: no se pudo registrar el intento: %', SQLERRM;
    END;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cobro_seguro(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── 6. Reprocesar UN cobro (INTERNO; lo usan el reproceso del cobro y el de
--       su cuota). Mismos bloqueos que el resto: anulado, ya contabilizado,
--       reversado, período cerrado del cobro. ─────────────────────────────────
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
  SELECT c.project_id INTO v_project FROM public.cuotas_condominio c
   WHERE c.id = public.conta_cobro_cuota_por_tipo(p_pago_id);

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

  SELECT * INTO v_res FROM public.conta_contabilizar_cobro_interno(p_pago_id, 'reproceso');
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

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_un_cobro(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_reprocesar_un_cobro(uuid, uuid) IS
  'INTERNA. Reproceso de un cobro de cuota por tipo, sin comprobar permisos (los comprueba conta_reprocesar_cargo antes de llamarla).';

-- ── 7. Devengo de cuotas y cargos: la fecha del EVENTO (mora incluida) ────────
-- Cuerpo idéntico a 20261002000000 salvo la fecha de la cuota, que ahora sale
-- de conta_fecha_evento_cargo: emisión para el principal, mora_aplicada_at
-- para la mora.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cargo_interno(
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_disparo      text
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
  v_company   uuid;
  v_project   uuid;
  v_unidad    uuid;
  v_resp      uuid;
  v_monto     numeric(14,2);
  v_fecha     date;
  v_concepto  text;
  v_tipo      text;
  v_etiqueta  text;
  v_cfg       record;
  v_cuenta    record;
  v_moneda    text;
  v_codigo    text;
  v_motivo    text;
  v_asiento   uuid;
  v_intento   uuid;
BEGIN
  IF p_disparo NOT IN ('emision','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_cargo_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  -- ── El documento ──────────────────────────────────────────────────────────
  IF p_origen_tabla = 'cuotas_condominio' AND p_evento IN ('cuota_emitida','cuota_mora') THEN
    SELECT c.company_id, c.project_id, c.unidad_id, c.responsable_cliente_id,
           CASE WHEN p_evento = 'cuota_emitida' THEN c.monto ELSE c.mora_monto END,
           public.conta_fecha_evento_cargo('cuotas_condominio', c.id, p_evento),
           CASE WHEN p_evento = 'cuota_emitida'
                THEN 'Cuota ' || c.concepto || ' ' || c.periodo
                ELSE 'Mora aplicada — cuota ' || c.concepto || ' ' || c.periodo END
      INTO v_company, v_project, v_unidad, v_resp, v_monto, v_fecha, v_concepto
      FROM public.cuotas_condominio c WHERE c.id = p_origen_id;
  ELSIF p_origen_tabla = 'cargos_adicionales_unidad' AND p_evento = 'cargo_adicional_emitido' THEN
    SELECT ca.company_id, ca.project_id, ca.unidad_id, ca.responsable_cliente_id,
           ca.monto, ca.fecha_cargo, 'Cargo adicional ' || ca.concepto
      INTO v_company, v_project, v_unidad, v_resp, v_monto, v_fecha, v_concepto
      FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_origen_id;
  ELSE
    RAISE EXCEPTION 'conta_contabilizar_cargo_interno: origen/evento inválido %/%', p_origen_tabla, p_evento
      USING ERRCODE = '22023';
  END IF;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cargo_interno: documento % inexistente', p_origen_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_tipo := public.conta_tipo_cargo_de_documento(p_origen_tabla, p_origen_id, p_evento);
  SELECT t.etiqueta INTO v_etiqueta FROM public.conta_tipos_cargo() t WHERE t.tipo_cargo = v_tipo;

  -- ── Diagnóstico, en orden: el primer motivo manda ────────────────────────
  SELECT cfg.* INTO v_cfg
    FROM public.conta_config_tipo_cargo cfg
   WHERE cfg.company_id = v_company
     AND cfg.project_id IS NOT DISTINCT FROM v_project
     AND cfg.tipo_cargo = v_tipo;

  IF v_tipo IS NULL THEN
    v_codigo := 'sin_configuracion';
    v_motivo := 'El documento no tiene tipo de cargo: no se contabiliza con la configuración por tipo.';
  ELSIF NOT FOUND THEN
    v_codigo := 'sin_configuracion';
    v_motivo := format('Falta la configuración contable del tipo «%s» en esta contabilidad. Configúrala en Contabilidad › Tipos de cargo y reprocesa.',
                       COALESCE(v_etiqueta, v_tipo));
  ELSIF NOT v_cfg.activa THEN
    v_codigo := 'sin_configuracion';
    v_motivo := format('La configuración del tipo «%s» está desactivada. Actívala en Contabilidad › Tipos de cargo y reprocesa.',
                       COALESCE(v_etiqueta, v_tipo));
  END IF;

  IF v_codigo IS NULL THEN
    FOR v_cuenta IN
      SELECT x.rol, x.cuenta_id, x.tipo_esperado, c.id AS existe, c.company_id, c.project_id,
             c.es_detalle, c.activa, c.tipo, c.codigo
        FROM (VALUES ('por cobrar', v_cfg.cuenta_cxc_id, 'activo'),
                     ('de ingreso', v_cfg.cuenta_ingreso_id, 'ingreso')) AS x(rol, cuenta_id, tipo_esperado)
        LEFT JOIN public.conta_cuentas c ON c.id = x.cuenta_id
    LOOP
      IF v_cuenta.existe IS NULL
         OR v_cuenta.company_id <> v_company
         OR v_cuenta.project_id IS DISTINCT FROM v_project
         OR NOT v_cuenta.es_detalle OR NOT v_cuenta.activa
         OR v_cuenta.tipo <> v_cuenta.tipo_esperado THEN
        v_codigo := 'cuenta_invalida';
        v_motivo := format('La cuenta %s (%s) configurada para «%s» ya no sirve: tiene que ser de esta contabilidad, de detalle, activa y de tipo %s. Corrígela en Tipos de cargo y reprocesa.',
                           v_cuenta.rol, COALESCE(v_cuenta.codigo, '¿?'), COALESCE(v_etiqueta, v_tipo), v_cuenta.tipo_esperado);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_codigo IS NULL AND v_resp IS NULL THEN
    v_codigo := 'sin_responsable';
    v_motivo := 'El cargo no tiene responsable (no hubo un candidato único al emitirlo). Asigna el responsable del cargo y reprocesa: sin él el movimiento no tendría auxiliar.';
  END IF;

  IF v_codigo IS NULL AND COALESCE(v_monto, 0) <= 0 THEN
    v_codigo := 'error';
    v_motivo := 'El documento no tiene importe que contabilizar.';
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_cargo_interno: %/% (%) pendiente (%) — asiento omitido',
      p_origen_tabla, p_origen_id, p_evento, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ── El asiento ────────────────────────────────────────────────────────────
  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_project;

  v_asiento := public.conta_generar_asiento(
    v_company, v_project, p_origen_tabla, p_origen_id, p_evento,
    v_fecha, v_concepto, 'diario', v_moneda,
    jsonb_build_array(
      jsonb_build_object('cuenta_id', v_cfg.cuenta_cxc_id, 'debe', v_monto,
                         'descripcion', COALESCE(v_etiqueta, v_tipo),
                         'auxiliar_cliente_id', v_resp, 'unidad_id', v_unidad, 'tipo_cargo', v_tipo),
      jsonb_build_object('cuenta_id', v_cfg.cuenta_ingreso_id, 'haber', v_monto,
                         'descripcion', COALESCE(v_etiqueta, v_tipo),
                         'auxiliar_cliente_id', v_resp, 'unidad_id', v_unidad, 'tipo_cargo', v_tipo)
    )
  );

  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
      'contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- El generador no creó nada: o ya existía (idempotencia) o falló por algo
  -- que el diagnóstico no previó y sólo quedó en el log.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = p_origen_tabla AND a.origen_id = p_origen_id
     AND a.origen_evento = p_evento AND a.estado <> 'anulado'
   ORDER BY a.created_at DESC LIMIT 1;

  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cargo_interno(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_cargo_interno(text, uuid, text, text) IS
  'INTERNA. Única lógica de devengo de cuotas clasificadas, su mora y cargos adicionales, compartida por la emisión (triggers) y el reproceso. Diagnostica, genera el asiento o ninguno, y registra el intento.';

-- Envoltura para los TRIGGERS: la contabilidad nunca rompe la operación de

-- ── 8. Trigger de PAGOS: el cobro de una cuota por tipo nunca cae al mapeo ────
-- Cuerpo idéntico a 20260611000200: se quita el bloque de 20261002000000
-- (que caía al mapeo general sin devengo publicado) y se deriva el cobro de
-- una cuota por tipo a conta_contabilizar_cobro_seguro.
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
    RETURN NEW;
  END IF;

  -- Contabilizar: primera transición a verificado/aplicado (pago vivo).
  IF NEW.estado IN ('verificado','aplicado')
     AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('verificado','aplicado'))
     AND COALESCE(NEW.monto, 0) > 0 THEN

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

-- ── 9. Reproceso: cobros, fecha del evento y cobros tras su devengo ───────────
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
    FOR v_pago_id IN
      SELECT p.id FROM public.pagos p
       WHERE (p.cuota_id = p_origen_id
              OR p.id = (SELECT c.pago_id FROM public.cuotas_condominio c WHERE c.id = p_origen_id))
         AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
         AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                      WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id)
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
  'Reprocesa la contabilización de UNA cuota clasificada (y después sus cobros pendientes, en orden), UN cargo adicional o UN cobro de cuota por tipo sin asiento. Bloquea la fila, exige platform.contabilidad.create y change_status, no re-fecha en período cerrado, no recrea asientos reversados, no contabiliza documentos sin intento previo y usa la misma lógica que la emisión.';

-- ── 11. Bandeja de cargos pendientes ────────────────────────────────────────

-- ── 10. Bandeja: los cobros pendientes y sus motivos ──────────────────────────
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

REVOKE EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) IS
  'Bandeja de cuotas clasificadas, cargos adicionales y cobros de cuotas por tipo con un evento contable SIN asiento y con al menos un intento, de la contabilidad indicada, acotada a la empresa de la sesión y a los proyectos del usuario. Filtro por motivo y búsqueda, paginada en servidor.';

