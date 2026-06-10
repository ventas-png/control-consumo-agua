-- ════════════════════════════════════════════════════════════════════════════
-- BANCOS Y CONCILIACIÓN — FASE 4 ERP · parte B: RPCs
--
--   conta_generar_asiento (v2)     — ahora una línea puede traer 'cuenta_id'
--                                    directo (además de 'evento'); lo usan los
--                                    ajustes bancarios, que asientan contra la
--                                    cuenta contable específica del banco
--   banco_sugerencias_conciliacion — matching automático por monto exacto y
--                                    ventana de fecha (±3 días) contra pagos
--                                    (ingresos) y órdenes de pago (egresos)
--   banco_conciliar_movimiento     — concilia validando tenant + duplicidad
--   banco_desconciliar_movimiento  — revierte una conciliación
--   banco_ajuste_conciliacion      — comisión/interés: genera el asiento
--                                    (banco contra gasto_otros/ingreso_otros)
--                                    y concilia el movimiento contra él
--   banco_estado_conciliacion      — saldo libro vs saldo banco por periodo
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. conta_generar_asiento v2: líneas con cuenta_id directo ───────────────
-- Misma firma y comportamiento que la Fase 1; único cambio: la resolución de
-- cuenta de cada línea acepta jsonb 'cuenta_id' (uuid de conta_cuentas) con
-- prioridad sobre 'evento' (mapeo). CREATE OR REPLACE es seguro: en BDs ya
-- migradas solo re-define la función.
CREATE OR REPLACE FUNCTION public.conta_generar_asiento(
  p_company_id   uuid,
  p_project_id   uuid,
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_fecha        date,
  p_concepto     text,
  p_tipo         text,
  p_moneda_doc   text,
  p_lineas       jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_base       text;
  v_doc        text;
  v_tasa       numeric(12,6) := 1;
  v_publicar   boolean := true;
  v_concepto   text := p_concepto;
  v_fecha      date := COALESCE(p_fecha, CURRENT_DATE);
  v_asiento_id uuid;
  v_linea      jsonb;
  v_cuenta     uuid;
  v_orden      int := 0;
  v_debe       numeric(14,2);
  v_haber      numeric(14,2);
  v_tot_debe   numeric(14,2) := 0;
  v_tot_haber  numeric(14,2) := 0;
  v_diff       numeric(14,2);
BEGIN
  -- Sin catálogo seedeado → la empresa aún no usa contabilidad; salir sin ruido.
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = p_company_id) THEN
    RETURN NULL;
  END IF;

  -- Resolución de cuentas ANTES de insertar: cuenta_id directo (debe ser una
  -- cuenta de detalle de la empresa) o evento→mapeo; si falta, no se asienta.
  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    IF v_linea ? 'cuenta_id' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.conta_cuentas
        WHERE id = (v_linea->>'cuenta_id')::uuid
          AND company_id = p_company_id AND es_detalle
      ) THEN
        RAISE WARNING 'conta_generar_asiento: cuenta_id % inválida para company % — asiento % omitido',
          v_linea->>'cuenta_id', p_company_id, p_evento;
        RETURN NULL;
      END IF;
    ELSIF public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento') IS NULL THEN
      RAISE WARNING 'conta_generar_asiento: falta mapeo % para company % — asiento % omitido',
        v_linea->>'evento', p_company_id, p_evento;
      RETURN NULL;
    END IF;
  END LOOP;

  v_base := public.conta_moneda_base(p_company_id);
  v_doc  := COALESCE(public.conta_normalizar_moneda(p_moneda_doc), v_base);

  IF v_doc <> v_base THEN
    v_tasa := public.conta_tasa_vigente(p_company_id, v_doc, v_fecha);
    IF v_tasa IS NULL THEN
      -- Nunca inventar tasa: queda en borrador para revisión manual.
      v_tasa := 1;
      v_publicar := false;
      v_concepto := v_concepto || ' [SIN TIPO DE CAMBIO ' || v_doc || '→' || v_base || ']';
    END IF;
  END IF;

  -- Si el periodo del documento ya está cerrado, el asiento se fecha hoy.
  IF p_project_id IS NOT NULL
     AND public.conta_periodo_cerrado(p_project_id, to_char(v_fecha, 'YYYY-MM')) THEN
    v_fecha := CURRENT_DATE;
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, fecha, tipo, concepto, estado,
    origen, origen_tabla, origen_id, origen_evento, moneda_base
  )
  VALUES (
    p_company_id, p_project_id, v_fecha, p_tipo, v_concepto, 'borrador',
    'automatico', p_origen_tabla, p_origen_id, p_evento, v_base
  )
  ON CONFLICT (company_id, origen_tabla, origen_id, origen_evento)
    WHERE origen = 'automatico' AND estado <> 'anulado'
  DO NOTHING
  RETURNING id INTO v_asiento_id;

  IF v_asiento_id IS NULL THEN
    -- Ya contabilizado (idempotencia).
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RETURN NULL;
  END IF;

  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_orden := v_orden + 1;
    v_cuenta := CASE WHEN v_linea ? 'cuenta_id' THEN (v_linea->>'cuenta_id')::uuid
                     ELSE public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento')
                END;
    v_debe  := round(COALESCE((v_linea->>'debe')::numeric, 0)  * v_tasa, 2);
    v_haber := round(COALESCE((v_linea->>'haber')::numeric, 0) * v_tasa, 2);
    IF v_debe = 0 AND v_haber = 0 THEN CONTINUE; END IF;

    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber,
      moneda_origen, monto_origen, tipo_cambio
    )
    VALUES (
      v_asiento_id, p_company_id, v_cuenta, v_orden, v_linea->>'descripcion',
      v_debe, v_haber,
      CASE WHEN v_doc <> v_base THEN v_doc END,
      CASE WHEN v_doc <> v_base THEN COALESCE((v_linea->>'debe')::numeric, 0)
                                      + COALESCE((v_linea->>'haber')::numeric, 0) END,
      CASE WHEN v_doc <> v_base THEN v_tasa END
    );

    v_tot_debe  := v_tot_debe + v_debe;
    v_tot_haber := v_tot_haber + v_haber;
  END LOOP;

  -- Residuo de redondeo por conversión: se absorbe en la última línea del lado
  -- corto para garantizar debe = haber exacto.
  v_diff := v_tot_debe - v_tot_haber;
  IF v_diff <> 0 THEN
    IF v_diff > 0 THEN
      UPDATE public.conta_asiento_lineas SET haber = haber + v_diff
      WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = v_asiento_id AND haber > 0
                  ORDER BY orden DESC LIMIT 1);
      v_tot_haber := v_tot_haber + v_diff;
    ELSE
      UPDATE public.conta_asiento_lineas SET debe = debe - v_diff
      WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = v_asiento_id AND debe > 0
                  ORDER BY orden DESC LIMIT 1);
      v_tot_debe := v_tot_debe - v_diff;
    END IF;
  END IF;

  UPDATE public.conta_asientos
  SET total_debe  = v_tot_debe,
      total_haber = v_tot_haber,
      estado      = CASE WHEN v_publicar THEN 'publicado' ELSE 'borrador' END,
      numero      = CASE WHEN v_publicar THEN public.conta_siguiente_folio(p_company_id) END,
      publicado_at = CASE WHEN v_publicar THEN now() END,
      updated_at  = now()
  WHERE id = v_asiento_id;

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_asiento_id;
EXCEPTION WHEN OTHERS THEN
  -- La contabilidad nunca rompe la operación de negocio.
  RAISE WARNING 'conta_generar_asiento(%/%/%): %', p_origen_tabla, p_origen_id, p_evento, SQLERRM;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN NULL;
