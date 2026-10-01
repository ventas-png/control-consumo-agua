-- ============================================================================
-- E6 · REBAJA DE IMPORTE POR SOLICITUD APROBADA (NOTA DE CRÉDITO)
--
-- Decisiones (docs/DECISIONES_PENDIENTES_CONTABILIDAD.md §E6, aprobadas el
-- 2026-10-01):
--   (a) CONTRAPARTIDA: cuenta especial nueva «ajustes_bonificaciones»
--       (Ajustes y bonificaciones sobre cuotas y cargos). Sin ella la
--       solicitud NO se ejecuta (CONTA_CONFIG_INCOMPLETA) y queda fallida,
--       reintentable cuando se configure.
--   (b) SÓLO REBAJA. Para cobrar más se crea un cargo o una cuota nueva.
--   (c) TOPE: el saldo pendiente del componente al aprobar. No genera saldo a
--       favor.
--   (d) MORA SOBRE EL NETO: la mora que se calcule DESPUÉS se calcula sobre el
--       importe menos las rebajas vivas, en los dos modos (monto_cuota y
--       saldo_vencido). La mora ya registrada no se toca.
--   (e) Fecha contable: la de la ejecución (hoy).
--
-- QUÉ ES. Un documento propio, `conta_notas_credito` (inmutable), vinculado a
-- la cuota (componente principal o mora) o al cargo adicional, con su
-- solicitud, motivo, saldo antes, cuentas y asiento. El asiento: cargo a la
-- cuenta de ajustes; abono a la MISMA CxC del devengo, con su auxiliar,
-- unidad y tipo de cargo. El devengo original no se toca y el importe del
-- documento (monto) tampoco: la rebaja reduce su SALDO, igual que un cobro o
-- una aplicación de saldo a favor. Una nota está viva mientras su asiento
-- esté publicado y sin reverso; se revierte reversando su póliza.
--
-- FLUJO. `conta_ajuste_solicitar_rebaja` (tipo ajuste_importe, componente,
-- importe, motivo; idempotente por clave; una abierta por documento) →
-- aprobación de otra persona (cuatro ojos, E1) → `conta_ajuste_ejecutar`
-- revalida (documento sin cambios, no anulado, período abierto, tope) y
-- registra la nota en la MISMA transacción. Una falla deja la solicitud
-- fallida sin efectos.
--
-- DÓNDE CUENTA (las mismas piezas que ya restan las aplicaciones de saldo a
-- favor): saldo de cuota y de cargo (conta_cuota_saldo_cobro,
-- conta_cargo_saldo_cobro → portal, cobro en línea de cargos, foto de
-- solicitudes, estado derivado del cargo), reparto de un cobro posterior
-- (conta_contabilizar_cobro_interno: no se aplica a la CxC más que el saldo
-- neto; el excedente queda como saldo a favor), saldo en línea de una cuota y
-- base de la mora (conta_cuota_saldo_favor_aplicado, conta_aplicar_mora_cuotas),
-- estado de la cuota cubierta (conta_cuota_sincronizar_estado), guardas de
-- anulación (cuota y cargo: una nota viva es una dependencia) y estado de
-- cuenta (movimiento «Nota de crédito» y conciliación).
--
-- CÓMO SE REVIERTE: restaurar desde sus migraciones anteriores cada función
-- redefinida aquí (ver cada sección), DROP de conta_ajuste_solicitar_rebaja,
-- conta_nota_credito_registrar, conta_rebaja_saldo, conta_tg_nota_credito_estado
-- y la tabla conta_notas_credito (sólo si no tiene filas: son historia
-- contable), y de la columna componente y las restricciones nuevas.
-- ============================================================================

-- ── 1. La cuenta especial ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_eventos_especiales()
RETURNS TABLE (evento text, etiqueta text, proceso text, bloqueante boolean)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('resultados_acumulados',  'Resultados acumulados',    'Apertura de saldos (ajuste de la diferencia)', false),
    ('resultado_ejercicio',    'Resultado del ejercicio',  'Cierre anual',                                 true),
    ('diferencial_cambiario',  'Diferencial cambiario',    'Revaluación cambiaria',                        true),
    ('cxp_proveedores',        'Proveedores por pagar',    'Cuentas por pagar',                            false),
    ('compras_por_facturar',   'Bienes y servicios por facturar', 'Recepción de compras (puente GR/IR)',   false),
    ('iva_credito',            'IVA crédito fiscal',       'IVA acreditable de compras',                   false),
    ('iva_por_pagar',          'IVA por pagar',            'IVA trasladado de cobros',                     false),
    ('inventario',             'Inventario de insumos',    'Recepción a bodega',                           false),
    ('activo_fijo',            'Activo fijo',              'Alta de activos por recepción',                false),
    ('depreciacion_acumulada', 'Depreciación acumulada',   'Alta de activos por recepción',                false),
    ('gasto_depreciacion',     'Gasto por depreciación',   'Alta de activos por recepción',                false),
    ('ajustes_bonificaciones', 'Ajustes y bonificaciones sobre cuotas y cargos', 'Rebajas de importe (notas de crédito)', true)
  ) AS t(evento, etiqueta, proceso, bloqueante)
$$;

-- ── 2. Las notas de crédito ─────────────────────────────────────────────────
CREATE TABLE public.conta_notas_credito (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  solicitud_id       uuid          NOT NULL UNIQUE REFERENCES public.conta_ajustes_solicitudes(id) ON DELETE RESTRICT,
  cuota_id           uuid          REFERENCES public.cuotas_condominio(id) ON DELETE RESTRICT,
  cargo_adicional_id uuid          REFERENCES public.cargos_adicionales_unidad(id) ON DELETE RESTRICT,
  componente         text          NOT NULL,
  monto              numeric(14,2) NOT NULL,
  moneda             text          NOT NULL,
  saldo_antes        numeric(14,2) NOT NULL,
  cliente_id         uuid,
  unidad_id          uuid,
  cuenta_ajuste_id   uuid          NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  cuenta_cxc_id      uuid          NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  asiento_id         uuid          NOT NULL REFERENCES public.conta_asientos(id) ON DELETE RESTRICT,
  motivo             text          NOT NULL,
  solicitado_por     uuid          NOT NULL,
  aprobado_por       uuid,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conta_nc_un_documento CHECK ((cuota_id IS NOT NULL) <> (cargo_adicional_id IS NOT NULL)),
  CONSTRAINT conta_nc_componente CHECK (
       (cuota_id IS NOT NULL AND componente IN ('principal','mora'))
    OR (cargo_adicional_id IS NOT NULL AND componente = 'cargo')),
  CONSTRAINT conta_nc_monto CHECK (monto > 0 AND monto = round(monto, 2) AND monto <= saldo_antes)
);

CREATE INDEX idx_conta_nc_cuota ON public.conta_notas_credito (cuota_id) WHERE cuota_id IS NOT NULL;
CREATE INDEX idx_conta_nc_cargo ON public.conta_notas_credito (cargo_adicional_id) WHERE cargo_adicional_id IS NOT NULL;
CREATE INDEX idx_conta_nc_asiento ON public.conta_notas_credito (asiento_id);
CREATE INDEX idx_conta_nc_empresa ON public.conta_notas_credito (company_id, project_id);

COMMENT ON TABLE public.conta_notas_credito IS
  'Rebajas de importe (E6): nota de crédito de una cuota (principal o mora) o de un cargo adicional, ejecutada por una solicitud ajuste_importe aprobada. Asiento: cuenta especial ajustes_bonificaciones contra la CxC del devengo. Reduce el saldo del documento mientras su asiento esté vivo. Inmutable.';

CREATE TRIGGER trg_conta_notas_credito_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_notas_credito
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

ALTER TABLE public.conta_notas_credito ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conta_notas_credito_select" ON public.conta_notas_credito
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));
REVOKE ALL ON public.conta_notas_credito FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_notas_credito TO authenticated;
GRANT ALL ON public.conta_notas_credito TO service_role;

-- ── 3. Solicitudes: tipo ajuste_importe con componente ──────────────────────
ALTER TABLE public.conta_ajustes_solicitudes ADD COLUMN componente text;
COMMENT ON COLUMN public.conta_ajustes_solicitudes.componente IS
  'ajuste_importe: qué se rebaja — principal o mora de una cuota, o el cargo adicional. NULL en los demás tipos.';
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_componente_valido CHECK (
  componente IS NULL OR componente IN ('principal','mora','cargo'));
ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_tipo_valido;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_tipo_valido CHECK (tipo IN (
  'anular_cargo', 'anular_cobro_cargo', 'anular_anticipo',
  'revertir_aplicacion_saldo_favor', 'aplicar_saldo_favor', 'anular_cuota', 'ajuste_importe'));