END;
$$;

-- ── 2. Sugerencias de conciliación ──────────────────────────────────────────
-- Para los movimientos PENDIENTES de la cuenta: ingresos (monto > 0) contra
-- pagos verificados/aplicados del mismo monto ±3 días; egresos (monto < 0)
-- contra órdenes de pago pagadas. Excluye candidatos ya conciliados con otro
-- movimiento. SECURITY INVOKER: la RLS de cada tabla aplica sola.
CREATE OR REPLACE FUNCTION public.banco_sugerencias_conciliacion(p_cuenta_bancaria_id uuid)
RETURNS TABLE (
  movimiento_id        uuid,
  candidato_tipo       text,
  candidato_id         uuid,
  candidato_fecha      date,
  candidato_monto      numeric,
  candidato_descripcion text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH mov AS (
    SELECT m.* FROM public.banco_movimientos m
    WHERE m.cuenta_bancaria_id = p_cuenta_bancaria_id AND m.estado = 'pendiente'
  )
  -- Ingresos ↔ pagos de clientes
  SELECT
    mov.id, 'pago', p.id,
    COALESCE(p.verified_at::date, p.created_at::date),
    p.monto,
    'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '')
  FROM mov
  JOIN public.pagos p
    ON p.estado IN ('verificado','aplicado')
   AND p.deleted_at IS NULL
   AND p.monto = mov.monto
   AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3
  JOIN public.projects pr ON pr.id = p.project_id AND pr.company_id = mov.company_id
  WHERE mov.monto > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'pago' AND x.match_id = p.id AND x.estado = 'conciliado'
    )
  UNION ALL
  -- Egresos ↔ órdenes de pago a proveedores
  SELECT
    mov.id, 'orden_pago', o.id,
    o.fecha_pago,
    -o.monto,
    'Pago a proveedor' || COALESCE(' ref. ' || NULLIF(o.referencia, ''), '')
  FROM mov
  JOIN public.ordenes_pago o
    ON o.estado = 'pagada'
   AND o.company_id = mov.company_id
   AND o.monto = -mov.monto
   AND o.fecha_pago IS NOT NULL
   AND abs(o.fecha_pago - mov.fecha) <= 3
  WHERE mov.monto < 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'orden_pago' AND x.match_id = o.id AND x.estado = 'conciliado'
    )
  ORDER BY 1, 4