ALTER TABLE public.conta_ajustes_solicitudes DROP CONSTRAINT conta_ajustes_documento_del_tipo;
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_documento_del_tipo CHECK (
     (tipo = 'anular_cargo'                    AND documento_tabla = 'cargos_adicionales_unidad')
  OR (tipo IN ('anular_cobro_cargo','anular_anticipo') AND documento_tabla = 'pagos')
  OR (tipo = 'revertir_aplicacion_saldo_favor' AND documento_tabla = 'conta_saldo_favor_aplicaciones')
  OR (tipo = 'aplicar_saldo_favor'             AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad'))
  OR (tipo = 'anular_cuota'                    AND documento_tabla = 'cuotas_condominio')
  OR (tipo = 'ajuste_importe'                  AND documento_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')));
ALTER TABLE public.conta_ajustes_solicitudes ADD CONSTRAINT conta_ajustes_rebaja_completa CHECK (
  (tipo = 'ajuste_importe') = (componente IS NOT NULL)
  AND (tipo <> 'ajuste_importe' OR (
        importe > 0 AND importe = round(importe, 2)
        AND ((documento_tabla = 'cuotas_condominio' AND componente IN ('principal','mora'))
             OR (documento_tabla = 'cargos_adicionales_unidad' AND componente = 'cargo')))));

-- ── 4. Saldo de un componente (INTERNA) ─────────────────────────────────────
-- NULL si el componente no tiene devengo publicado.
CREATE FUNCTION public.conta_rebaja_saldo(p_tabla text, p_id uuid, p_componente text)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_q record;
  v_s record;
BEGIN
  IF p_tabla = 'cuotas_condominio' THEN
    SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(p_id);
    IF p_componente = 'principal' THEN
      IF v_q.princ_asiento_id IS NULL OR v_q.princ_estado <> 'publicado' THEN RETURN NULL; END IF;
      RETURN GREATEST(v_q.princ_monto - v_q.aplicado_princ, 0)::numeric(14,2);
    ELSIF p_componente = 'mora' THEN
      IF v_q.mora_asiento_id IS NULL OR v_q.mora_estado <> 'publicado' THEN RETURN NULL; END IF;
      RETURN GREATEST(v_q.mora_monto - v_q.aplicado_mora, 0)::numeric(14,2);
    END IF;
  ELSIF p_tabla = 'cargos_adicionales_unidad' AND p_componente = 'cargo' THEN
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(p_id);
    IF v_s.devengo_asiento_id IS NULL OR v_s.devengo_estado <> 'publicado' THEN RETURN NULL; END IF;
    RETURN GREATEST(v_s.devengo_monto - v_s.aplicado, 0)::numeric(14,2);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_rebaja_saldo(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 5. Saldos: las notas vivas reducen el saldo como un cobro ──────────────
-- conta_cuota_saldo_cobro: cuerpo de 20261007000000 + notas de crédito vivas.
CREATE OR REPLACE FUNCTION public.conta_cuota_saldo_cobro(p_cuota_id uuid)
RETURNS TABLE (
  princ_asiento_id uuid,
  princ_estado     text,
  princ_monto      numeric,
  princ_cuenta_id  uuid,
  princ_auxiliar   uuid,
  princ_unidad     uuid,
  princ_tipo_cargo text,
  princ_moneda     text,
  mora_asiento_id  uuid,
  mora_estado      text,
  mora_monto       numeric,
  mora_cuenta_id   uuid,
  mora_auxiliar    uuid,
  mora_unidad      uuid,
  mora_tipo_cargo  text,
  mora_moneda      text,
  aplicado_princ   numeric,
  aplicado_mora    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH c AS (SELECT * FROM public.cuotas_condominio x WHERE x.id = p_cuota_id),
  dev AS (
    SELECT DISTINCT ON (a.origen_evento)
           a.origen_evento AS ev, a.id AS asiento_id, a.estado,
           COALESCE(l.monto_origen, l.debe)::numeric(14,2) AS monto,
           l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo,
           COALESCE(l.moneda_origen, a.moneda_base) AS moneda
      FROM c
      JOIN public.conta_asientos a
        ON a.company_id = c.company_id AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = c.id
       AND a.origen_evento IN ('cuota_emitida','cuota_mora')
       AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     ORDER BY a.origen_evento, a.created_at DESC, l.orden
  ),
  ap AS (
    SELECT COALESCE(sum(x.monto) FILTER (WHERE x.evento = 'cuota_emitida'), 0) AS princ,
           COALESCE(sum(x.monto) FILTER (WHERE x.evento = 'cuota_mora'), 0) AS mora
      FROM public.conta_cobro_aplicaciones x
      JOIN public.conta_asientos a ON a.id = x.asiento_id
     WHERE x.cuota_id = p_cuota_id AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
  ),
  hist AS (
    SELECT COALESCE(sum(p2.monto), 0) AS princ
      FROM c
      JOIN public.pagos p2 ON (p2.cuota_id = c.id OR p2.id = c.pago_id)
     WHERE EXISTS (SELECT 1 FROM public.conta_asientos a
                    WHERE a.company_id = c.company_id AND a.origen = 'automatico'
                      AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                      AND a.origen_evento = 'pago_contabilizado'
                      AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL)
       AND NOT EXISTS (SELECT 1 FROM public.conta_cobro_aplicaciones x WHERE x.pago_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p2.id)
  ),
  sf AS (
    SELECT COALESCE(sum(x.monto_principal), 0) AS princ, COALESCE(sum(x.monto_mora), 0) AS mora
      FROM public.conta_saldo_favor_aplicaciones x
     WHERE x.cuota_id = p_cuota_id AND public.conta_sf_asiento_vivo(x.asiento_id)
  ),
  -- Notas de crédito vivas (20261017000000, E6).
  nc AS (
    SELECT COALESCE(sum(n.monto) FILTER (WHERE n.componente = 'principal'), 0) AS princ,
           COALESCE(sum(n.monto) FILTER (WHERE n.componente = 'mora'), 0) AS mora
      FROM public.conta_notas_credito n
     WHERE n.cuota_id = p_cuota_id AND public.conta_sf_asiento_vivo(n.asiento_id)
  )
  SELECT p.asiento_id, p.estado, p.monto, p.cuenta_id, p.auxiliar_cliente_id, p.unidad_id, p.tipo_cargo, p.moneda,
         m.asiento_id, m.estado, m.monto, m.cuenta_id, m.auxiliar_cliente_id, m.unidad_id, m.tipo_cargo, m.moneda,
         (ap.princ + hist.princ + sf.princ + nc.princ)::numeric(14,2),
         (ap.mora + sf.mora + nc.mora)::numeric(14,2)
    FROM ap, hist, sf, nc
    LEFT JOIN dev p ON p.ev = 'cuota_emitida'
    LEFT JOIN dev m ON m.ev = 'cuota_mora'
$$;

-- conta_cargo_saldo_cobro: cuerpo de 20261007000000 + notas de crédito vivas.
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
         -- Aplicaciones de saldo a favor vivas (20261007000000): reducen el
         -- saldo del cargo igual que un cobro.
         + COALESCE((
           SELECT sum(x.monto)
             FROM public.conta_saldo_favor_aplicaciones x
            WHERE x.cargo_adicional_id = p_cargo_id
              AND public.conta_sf_asiento_vivo(x.asiento_id)), 0)::numeric(14,2)
         -- Notas de crédito vivas (20261017000000, E6).
         + COALESCE((
           SELECT sum(n.monto)
             FROM public.conta_notas_credito n
            WHERE n.cargo_adicional_id = p_cargo_id
              AND public.conta_sf_asiento_vivo(n.asiento_id)), 0)::numeric(14,2)
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

-- conta_cuota_saldo_favor_aplicado: lo que reduce el saldo de una cuota sin
-- ser un cobro (saldos a favor aplicados y, desde 20261017000000, notas de
-- crédito vivas). Lo usan create-charge (saldo en línea) y la mora.
CREATE OR REPLACE FUNCTION public.conta_cuota_saldo_favor_aplicado(p_cuota_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (COALESCE((SELECT sum(x.monto)
                       FROM public.conta_saldo_favor_aplicaciones x
                      WHERE x.cuota_id = p_cuota_id AND public.conta_sf_asiento_vivo(x.asiento_id)), 0)
        + COALESCE((SELECT sum(n.monto)
                       FROM public.conta_notas_credito n
                      WHERE n.cuota_id = p_cuota_id AND public.conta_sf_asiento_vivo(n.asiento_id)), 0))::numeric(14,2)
$$;

COMMENT ON FUNCTION public.conta_cuota_saldo_favor_aplicado(uuid) IS
  'Importe que reduce el saldo de la cuota sin ser un cobro: saldos a favor aplicados y notas de crédito (E6) con asiento vivo. Sólo service_role (create-charge lo resta del saldo a cobrar en línea) y la mora.';

-- conta_contabilizar_cobro_interno: cuerpo de 20261007000000; un cobro
-- posterior a una rebaja sólo abona a la CxC el saldo neto.
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
  v_ant         record;
  v_lt          record;
  v_credito     numeric(14,2) := 0;
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

    -- Aplicaciones de saldo a favor vivas (20261007000000): reducen la mora y
    -- el principal igual que un cobro.
    SELECT v_prev_mora + COALESCE(sum(x.monto_mora), 0),
           v_prev_princ + COALESCE(sum(x.monto_principal), 0)
      INTO v_prev_mora, v_prev_princ
      FROM public.conta_saldo_favor_aplicaciones x
     WHERE x.cuota_id = v_cuota.id AND public.conta_sf_asiento_vivo(x.asiento_id);

    -- Notas de crédito vivas (20261017000000, E6): reducen la mora y el
    -- principal igual que un cobro.
    SELECT v_prev_mora + COALESCE(sum(n.monto) FILTER (WHERE n.componente = 'mora'), 0),
           v_prev_princ + COALESCE(sum(n.monto) FILTER (WHERE n.componente = 'principal'), 0)
      INTO v_prev_mora, v_prev_princ
      FROM public.conta_notas_credito n
     WHERE n.cuota_id = v_cuota.id AND public.conta_sf_asiento_vivo(n.asiento_id);

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
         -- un cobro que fue TODO saldo a favor no tiene aplicaciones, pero
         -- tampoco es del camino histórico
         AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = p2.id)
    ), 0);

    -- La mora cuenta sólo si ya existía cuando se cobró.
    v_mora := CASE WHEN COALESCE(v_cuota.mora_monto, 0) > 0
                    AND COALESCE(v_cuota.mora_aplicada_at, '-infinity'::timestamptz) <= v_ts
                   THEN v_cuota.mora_monto ELSE 0 END;

    -- MORA PRIMERO, luego principal.
    v_a_mora  := LEAST(v_pago.monto, GREATEST(v_mora - v_prev_mora, 0));
    v_a_princ := LEAST(v_pago.monto - v_a_mora, GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0));
    v_exceso  := v_pago.monto - v_a_mora - v_a_princ;

    -- EXCEDENTE (20261007000000): queda como SALDO A FAVOR del responsable
    -- histórico de la cuota —la dimensión de su devengo— y su unidad, en la
    -- cuenta de anticipos. Si el pagador no es ese responsable, o si falta la
    -- cuenta, el cobro queda pendiente con el motivo (no se pierde).
    IF v_exceso > 0.005 THEN
      SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, a.estado AS estado INTO v_lt
        FROM public.conta_asientos a
        JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
       WHERE a.company_id = v_company AND a.origen = 'automatico'
         AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = v_cuota.id
         AND a.origen_evento = 'cuota_emitida'
         AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
       ORDER BY l.orden LIMIT 1;
      SELECT * INTO v_ant FROM public.conta_cuenta_anticipos(v_company, v_project);
      IF v_lt.cuenta_id IS NULL OR v_lt.estado <> 'publicado' THEN
        v_codigo := 'devengo_pendiente';
        v_motivo := 'Esta cuota todavía no tiene su devengo publicado: el excedente no se puede asignar a su responsable. Resuelve su pendiente y reprocesa la cuota.';
      ELSIF v_lt.auxiliar_cliente_id IS DISTINCT FROM v_pago.cliente_id OR v_lt.unidad_id IS NULL THEN
        v_codigo := 'excede_saldo';
        v_motivo := format('El cobro (%s) supera el saldo pendiente de la cuota (mora %s, principal %s) y el pagador no es el responsable histórico de la cuota: el excedente no se asigna como saldo a favor de otro cliente. Anula el cobro y regístralo por el saldo; el resto, como anticipo del pagador.',
                           v_pago.monto, GREATEST(v_mora - v_prev_mora, 0),
                           GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0));
      ELSIF v_ant.cuenta_id IS NULL THEN
        v_codigo := 'excede_saldo';
        v_motivo := format('El cobro (%s) supera el saldo pendiente de la cuota (mora %s, principal %s): el excedente de %s queda como saldo a favor, pero no hay cuenta para registrarlo. %s',
                           v_pago.monto, GREATEST(v_mora - v_prev_mora, 0),
                           GREATEST(COALESCE(v_cuota.monto, 0) - v_prev_princ, 0), v_exceso, v_ant.motivo);
      ELSE
        v_credito := v_exceso;
      END IF;
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
  -- El remanente, a la cuenta de anticipos con su titular (sin tipo de cargo:
  -- no es un cargo).
  IF v_credito > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'cuenta_id', v_ant.cuenta_id, 'haber', v_credito, 'descripcion', 'Saldo a favor',
      'auxiliar_cliente_id', v_lt.auxiliar_cliente_id, 'unidad_id', v_lt.unidad_id));
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

    IF v_credito > 0 THEN
      PERFORM public.conta_sf_registrar_origen(v_asiento, v_pago.id, 'excedente', v_ant.cuenta_id,
                                               'cuotas_condominio', v_cuota.id);
    END IF;

    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, 'pagos', v_pago.id, 'pago_contabilizado', p_disparo,
      'contabilizada', NULL, NULL,
      jsonb_build_array(jsonb_build_object('mora', v_a_mora, 'principal', v_a_princ, 'saldo_a_favor', v_credito)), v_asiento);
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

-- conta_aplicar_mora_cuotas: cuerpo de 20261010000000; (d) la base es el
-- importe NETO de rebajas vivas (monto_cuota) y el saldo ya las resta
-- (conta_cuota_saldo_favor_aplicado).
CREATE OR REPLACE FUNCTION public.conta_aplicar_mora_cuotas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- ── 1) Transición emitida → vencida ──────────────────────────────────────
  -- Vence cuando fecha_vencimiento + periodo_gracia (de la regla activa del
  -- proyecto; 0 si no hay regla) ya pasó. Tenant-safe: la regla se busca por el
  -- project_id de la propia cuota. Excluye soft-deleted.
  UPDATE public.cuotas_condominio c
  SET cuota_estado = 'vencida',
      vencida_at   = COALESCE(c.vencida_at, v_now)
  FROM (
    SELECT cu.id AS cuota_id,
           (cu.fecha_vencimiento
              + (COALESCE(rule.periodo_gracia, 0) || ' days')::interval) AS limite
    FROM public.cuotas_condominio cu
    LEFT JOIN LATERAL (
      SELECT rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = cu.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) rule ON true
    WHERE cu.cuota_estado = 'emitida'
      AND cu.fecha_vencimiento IS NOT NULL
      AND cu.deleted_at IS NULL
  ) v
  WHERE c.id = v.cuota_id
    AND v.limite < v_now;

  -- ── 2) Recargo de mora (replica calcularMora) ────────────────────────────
  -- Sólo cuotas ya vencidas, con regla activa, con unidad dueña, sin mora
  -- aplicada todavía (idempotencia por mora_aplicada_at). Se calcula la
  -- base/monto exactamente como la función pura y se persiste en
  -- cuotas_condominio + recargos_mora.
  WITH candidatas AS (
    SELECT
      cu.id             AS cuota_id,
      cu.project_id     AS project_id,
      cu.company_id     AS company_id,
      cu.unidad_id      AS unidad_id,
      r.id              AS regla_mora_id,
      r.tipo            AS tipo,
      r.valor           AS valor,
      r.aplicar_sobre   AS aplicar_sobre,
      r.dias_vencimiento AS dias_vencimiento,
      r.periodo_gracia  AS periodo_gracia,
      -- E6 (20261017000000): neto de rebajas vivas del principal.
      GREATEST(COALESCE(cu.monto, 0)
        - COALESCE((SELECT sum(n.monto) FROM public.conta_notas_credito n
                     WHERE n.cuota_id = cu.id AND n.componente = 'principal'
                       AND public.conta_sf_asiento_vivo(n.asiento_id)), 0), 0) AS cuota,
      -- SALDO VENCIDO REAL (20261010000000, decisión D2): el monto menos los
      -- cobros verificados vivos de la cuota y lo aplicado por saldos a
      -- favor vivos. Antes era el monto entero, así que «saldo_vencido» y
      -- «monto_cuota» daban lo mismo aunque hubiera abonos. Todavía no hay
      -- mora (mora_aplicada_at IS NULL): todo lo abonado es principal.
      GREATEST(COALESCE(cu.monto, 0)
        - COALESCE((SELECT sum(p.monto) FROM public.pagos p
                     WHERE (p.cuota_id = cu.id OR p.id = cu.pago_id)
                       AND p.deleted_at IS NULL
                       AND p.estado IN ('verificado','aplicado')), 0)
        - public.conta_cuota_saldo_favor_aplicado(cu.id), 0) AS saldo,
      -- dias = floor(diasTranscurridos) medido desde emitida_at (fallback created_at).
      floor(
        EXTRACT(EPOCH FROM (v_now - COALESCE(cu.emitida_at, cu.created_at))) / 86400.0
      )::int AS dias
    FROM public.cuotas_condominio cu
    JOIN LATERAL (
      SELECT rmc.id, rmc.tipo, rmc.valor, rmc.aplicar_sobre,
             rmc.dias_vencimiento, rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = cu.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) r ON true
    WHERE cu.cuota_estado = 'vencida'
      AND cu.mora_aplicada_at IS NULL       -- idempotencia
      AND cu.unidad_id IS NOT NULL          -- recargo necesita unidad dueña (owner_check)
      AND cu.deleted_at IS NULL
  ),
  calc AS (
    SELECT
      c.*,
      (c.dias - COALESCE(c.dias_vencimiento, 0))                      AS dias_atraso,
      CASE WHEN c.aplicar_sobre = 'monto_cuota' THEN c.cuota ELSE c.saldo END AS base,
      CASE WHEN COALESCE(c.valor, 0) > 0 THEN c.valor ELSE 0 END      AS valor_eff
    FROM candidatas c
  ),
  aplicables AS (
    SELECT
      calc.*,
      CASE
        WHEN calc.tipo = 'monto_fijo' THEN round(calc.valor_eff::numeric, 2)
        ELSE round((calc.base * (calc.valor_eff / 100.0))::numeric, 2)
      END AS monto
    FROM calc
    WHERE calc.dias_atraso > 0                                -- diasAtraso <= 0 → no
      AND calc.dias_atraso > COALESCE(calc.periodo_gracia, 0) -- dentro de gracia → no
      AND NOT (calc.tipo = 'porcentaje' AND calc.base <= 0)   -- % sin base → no
      AND calc.valor_eff > 0                                  -- valor 0 → no
  ),
  finales AS (
    SELECT * FROM aplicables WHERE monto > 0  -- aplica = monto > 0
  ),
  -- Inserta el recargo en el ledger compartido recargos_mora, por unidad/cuota
  -- (forma condominios). ON CONFLICT contra el índice único parcial (cuota viva)
  -- → no duplica si por carrera ya existe.
  ins AS (
    INSERT INTO public.recargos_mora
      (company_id, project_id, unidad_id, cuota_id, registro_id,
       tipo, valor, monto_calculado, fecha_aplicacion, estado, motivo)
    SELECT
      f.company_id, f.project_id, f.unidad_id, f.cuota_id, NULL,
      f.tipo, f.valor_eff, f.monto, v_now::date, 'aplicado',
      'Recargo por mora automático (cron cond:C6) — ' || f.dias_atraso || ' días de atraso'
    FROM finales f
    ON CONFLICT (cuota_id) WHERE (cuota_id IS NOT NULL AND estado <> 'anulado')
    DO NOTHING
    RETURNING cuota_id
  )
  -- Persiste en la cuota: mora_monto, regla, timestamp y total recompuesto
  -- (monto + mora; SIN IVA).
  UPDATE public.cuotas_condominio cu
  SET mora_monto       = f.monto,
      regla_mora_id    = f.regla_mora_id,
      mora_aplicada_at = v_now,
      total_a_pagar    = round((COALESCE(cu.monto, 0) + f.monto)::numeric, 2)
  FROM finales f
  WHERE cu.id = f.cuota_id;