$$;

REVOKE EXECUTE ON FUNCTION public.banco_sugerencias_conciliacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_sugerencias_conciliacion(uuid) TO authenticated;

-- ── 3. Conciliar / desconciliar ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.banco_conciliar_movimiento(
  p_movimiento_id uuid,
  p_match_tipo    text,
  p_match_id      uuid
)
RETURNS public.banco_movimientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_mov     public.banco_movimientos;
  v_company uuid;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR (v_mov.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_mov.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo un movimiento pendiente puede conciliarse (estado: %).', v_mov.estado
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_match_tipo NOT IN ('pago','orden_pago') THEN
    RAISE EXCEPTION 'match_tipo inválido: % (los ajustes usan banco_ajuste_conciliacion).', p_match_tipo
      USING ERRCODE = 'check_violation';
  END IF;

  -- El match debe existir y ser del mismo tenant.
  IF p_match_tipo = 'pago' THEN
    SELECT pr.company_id INTO v_company
    FROM public.pagos p JOIN public.projects pr ON pr.id = p.project_id
    WHERE p.id = p_match_id AND p.deleted_at IS NULL;
  ELSE
    SELECT o.company_id INTO v_company
    FROM public.ordenes_pago o WHERE o.id = p_match_id;
  END IF;
  IF v_company IS NULL OR v_company <> v_mov.company_id THEN
    RAISE EXCEPTION 'El documento a conciliar no existe o no pertenece a la empresa.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.banco_movimientos
  SET estado = 'conciliado',
      match_tipo = p_match_tipo,
      match_id = p_match_id,
      conciliado_por = auth.uid(),
      conciliado_at = now()
  WHERE id = p_movimiento_id
  RETURNING * INTO v_mov;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_mov;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.banco_conciliar_movimiento(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_conciliar_movimiento(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.banco_desconciliar_movimiento(p_movimiento_id uuid)
RETURNS public.banco_movimientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_mov public.banco_movimientos;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (v_mov.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_mov.estado <> 'conciliado' THEN
    RAISE EXCEPTION 'El movimiento no está conciliado.' USING ERRCODE = 'check_violation';
  END IF;
  -- Un ajuste generó asiento: anula primero la póliza (conta_anular_asiento).
  IF v_mov.match_tipo = 'ajuste' THEN
    RAISE EXCEPTION 'Este movimiento se concilió con un ajuste contable; anula primero su póliza.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.banco_movimientos
  SET estado = 'pendiente', match_tipo = NULL, match_id = NULL,
      conciliado_por = NULL, conciliado_at = NULL
  WHERE id = p_movimiento_id
  RETURNING * INTO v_mov;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_mov;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.banco_desconciliar_movimiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_desconciliar_movimiento(uuid) TO authenticated;

-- ── 4. Ajuste de conciliación (comisiones / intereses) ──────────────────────
-- Movimiento sin documento de negocio: genera la póliza contra la cuenta
-- contable del banco (egreso → gasto_otros; ingreso → ingreso_otros, mapeos
-- de la Fase 1) y concilia el movimiento contra ese asiento.
CREATE OR REPLACE FUNCTION public.banco_ajuste_conciliacion(
  p_movimiento_id uuid,
  p_descripcion   text DEFAULT NULL
)
RETURNS public.banco_movimientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_mov     public.banco_movimientos;
  v_cuenta  public.cuentas_bancarias;
  v_monto   numeric(14,2);
  v_asiento uuid;
  v_lineas  jsonb;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (
    public.is_super_admin()
    OR (v_mov.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_mov.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo un movimiento pendiente admite ajuste (estado: %).', v_mov.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_cuenta FROM public.cuentas_bancarias WHERE id = v_mov.cuenta_bancaria_id;
  v_monto := abs(v_mov.monto);

  IF v_mov.monto < 0 THEN
    -- Cargo bancario (comisión): gasto contra banco.
    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'gasto_otros', 'debe', v_monto,
                         'descripcion', COALESCE(p_descripcion, v_mov.descripcion)),
      jsonb_build_object('cuenta_id', v_cuenta.cuenta_contable_id, 'haber', v_monto)
    );
  ELSE
    -- Abono bancario (intereses): banco contra otros ingresos.
    v_lineas := jsonb_build_array(
      jsonb_build_object('cuenta_id', v_cuenta.cuenta_contable_id, 'debe', v_monto),
      jsonb_build_object('evento', 'ingreso_otros', 'haber', v_monto,
                         'descripcion', COALESCE(p_descripcion, v_mov.descripcion))
    );
  END IF;

  v_asiento := public.conta_generar_asiento(
    v_mov.company_id, NULL, 'banco_movimientos', v_mov.id, 'banco_ajuste',
    v_mov.fecha,
    'Ajuste bancario ' || v_cuenta.nombre || ' — ' ||
      COALESCE(p_descripcion, v_mov.descripcion, CASE WHEN v_mov.monto < 0 THEN 'comisión' ELSE 'intereses' END),
    CASE WHEN v_mov.monto < 0 THEN 'egreso' ELSE 'ingreso' END,
    v_cuenta.moneda,
    v_lineas
  );
  IF v_asiento IS NULL THEN
    RAISE EXCEPTION 'No se pudo generar la póliza de ajuste (revisa mapeos contables y tipos de cambio).'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.banco_movimientos
  SET estado = 'conciliado', match_tipo = 'ajuste', match_id = v_asiento,
      conciliado_por = auth.uid(), conciliado_at = now()
  WHERE id = p_movimiento_id
  RETURNING * INTO v_mov;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_mov;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.banco_ajuste_conciliacion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_ajuste_conciliacion(uuid, text) TO authenticated;

-- ── 5. Estado de conciliación por cuenta/periodo ────────────────────────────
-- Saldo libro = cuenta contable del banco (asientos publicados hasta el
-- periodo, en moneda base; si la cuenta tiene moneda propia, además en moneda
-- origen). Saldo banco = suma del extracto hasta el periodo (moneda del banco).
CREATE OR REPLACE FUNCTION public.banco_estado_conciliacion(
  p_cuenta_bancaria_id uuid,
  p_periodo            text
)
RETURNS TABLE (
  saldo_libro        numeric,
  saldo_libro_origen numeric,
  saldo_banco        numeric,
  pendientes         bigint,
  monto_pendiente    numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH cta AS (
    SELECT cb.*, COALESCE(cc.moneda IS NOT NULL, false) AS es_fx
    FROM public.cuentas_bancarias cb
    JOIN public.conta_cuentas cc ON cc.id = cb.cuenta_contable_id
    WHERE cb.id = p_cuenta_bancaria_id
  ),
  libro AS (
    SELECT
      COALESCE(SUM(l.debe - l.haber), 0)::numeric(14,2) AS saldo,
      COALESCE(SUM(CASE WHEN l.debe > 0 THEN COALESCE(l.monto_origen, l.debe)
                        ELSE -COALESCE(l.monto_origen, l.haber) END), 0)::numeric(14,2) AS saldo_origen
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN cta ON l.cuenta_id = cta.cuenta_contable_id
    WHERE a.estado = 'publicado' AND a.periodo <= p_periodo
  ),
  banco AS (
    SELECT
      COALESCE(SUM(m.monto) FILTER (WHERE m.estado <> 'descartado'), 0)::numeric(14,2) AS saldo,
      COUNT(*) FILTER (WHERE m.estado = 'pendiente') AS pendientes,
      COALESCE(SUM(m.monto) FILTER (WHERE m.estado = 'pendiente'), 0)::numeric(14,2) AS monto_pendiente
    FROM public.banco_movimientos m
    WHERE m.cuenta_bancaria_id = p_cuenta_bancaria_id
      AND to_char(m.fecha, 'YYYY-MM') <= p_periodo
  )
  SELECT
    libro.saldo,
    CASE WHEN (SELECT es_fx FROM cta) THEN libro.saldo_origen END,
    banco.saldo,
    banco.pendientes,
    banco.monto_pendiente
  FROM libro, banco
$$;

REVOKE EXECUTE ON FUNCTION public.banco_estado_conciliacion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_estado_conciliacion(uuid, text) TO authenticated;