END
$$;

-- ── 6. Estado del documento cubierto ────────────────────────────────────────
-- conta_cuota_sincronizar_estado: cuerpo de 20261009000000; también las
-- cuotas con notas de crédito (metodo_pago 'nota_credito' si no hubo saldo a
-- favor).
CREATE OR REPLACE FUNCTION public.conta_cuota_sincronizar_estado(p_cuota_id uuid, p_disparo text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_c       public.cuotas_condominio;
  v_q       record;
  v_ev      public.conta_sf_cuota_estado_eventos;
  v_con_sf  boolean;
  v_saldo   numeric(14,2);
  v_listo   boolean;
  v_abierta boolean;
  v_antes   jsonb;
  v_ahora   timestamptz := now();
  v_metodo  text;
BEGIN
  IF p_cuota_id IS NULL THEN
    RETURN 'sin_cuota';
  END IF;
  SELECT * INTO v_c FROM public.cuotas_condominio c WHERE c.id = p_cuota_id FOR UPDATE;
  IF v_c.id IS NULL OR v_c.deleted_at IS NOT NULL THEN
    RETURN 'sin_cuota';
  END IF;

  SELECT * INTO v_ev FROM public.conta_sf_cuota_estado_eventos e
   WHERE e.cuota_id = v_c.id ORDER BY e.ocurrido_at DESC, e.id DESC LIMIT 1;
  v_con_sf := EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x WHERE x.cuota_id = v_c.id)
              OR EXISTS (SELECT 1 FROM public.conta_notas_credito n WHERE n.cuota_id = v_c.id);
  v_metodo := CASE WHEN EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x WHERE x.cuota_id = v_c.id)
                   THEN 'saldo_a_favor' ELSE 'nota_credito' END;
  -- Sólo las cuotas en las que intervino un saldo a favor.
  IF NOT v_con_sf AND v_ev.id IS NULL THEN
    RETURN 'sin_saldo_favor';
  END IF;

  SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(v_c.id);
  v_listo := v_q.princ_asiento_id IS NOT NULL AND v_q.princ_estado = 'publicado'
             AND v_q.princ_monto IS NOT DISTINCT FROM v_c.monto::numeric(14,2)
             AND (COALESCE(v_c.mora_monto, 0) = 0
                  OR (v_q.mora_asiento_id IS NOT NULL AND v_q.mora_estado = 'publicado'
                      AND v_q.mora_monto IS NOT DISTINCT FROM v_c.mora_monto::numeric(14,2)));
  v_saldo := COALESCE(v_q.princ_monto, 0) - COALESCE(v_q.aplicado_princ, 0)
           + CASE WHEN v_q.mora_asiento_id IS NOT NULL
                  THEN COALESCE(v_q.mora_monto, 0) - COALESCE(v_q.aplicado_mora, 0) ELSE 0 END;

  -- 1 · MARCAR: abierta, devengo listo, sin cobros en borrador, saldo 0.
  v_abierta := COALESCE(v_c.cuota_estado, 'pendiente') IN ('pendiente','emitida','vencida','moroso')
               AND COALESCE(v_c.estado, '') <> 'pagado';
  IF v_abierta AND v_con_sf AND v_listo AND v_saldo <= 0
     AND NOT EXISTS (SELECT 1 FROM public.conta_cobro_aplicaciones x
                       JOIN public.conta_asientos a ON a.id = x.asiento_id
                      WHERE x.cuota_id = v_c.id AND a.estado <> 'publicado' AND a.estado <> 'anulado'
                        AND a.anulado_por_id IS NULL) THEN
    v_antes := jsonb_build_object('cuota_estado', v_c.cuota_estado, 'estado', v_c.estado,
      'pagada_at', v_c.pagada_at, 'fecha_pago', v_c.fecha_pago, 'metodo_pago', v_c.metodo_pago);
    UPDATE public.cuotas_condominio c
       SET cuota_estado = 'pagada', pagada_at = v_ahora, estado = 'pagado',
           fecha_pago = CURRENT_DATE, metodo_pago = v_metodo
     WHERE c.id = v_c.id;
    INSERT INTO public.conta_sf_cuota_estado_eventos
      (company_id, project_id, cuota_id, accion, disparo, saldo, valores_antes, valores_despues, ocurrido_at)
    VALUES
      (v_c.company_id, v_c.project_id, v_c.id, 'marcada', p_disparo, v_saldo, v_antes,
       jsonb_build_object('cuota_estado', 'pagada', 'estado', 'pagado', 'pagada_at', v_ahora,
                          'fecha_pago', CURRENT_DATE, 'metodo_pago', v_metodo),
       v_ahora);
    RETURN 'marcada';
  END IF;

  -- 2 · RESTAURAR: la marcó esta regla, nadie la cambió después y vuelve a
  -- deber.
  IF v_ev.accion = 'marcada' AND v_c.cuota_estado = 'pagada'
     AND v_c.metodo_pago IN ('saldo_a_favor','nota_credito')
     AND v_c.pagada_at IS NOT DISTINCT FROM (v_ev.valores_despues->>'pagada_at')::timestamptz
     AND v_saldo > 0 THEN
    UPDATE public.cuotas_condominio c
       SET cuota_estado = v_ev.valores_antes->>'cuota_estado',
           estado       = v_ev.valores_antes->>'estado',
           pagada_at    = (v_ev.valores_antes->>'pagada_at')::timestamptz,
           fecha_pago   = (v_ev.valores_antes->>'fecha_pago')::date,
           metodo_pago  = v_ev.valores_antes->>'metodo_pago'
     WHERE c.id = v_c.id;
    INSERT INTO public.conta_sf_cuota_estado_eventos
      (company_id, project_id, cuota_id, accion, disparo, saldo, valores_antes, valores_despues, ocurrido_at)
    VALUES
      (v_c.company_id, v_c.project_id, v_c.id, 'restaurada', p_disparo, v_saldo, v_ev.valores_despues,
       v_ev.valores_antes, v_ahora);
    RETURN 'restaurada';
  END IF;

  RETURN 'sin_cambio';
END;
$$;

-- conta_tg_asiento_sf_cuota: cuerpo de 20261009000000 + el asiento de una
-- nota de crédito (publicado o reversado desde Pólizas).
CREATE OR REPLACE FUNCTION public.conta_tg_asiento_sf_cuota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cuota uuid;
BEGIN
  IF NEW.origen_tabla = 'conta_saldo_favor_aplicaciones' THEN
    FOR v_cuota IN SELECT x.cuota_id FROM public.conta_saldo_favor_aplicaciones x
                    WHERE x.asiento_id = NEW.id AND x.cuota_id IS NOT NULL LOOP
      PERFORM public.conta_cuota_sincronizar_estado(v_cuota, 'asiento_aplicacion');
    END LOOP;
  ELSIF NEW.origen_tabla = 'conta_notas_credito' THEN
    FOR v_cuota IN SELECT n.cuota_id FROM public.conta_notas_credito n
                    WHERE n.asiento_id = NEW.id AND n.cuota_id IS NOT NULL LOOP
      PERFORM public.conta_cuota_sincronizar_estado(v_cuota, 'asiento_nota_credito');
    END LOOP;
    PERFORM public.conta_cargo_sincronizar_estado(n.cargo_adicional_id)
       FROM public.conta_notas_credito n
      WHERE n.asiento_id = NEW.id AND n.cargo_adicional_id IS NOT NULL;
  ELSIF NEW.origen_tabla = 'pagos' THEN
    FOR v_cuota IN SELECT DISTINCT x.cuota_id FROM public.conta_cobro_aplicaciones x
                    WHERE x.asiento_id = NEW.id LOOP
      PERFORM public.conta_cuota_sincronizar_estado(v_cuota, 'asiento_cobro');
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER trg_conta_asiento_sf_cuota ON public.conta_asientos;
CREATE TRIGGER trg_conta_asiento_sf_cuota
  AFTER UPDATE OF estado, anulado_por_id ON public.conta_asientos
  FOR EACH ROW
  WHEN (NEW.origen_tabla IN ('conta_saldo_favor_aplicaciones','pagos','conta_notas_credito')
        AND (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.anulado_por_id IS DISTINCT FROM NEW.anulado_por_id))
  EXECUTE FUNCTION public.conta_tg_asiento_sf_cuota();

-- conta_cargo_sincronizar_estado: cuerpo de 20261007000000; también si
-- sólo intervino una nota de crédito.
CREATE OR REPLACE FUNCTION public.conta_cargo_sincronizar_estado(p_cargo_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_derivado text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = p_cargo_id)
     AND NOT EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                      WHERE x.cargo_adicional_id = p_cargo_id)
     AND NOT EXISTS (SELECT 1 FROM public.conta_notas_credito n
                      WHERE n.cargo_adicional_id = p_cargo_id) THEN
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

-- conta_tg_cargo_cobros_guard: cuerpo de 20261007000000; una nota de
-- crédito cuenta como un cobro (no se borra el cargo, no cambia su importe
-- ni se anula con una nota viva).
CREATE OR REPLACE FUNCTION public.conta_tg_cargo_cobros_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_vivos    boolean;
  v_alguno   boolean;
  v_derivado text;
BEGIN
  v_alguno := EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = OLD.id)
             OR EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                         WHERE x.cargo_adicional_id = OLD.id)
             OR EXISTS (SELECT 1 FROM public.conta_notas_credito n
                         WHERE n.cargo_adicional_id = OLD.id);

  IF TG_OP = 'DELETE' THEN
    IF v_alguno THEN
      RAISE EXCEPTION 'CARGO_CON_COBROS: el cargo tiene cobros registrados (historia contable); no se borra. Anúlalo si no tiene cobros vivos.'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;

  v_vivos  := EXISTS (SELECT 1 FROM public.pagos p
                       WHERE p.cargo_adicional_id = OLD.id
                         AND p.deleted_at IS NULL AND p.estado <> 'rechazado')
             OR EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x
                         WHERE x.cargo_adicional_id = OLD.id AND public.conta_sf_asiento_vivo(x.asiento_id))
             OR EXISTS (SELECT 1 FROM public.conta_notas_credito n
                         WHERE n.cargo_adicional_id = OLD.id AND public.conta_sf_asiento_vivo(n.asiento_id));

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

-- ── 7. Dependencias: una nota viva o una rebaja abierta impiden anular ──────
-- conta_cuota_dependencias: cuerpo de 20261012000000 + notas y rebajas.
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
         'Espera la confirmación o el rechazo del proveedor.'
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

-- conta_ajuste_dependencias: cuerpo de 20261012000000 + notas del cargo.
CREATE OR REPLACE FUNCTION public.conta_ajuste_dependencias(p_tipo text, p_documento_id uuid)
RETURNS TABLE (dependencia text, id uuid, monto numeric, estado text, detalle text, como_resolver text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión con empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('anular_cuota','anular_cargo') THEN
    RAISE EXCEPTION 'AJUSTE_TIPO: sólo se consultan dependencias de anular_cuota y anular_cargo.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.conta_ajuste_puede_solicitar(p_tipo) THEN
    RAISE EXCEPTION 'No autorizado para solicitar este ajuste.' USING ERRCODE = '42501';
  END IF;

  IF p_tipo = 'anular_cuota' THEN
    IF NOT EXISTS (SELECT 1 FROM public.cuotas_condominio c
                    WHERE c.id = p_documento_id AND c.company_id = v_company
                      AND public.can_access_project(c.project_id)) THEN
      RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY SELECT * FROM public.conta_cuota_dependencias(p_documento_id, true);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.cargos_adicionales_unidad ca
                    WHERE ca.id = p_documento_id AND ca.company_id = v_company
                      AND public.can_access_project(ca.project_id)) THEN
      RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY
      SELECT 'cobro'::text, p.id, p.monto, p.estado,
             'Cobro ' || COALESCE(p.metodo, '') || COALESCE(' ref. ' || NULLIF(p.referencia, ''), ''),
             'Solicita anular el cobro antes de anular el cargo.'
        FROM public.pagos p
       WHERE p.cargo_adicional_id = p_documento_id AND p.deleted_at IS NULL
         AND p.estado IS DISTINCT FROM 'rechazado'
      UNION ALL
      SELECT 'aplicacion_saldo_favor', x.id, x.monto, 'viva',
             'Aplicación de saldo a favor del ' || to_char(x.created_at, 'YYYY-MM-DD'),
             'Solicita revertir la aplicación (Contabilidad › Saldos a favor).'
        FROM public.conta_saldo_favor_aplicaciones x
       WHERE x.cargo_adicional_id = p_documento_id AND x.revertida_at IS NULL
      UNION ALL
      SELECT 'nota_credito', n.id, n.monto, 'viva',
             'Nota de crédito del ' || to_char(n.created_at, 'YYYY-MM-DD'),
             'Reversa la póliza de la nota de crédito (Contabilidad › Pólizas) antes de anular el cargo.'
        FROM public.conta_notas_credito n
       WHERE n.cargo_adicional_id = p_documento_id AND public.conta_sf_asiento_vivo(n.asiento_id)
      UNION ALL
      SELECT 'solicitud_rebaja', s.id, s.importe, s.estado,
             'Solicitud abierta de rebaja de importe',
             'Recházala o que la cancele quien la pidió.'
        FROM public.conta_ajustes_solicitudes s
       WHERE s.tipo = 'ajuste_importe' AND s.documento_id = p_documento_id
         AND s.estado IN ('pendiente','fallida');
  END IF;
END;
$$;

-- ── 8. Flujo de solicitudes ─────────────────────────────────────────────────
-- Registrar la nota (INTERNA): sólo dentro de la ejecución de su solicitud.
CREATE FUNCTION public.conta_nota_credito_registrar(p_sol public.conta_ajustes_solicitudes)
RETURNS public.conta_notas_credito
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nc      public.conta_notas_credito;
  v_cuota   public.cuotas_condominio;
  v_cargo   public.cargos_adicionales_unidad;
  v_q       record;
  v_s       record;
  v_coh     record;
  v_saldo   numeric(14,2);
  v_cxc     uuid;
  v_aux     uuid;
  v_unidad  uuid;
  v_tipo    text;
  v_moneda  text;
  v_ledger  uuid;
  v_ajuste  uuid;
  v_id      uuid := gen_random_uuid();
  v_asiento uuid;
  v_estado  text;
BEGIN
  PERFORM public.conta_ajuste_exigir('ajuste_importe', p_sol.documento_id);

  -- Idempotente por solicitud.
  SELECT * INTO v_nc FROM public.conta_notas_credito n WHERE n.solicitud_id = p_sol.id;
  IF v_nc.id IS NOT NULL THEN
    RETURN v_nc;
  END IF;

  -- Documento (ya bloqueado por la revalidación) y candado de sus cobros: un
  -- cobro del mismo documento se contabiliza antes o después, nunca a la vez.
  IF p_sol.documento_tabla = 'cuotas_condominio' THEN
    SELECT * INTO v_cuota FROM public.cuotas_condominio c WHERE c.id = p_sol.documento_id FOR UPDATE;
  ELSE
    SELECT * INTO v_cargo FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_sol.documento_id FOR UPDATE;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtext(CASE WHEN p_sol.documento_tabla = 'cuotas_condominio' THEN 'conta_cobro_cuota' ELSE 'conta_cobro_cargo' END),
    hashtext(p_sol.documento_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                  WHERE i.origen_tabla = p_sol.documento_tabla AND i.origen_id = p_sol.documento_id) THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_HISTORICO: el documento es anterior a la contabilización por tipo (no tiene devengo por auxiliar); no se rebaja por este flujo.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (v_cuota.id IS NOT NULL AND (v_cuota.deleted_at IS NOT NULL OR COALESCE(v_cuota.cuota_estado, '') = 'anulada'))
     OR (v_cargo.id IS NOT NULL AND v_cargo.estado = 'anulado') THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento está anulado o eliminado.' USING ERRCODE = 'check_violation';
  END IF;
  -- Un cobro esperando contabilizarse cambiaría el saldo: primero ése.
  IF EXISTS (
    SELECT 1 FROM public.pagos p2
     WHERE (CASE WHEN v_cuota.id IS NOT NULL
                 THEN (p2.cuota_id = v_cuota.id OR p2.id = v_cuota.pago_id)
                 ELSE p2.cargo_adicional_id = v_cargo.id END)
       AND p2.deleted_at IS NULL AND p2.estado IN ('verificado','aplicado')
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'pagos' AND i.origen_id = p2.id)
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                        WHERE a.company_id = p_sol.company_id AND a.origen = 'automatico'
                          AND a.origen_tabla = 'pagos' AND a.origen_id = p2.id
                          AND a.origen_evento = 'pago_contabilizado'))
  THEN
    RAISE EXCEPTION 'AJUSTE_COBROS_PENDIENTES: el documento tiene cobros pendientes de contabilizar; su saldo todavía no se conoce. Resuélvelos y reintenta.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- La línea de CxC del devengo del componente, y su saldo.
  IF v_cuota.id IS NOT NULL THEN
    SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(v_cuota.id);
    IF p_sol.componente = 'principal' THEN
      IF v_q.princ_asiento_id IS NULL OR v_q.princ_estado <> 'publicado' THEN
        RAISE EXCEPTION 'AJUSTE_DEVENGO_PENDIENTE: la cuota todavía no tiene su devengo publicado.' USING ERRCODE = 'check_violation';
      END IF;
      IF v_q.princ_monto IS DISTINCT FROM v_cuota.monto::numeric(14,2) THEN
        RAISE EXCEPTION 'AJUSTE_DOCUMENTO_DESALINEADO: el importe de la cuota no concuerda con su devengo; corrígelo antes de rebajar.' USING ERRCODE = 'check_violation';
      END IF;
      v_saldo := GREATEST(v_q.princ_monto - v_q.aplicado_princ, 0);
      v_cxc := v_q.princ_cuenta_id; v_aux := v_q.princ_auxiliar; v_unidad := v_q.princ_unidad;
      v_tipo := v_q.princ_tipo_cargo; v_moneda := v_q.princ_moneda;
    ELSE
      IF v_q.mora_asiento_id IS NULL OR v_q.mora_estado <> 'publicado' THEN
        RAISE EXCEPTION 'AJUSTE_DEVENGO_PENDIENTE: la cuota no tiene mora devengada y publicada que rebajar.' USING ERRCODE = 'check_violation';
      END IF;
      IF v_q.mora_monto IS DISTINCT FROM COALESCE(v_cuota.mora_monto, 0)::numeric(14,2) THEN
        RAISE EXCEPTION 'AJUSTE_DOCUMENTO_DESALINEADO: la mora de la cuota no concuerda con su devengo; corrígela antes de rebajar.' USING ERRCODE = 'check_violation';
      END IF;
      v_saldo := GREATEST(v_q.mora_monto - v_q.aplicado_mora, 0);
      v_cxc := v_q.mora_cuenta_id; v_aux := v_q.mora_auxiliar; v_unidad := v_q.mora_unidad;
      v_tipo := v_q.mora_tipo_cargo; v_moneda := v_q.mora_moneda;
    END IF;
  ELSE
    SELECT * INTO v_s FROM public.conta_cargo_saldo_cobro(v_cargo.id);
    IF v_s.devengo_asiento_id IS NULL OR v_s.devengo_estado <> 'publicado' THEN
      RAISE EXCEPTION 'AJUSTE_DEVENGO_PENDIENTE: el cargo todavía no tiene su devengo publicado.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT k.codigo, k.motivo INTO v_coh FROM public.conta_cargo_coherencia_devengo(v_cargo.id) k;
    IF v_coh.codigo IS NOT NULL THEN
      RAISE EXCEPTION 'AJUSTE_DOCUMENTO_DESALINEADO: %', v_coh.motivo USING ERRCODE = 'check_violation';
    END IF;
    v_saldo := GREATEST(v_s.devengo_monto - v_s.aplicado, 0);
    v_cxc := v_s.cuenta_id; v_aux := v_s.auxiliar_cliente_id; v_unidad := v_s.unidad_id; v_tipo := v_s.tipo_cargo;
    SELECT COALESCE(l.moneda_origen, a.moneda_base) INTO v_moneda
      FROM public.conta_asientos a
      JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id AND l.debe > 0
     WHERE a.id = v_s.devengo_asiento_id ORDER BY l.orden LIMIT 1;
  END IF;

  -- (c) Tope: el saldo pendiente del componente, releído con todo bloqueado.
  IF p_sol.importe > v_saldo THEN
    RAISE EXCEPTION 'AJUSTE_REBAJA_EXCEDE_SALDO: el saldo pendiente es % %; la rebaja de % no puede superarlo (no genera saldo a favor). Rechaza esta solicitud y crea otra por un importe menor.',
      v_saldo, COALESCE(v_moneda, ''), p_sol.importe USING ERRCODE = 'check_violation';
  END IF;

  -- (a) La cuenta especial, del MISMO ledger que la CxC.
  SELECT c.project_id INTO v_ledger FROM public.conta_cuentas c WHERE c.id = v_cxc;
  v_ajuste := public.conta_exigir_cuenta_especial(p_sol.company_id, v_ledger, 'ajustes_bonificaciones');

  -- El asiento: cargo a ajustes, abono a la CxC del devengo. Fecha: hoy (e).
  v_asiento := public.conta_generar_asiento(
    p_sol.company_id, v_ledger, 'conta_notas_credito', v_id, 'nota_credito', CURRENT_DATE,
    'Nota de crédito · '
      || CASE WHEN v_cuota.id IS NOT NULL
              THEN CASE p_sol.componente WHEN 'mora' THEN 'mora de cuota ' ELSE 'cuota ' END
                   || v_cuota.concepto || ' ' || v_cuota.periodo
              ELSE 'cargo ' || v_cargo.concepto END,
    'diario', v_moneda,
    jsonb_build_array(
      jsonb_build_object('cuenta_id', v_ajuste, 'debe', p_sol.importe,
        'descripcion', 'Rebaja de importe: ' || left(p_sol.motivo, 200),
        'auxiliar_cliente_id', v_aux, 'unidad_id', v_unidad),
      jsonb_build_object('cuenta_id', v_cxc, 'haber', p_sol.importe,
        'descripcion', 'Nota de crédito', 'auxiliar_cliente_id', v_aux, 'unidad_id', v_unidad,
        'tipo_cargo', v_tipo)));
  IF v_asiento IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_SIN_ASIENTO: no se pudo generar el asiento de la nota de crédito (revisa que las cuentas sigan activas y en esta contabilidad). No se rebajó nada.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.estado INTO v_estado FROM public.conta_asientos a WHERE a.id = v_asiento;
  IF v_estado <> 'publicado' THEN
    RAISE EXCEPTION 'AJUSTE_SIN_TIPO_CAMBIO: falta el tipo de cambio de % hacia la moneda base para el mes de hoy; el asiento no se puede publicar. No se rebajó nada.',
      v_moneda USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.conta_notas_credito
    (id, company_id, project_id, solicitud_id, cuota_id, cargo_adicional_id, componente, monto, moneda,
     saldo_antes, cliente_id, unidad_id, cuenta_ajuste_id, cuenta_cxc_id, asiento_id, motivo,
     solicitado_por, aprobado_por)
  VALUES
    (v_id, p_sol.company_id, p_sol.project_id, p_sol.id, v_cuota.id, v_cargo.id, p_sol.componente, p_sol.importe,
     v_moneda, v_saldo, v_aux, v_unidad, v_ajuste, v_cxc, v_asiento, p_sol.motivo,
     p_sol.solicitado_por, auth.uid())
  RETURNING * INTO v_nc;

  -- Documento cubierto: estado derivado.
  IF v_cuota.id IS NOT NULL THEN
    PERFORM public.conta_cuota_sincronizar_estado(v_cuota.id, 'nota_credito');
  ELSE
    PERFORM public.conta_cargo_sincronizar_estado(v_cargo.id);
  END IF;
  RETURN v_nc;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_nota_credito_registrar(public.conta_ajustes_solicitudes) FROM PUBLIC, anon, authenticated;

-- Solicitar una rebaja (back-office). No cambia nada: la ejecuta la
-- aprobación de otra persona.
CREATE FUNCTION public.conta_ajuste_solicitar_rebaja(
  p_id              uuid,
  p_documento_tabla text,
  p_documento_id    uuid,
  p_componente      text,
  p_importe         numeric,
  p_motivo          text
)
RETURNS TABLE (solicitud_id uuid, estado text, repetida boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  v_existe  public.conta_ajustes_solicitudes;
  v_sol     public.conta_ajustes_solicitudes;
  v_foto    jsonb;
  v_saldo   numeric;
  v_motivo  text := btrim(COALESCE(p_motivo, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.conta_ajuste_puede_solicitar('ajuste_importe') THEN
    RAISE EXCEPTION 'No autorizado para solicitar este ajuste.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_company_scope(v_company);

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_CLAVE: falta la clave de la solicitud.' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'AJUSTE_MOTIVO: indica el motivo (al menos 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF NOT ((p_documento_tabla = 'cuotas_condominio' AND p_componente IN ('principal','mora'))
          OR (p_documento_tabla = 'cargos_adicionales_unidad' AND p_componente = 'cargo')) THEN
    RAISE EXCEPTION 'AJUSTE_COMPONENTE: una cuota se rebaja en principal o mora; un cargo adicional, en cargo.' USING ERRCODE = '22023';
  END IF;
  IF p_importe IS NULL OR p_importe <= 0 OR p_importe <> round(p_importe, 2) THEN
    RAISE EXCEPTION 'AJUSTE_IMPORTE: el importe debe ser positivo y con dos decimales como máximo (sólo rebajas).' USING ERRCODE = '22023';
  END IF;

  -- IDEMPOTENCIA: la misma clave con los mismos datos devuelve la solicitud.
  SELECT * INTO v_existe FROM public.conta_ajustes_solicitudes s WHERE s.id = p_id;
  IF v_existe.id IS NOT NULL THEN
    IF v_existe.company_id IS DISTINCT FROM v_company OR v_existe.tipo IS DISTINCT FROM 'ajuste_importe'
       OR v_existe.documento_id IS DISTINCT FROM p_documento_id OR v_existe.componente IS DISTINCT FROM p_componente
       OR v_existe.importe IS DISTINCT FROM p_importe OR v_existe.motivo IS DISTINCT FROM v_motivo
       OR v_existe.solicitado_por IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'AJUSTE_CLAVE_REUSADA: esa clave ya identifica otra solicitud. No se registró nada.' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existe.id, v_existe.estado, true;
    RETURN;
  END IF;

  -- Documento en el ámbito (ajeno = inexistente).
  v_project := CASE p_documento_tabla
    WHEN 'cuotas_condominio' THEN (SELECT c.project_id FROM public.cuotas_condominio c
                                    WHERE c.id = p_documento_id AND c.company_id = v_company AND c.deleted_at IS NULL)
    ELSE (SELECT ca.project_id FROM public.cargos_adicionales_unidad ca
           WHERE ca.id = p_documento_id AND ca.company_id = v_company)
  END;
  IF v_project IS NULL OR NOT public.can_access_project(v_project) THEN
    RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  v_foto := public.conta_ajuste_foto(v_company, v_project, 'ajuste_importe', p_documento_tabla, p_documento_id, NULL, false);
  IF v_foto IS NULL THEN
    RAISE EXCEPTION 'El documento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  IF v_foto ->> 'estado' IN ('anulado','anulada') THEN
    RAISE EXCEPTION 'AJUSTE_DOCUMENTO_CAMBIO: el documento está anulado; no se rebaja.' USING ERRCODE = 'check_violation';
  END IF;

  -- (c) Se informa AHORA si excede (y se vuelve a comprobar al aprobar).
  v_saldo := public.conta_rebaja_saldo(p_documento_tabla, p_documento_id, p_componente);
  IF v_saldo IS NULL THEN
    RAISE EXCEPTION 'AJUSTE_DEVENGO_PENDIENTE: ese componente no tiene devengo publicado; no hay saldo que rebajar.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_importe > v_saldo THEN
    RAISE EXCEPTION 'AJUSTE_REBAJA_EXCEDE_SALDO: el saldo pendiente es %; la rebaja de % no puede superarlo (no genera saldo a favor).',
      v_saldo, p_importe USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.conta_ajustes_solicitudes (
      id, company_id, project_id, tipo, documento_tabla, documento_id, componente,
      importe, motivo, canal, solicitado_por, foto_documento)
    VALUES (
      p_id, v_company, v_project, 'ajuste_importe', p_documento_tabla, p_documento_id, p_componente,
      p_importe, v_motivo, 'backoffice', auth.uid(), v_foto || jsonb_build_object('saldo_componente', v_saldo))
    RETURNING * INTO v_sol;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'AJUSTE_YA_SOLICITADO: ya hay una solicitud de rebaja abierta (pendiente o fallida) para este documento. Resuélvela antes de pedir otra.'
      USING ERRCODE = '23505';
  END;

  PERFORM public.conta_ajuste_evento(v_sol, 'solicitada', NULL, 'pendiente', v_motivo);
  RETURN QUERY SELECT v_sol.id, v_sol.estado, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ajuste_solicitar_rebaja(uuid, text, uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_ajuste_solicitar_rebaja(uuid, text, uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.conta_ajuste_solicitar_rebaja(uuid, text, uuid, text, numeric, text) IS
  'E6: solicita rebajar el importe de una cuota (principal o mora) o de un cargo adicional, con motivo. Sólo rebajas, con tope en el saldo pendiente del componente. No cambia nada: la aprobación de otra persona registra la nota de crédito. Idempotente por p_id; una solicitud de rebaja abierta por documento.';

-- conta_ajuste_revalidar: cuerpo de 20261012000000 + ajuste_importe.
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

-- conta_ajuste_ejecutar: cuerpo de 20261012000000 + ajuste_importe.
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

-- ── 9. Estado de cuenta ─────────────────────────────────────────────────────
-- conta_estado_cuenta: cuerpo de 20261007000000; la nota de crédito es un
-- abono con su documento y componente.
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
                WHEN p.origen_tabla = 'conta_saldo_favor_aplicaciones' THEN
                  'Aplicación de saldo a favor'
                    || COALESCE(' · cuota ' || csf.concepto || ' ' || csf.periodo, '')
                    || COALESCE(' · cargo ' || casf.concepto, '')
                WHEN p.origen_tabla = 'conta_notas_credito' THEN
                  'Nota de crédito'
                    || COALESCE(' · cuota ' || cnc.concepto || ' ' || cnc.periodo, '')
                    || COALESCE(' · cargo ' || canc.concepto, '')
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
                WHEN p.origen_tabla = 'conta_notas_credito' AND p.origen = 'automatico' THEN nc.componente
                WHEN p.origen_tabla = 'conta_saldo_favor_aplicaciones' AND p.origen = 'automatico' THEN
                  CASE WHEN sfa.cargo_adicional_id IS NOT NULL THEN 'cargo'
                       WHEN p.tipo_cargo = 'recargo_mora' THEN 'mora' ELSE 'principal' END
                WHEN p.origen_tabla = 'pagos' AND p.origen = 'automatico' THEN
                  CASE WHEN ap.cargo_adicional_id IS NOT NULL THEN 'cargo'
                       WHEN p.tipo_cargo = 'recargo_mora' THEN 'mora' ELSE 'principal' END
                WHEN p.origen_evento LIKE 'cuota_mora%' THEN 'mora'
                WHEN p.origen_evento LIKE 'cuota_emitida%' THEN 'principal'
                WHEN p.origen_evento LIKE 'cargo_adicional_emitido%' THEN 'cargo'
              END,
             'cuota_id', COALESCE(ap.cuota_id, sfa.cuota_id, nc.cuota_id),
             'cargo_adicional_id', COALESCE(ap.cargo_adicional_id, sfa.cargo_adicional_id, nc.cargo_adicional_id),
             'saldo_favor_aplicacion_id', sfa.id,
             'nota_credito_id', nc.id,
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
      LEFT JOIN public.conta_saldo_favor_aplicaciones sfa
        ON p.origen = 'automatico' AND p.origen_tabla = 'conta_saldo_favor_aplicaciones' AND sfa.id = p.origen_id
      LEFT JOIN public.cuotas_condominio csf ON csf.id = sfa.cuota_id
      LEFT JOIN public.cargos_adicionales_unidad casf ON casf.id = sfa.cargo_adicional_id
      LEFT JOIN public.conta_notas_credito nc
        ON p.origen = 'automatico' AND p.origen_tabla = 'conta_notas_credito' AND nc.id = p.origen_id
      LEFT JOIN public.cuotas_condominio cnc ON cnc.id = nc.cuota_id
      LEFT JOIN public.cargos_adicionales_unidad canc ON canc.id = nc.cargo_adicional_id
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
           'movimientos', (SELECT j FROM filas),
           -- 20261007000000: el saldo a favor del sujeto, aparte del saldo de
           -- CxC (un remanente nunca estuvo en la CxC).
           'saldo_a_favor', public.conta_ec_saldo_favor(v_company, p_project_id, p_cliente_id, p_unidad_id,
                                                       p_desde, p_hasta))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

-- conta_estado_cuenta_conciliacion: cuerpo de 20261007000000; la línea de
-- CxC de una nota se concilia contra su documento y la nota viva al corte
-- descuenta del documento.
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
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'conta_saldo_favor_aplicaciones'
               THEN CASE WHEN sfa.cuota_id IS NOT NULL THEN 'cuotas_condominio' ELSE 'cargos_adicionales_unidad' END
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'conta_notas_credito'
               THEN CASE WHEN nc.cuota_id IS NOT NULL THEN 'cuotas_condominio' ELSE 'cargos_adicionales_unidad' END
           END AS doc_tabla,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_id
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos'
               THEN COALESCE(ap.cuota_id, ap.cargo_adicional_id)
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'conta_saldo_favor_aplicaciones'
               THEN COALESCE(sfa.cuota_id, sfa.cargo_adicional_id)
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'conta_notas_credito'
               THEN COALESCE(nc.cuota_id, nc.cargo_adicional_id)
           END AS doc_id
      FROM lin l
      LEFT JOIN public.conta_saldo_favor_aplicaciones sfa
        ON l.origen = 'automatico' AND l.origen_tabla = 'conta_saldo_favor_aplicaciones' AND sfa.id = l.origen_id
      LEFT JOIN public.conta_notas_credito nc
        ON l.origen = 'automatico' AND l.origen_tabla = 'conta_notas_credito' AND nc.id = l.origen_id
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
           ), 0)::numeric(14,2)
           -- aplicaciones de saldos a favor vivas al corte (20261007000000)
           + COALESCE((
             SELECT sum(CASE WHEN e.e = 'cuota_mora' THEN x.monto_mora ELSE x.monto_principal END)
               FROM public.conta_saldo_favor_aplicaciones x
               JOIN public.conta_asientos pa ON pa.id = x.asiento_id
              WHERE ((e.t = 'cuotas_condominio' AND x.cuota_id = e.id)
                     OR (e.t = 'cargos_adicionales_unidad' AND x.cargo_adicional_id = e.id))
                AND pa.estado = 'publicado'
                AND (p_corte IS NULL OR pa.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = pa.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte))
           ), 0)::numeric(14,2)
           -- notas de crédito vivas al corte (20261017000000, E6)
           + COALESCE((
             SELECT sum(n.monto)
               FROM public.conta_notas_credito n
               JOIN public.conta_asientos pa ON pa.id = n.asiento_id
              WHERE ((e.t = 'cuotas_condominio' AND n.cuota_id = e.id
                      AND n.componente = CASE WHEN e.e = 'cuota_mora' THEN 'mora' ELSE 'principal' END)
                     OR (e.t = 'cargos_adicionales_unidad' AND n.cargo_adicional_id = e.id))
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
           (SELECT COALESCE(sum(d.documentos), 0) FROM doc_saldo d)::numeric(14,2) AS documentos,
           public.conta_ec_saldo_favor(v_company, p_project_id, p_cliente_id, p_unidad_id, NULL, p_corte) AS sf
  )
  SELECT jsonb_build_object(
           'corte', p_corte,
           'saldo_contable', tot.contable,
           'saldo_documentos', tot.documentos,
           'diferencia', (tot.contable - tot.documentos)::numeric(14,2),
           'cuadra', tot.contable = tot.documentos AND NOT EXISTS (SELECT 1 FROM disc)
                     AND COALESCE((tot.sf->>'cuadra')::boolean, true),
           -- 20261007000000: el saldo a favor, del libro contra sus orígenes y
           -- aplicaciones vivos al corte.
           'saldo_a_favor', jsonb_build_object(
             'contable', tot.sf->'saldo_final', 'documentos', tot.sf->'saldo_documentos',
             'cuadra', tot.sf->'cuadra'),
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
