-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte C: asientos, reportes y migración de datos
--
--   · conta_generar_asiento v3: el asiento se lleva en la MONEDA BASE DEL
--     LEDGER (empresa o proyecto) con conversión cruzada conta_tasa_entre;
--     las cuentas (directas o por mapeo) deben pertenecer al ledger; folio
--     correlativo del ledger. Misma firma de 10 args; los triggers de negocio
--     NO cambian.
--   · conta_publicar_asiento: valida que TODAS las cuentas de las líneas sean
--     del ledger del asiento; folio del ledger.
--   · conta_anular_asiento / conta_reversar_automatico: folio del ledger.
--   · Reportes (balanza, P&L, balance, flujo): p_project_id pasa de "filtro
--     (NULL = todo)" a IDENTIDAD del ledger (NULL = SOLO la empresa):
--       (p_project_id IS NULL OR a.project_id = p_project_id)
--         →  a.project_id IS NOT DISTINCT FROM p_project_id
--   · Migración de datos pre-ledger: los asientos con project_id creados bajo
--     el modelo anterior (cuentas y moneda de EMPRESA) se mueven al ledger de
--     la empresa (project_id = NULL) con nota [pre-ledger: <proyecto>] en el
--     concepto. Así los reportes de empresa no cambian un centavo y los
--     ledgers de proyecto arrancan limpios con su apertura.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. conta_generar_asiento v3 (moneda y cuentas del ledger) ───────────────
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
  -- Ledger sin catálogo → esa contabilidad aún no opera; salir sin ruido.
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_cuentas
    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RETURN NULL;
  END IF;

  -- Resolución de cuentas ANTES de insertar: cuenta_id directo (cuenta de
  -- detalle DEL LEDGER) o evento→mapeo del ledger; si falta, no se asienta.
  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    IF v_linea ? 'cuenta_id' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.conta_cuentas
        WHERE id = (v_linea->>'cuenta_id')::uuid
          AND company_id = p_company_id
          AND project_id IS NOT DISTINCT FROM p_project_id
          AND es_detalle
      ) THEN
        RAISE WARNING 'conta_generar_asiento: cuenta_id % no pertenece al ledger (%/%) — asiento % omitido',
          v_linea->>'cuenta_id', p_company_id, p_project_id, p_evento;
        RETURN NULL;
      END IF;
    ELSIF public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento') IS NULL THEN
      RAISE WARNING 'conta_generar_asiento: falta mapeo % en el ledger (%/%) — asiento % omitido',
        v_linea->>'evento', p_company_id, p_project_id, p_evento;
      RETURN NULL;
    END IF;
  END LOOP;

  -- Moneda base DEL LEDGER y conversión cruzada doc→base (pivote = empresa).
  v_base := public.conta_moneda_base(p_company_id, p_project_id);
  v_doc  := COALESCE(public.conta_normalizar_moneda(p_moneda_doc), v_base);

  IF v_doc <> v_base THEN
    v_tasa := public.conta_tasa_entre(p_company_id, v_doc, v_base, v_fecha);
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
      numero      = CASE WHEN v_publicar THEN public.conta_siguiente_folio(p_company_id, p_project_id) END,
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

-- ── 2. conta_publicar_asiento: cuentas del ledger + folio del ledger ────────
CREATE OR REPLACE FUNCTION public.conta_publicar_asiento(p_asiento_id uuid)
RETURNS public.conta_asientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_asiento   public.conta_asientos;
  v_debe      numeric(14,2);
  v_haber     numeric(14,2);
  v_invalidas int;
BEGIN
  SELECT * INTO v_asiento FROM public.conta_asientos WHERE id = p_asiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Guard tenant + rol (la función es DEFINER: valida explícito).
  IF NOT (
    public.is_super_admin()
    OR (v_asiento.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_asiento.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo un borrador puede publicarse (estado actual: %).', v_asiento.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0) INTO v_debe, v_haber
  FROM public.conta_asiento_lineas WHERE asiento_id = p_asiento_id;

  IF v_debe <= 0 OR v_debe <> v_haber THEN
    RAISE EXCEPTION 'Asiento descuadrado: debe % vs haber % (deben ser iguales y > 0).', v_debe, v_haber
      USING ERRCODE = 'check_violation';
  END IF;

  -- Todas las cuentas: de detalle, activas y DEL LEDGER del asiento.
  SELECT count(*) INTO v_invalidas
  FROM public.conta_asiento_lineas l
  JOIN public.conta_cuentas c ON c.id = l.cuenta_id
  WHERE l.asiento_id = p_asiento_id
    AND (NOT c.es_detalle OR NOT c.activa
         OR c.company_id <> v_asiento.company_id
         OR c.project_id IS DISTINCT FROM v_asiento.project_id);
  IF v_invalidas > 0 THEN
    RAISE EXCEPTION 'El asiento usa % cuenta(s) no válidas (agrupadoras, inactivas o de otra contabilidad).', v_invalidas
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_asiento.project_id IS NOT NULL
     AND public.conta_periodo_cerrado(v_asiento.project_id, v_asiento.periodo) THEN
    RAISE EXCEPTION 'El periodo % de este proyecto está cerrado.', v_asiento.periodo
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.conta_asientos
  SET estado       = 'publicado',
      numero       = public.conta_siguiente_folio(v_asiento.company_id, v_asiento.project_id),
      total_debe   = v_debe,
      total_haber  = v_haber,
      publicado_at = now(),
      updated_at   = now()
  WHERE id = p_asiento_id
  RETURNING * INTO v_asiento;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_asiento;
END;
$$;

-- ── 3. Reversos: folio del ledger ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_anular_asiento(p_asiento_id uuid, p_motivo text DEFAULT NULL)
RETURNS public.conta_asientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_asiento  public.conta_asientos;
  v_reverso  public.conta_asientos;
  v_fecha    date;
BEGIN
  SELECT * INTO v_asiento FROM public.conta_asientos WHERE id = p_asiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR (v_asiento.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_asiento.estado = 'anulado' THEN
    RAISE EXCEPTION 'El asiento ya está anulado.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_asiento.anulado_por_id IS NOT NULL THEN
    RAISE EXCEPTION 'El asiento ya fue reversado.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  IF v_asiento.estado = 'borrador' THEN
    UPDATE public.conta_asientos
    SET estado = 'anulado', updated_at = now()
    WHERE id = p_asiento_id
    RETURNING * INTO v_asiento;
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RETURN v_asiento;
  END IF;

  -- Publicado → reverso.
  v_fecha := CASE
    WHEN v_asiento.project_id IS NOT NULL
         AND public.conta_periodo_cerrado(v_asiento.project_id, v_asiento.periodo)
    THEN CURRENT_DATE
    ELSE v_asiento.fecha
  END;

  INSERT INTO public.conta_asientos (
    company_id, project_id, numero, fecha, tipo, concepto, estado,
    origen, origen_tabla, origen_id, origen_evento,
    moneda_base, total_debe, total_haber, reversa_de_id, created_by, publicado_at
  )
  VALUES (
    v_asiento.company_id, v_asiento.project_id,
    public.conta_siguiente_folio(v_asiento.company_id, v_asiento.project_id), v_fecha, v_asiento.tipo,
    'REVERSO de póliza #' || COALESCE(v_asiento.numero::text, '?')
      || COALESCE(' — ' || p_motivo, ''),
    'publicado', v_asiento.origen, v_asiento.origen_tabla, v_asiento.origen_id,
    CASE WHEN v_asiento.origen = 'automatico'
         THEN v_asiento.origen_evento || '_revertido' ELSE NULL END,
    v_asiento.moneda_base, v_asiento.total_haber, v_asiento.total_debe,
    v_asiento.id, auth.uid(), now()
  )
  RETURNING * INTO v_reverso;

  INSERT INTO public.conta_asiento_lineas (
    asiento_id, company_id, cuenta_id, orden, descripcion,
    debe, haber, moneda_origen, monto_origen, tipo_cambio
  )
  SELECT v_reverso.id, l.company_id, l.cuenta_id, l.orden, l.descripcion,
         l.haber, l.debe, l.moneda_origen, l.monto_origen, l.tipo_cambio
  FROM public.conta_asiento_lineas l
  WHERE l.asiento_id = v_asiento.id;

  UPDATE public.conta_asientos
  SET anulado_por_id = v_reverso.id, updated_at = now()
  WHERE id = v_asiento.id;

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_reverso;
END;
$$;

CREATE OR REPLACE FUNCTION public.conta_reversar_automatico(
  p_company_id      uuid,
  p_origen_tabla    text,
  p_origen_id       uuid,
  p_evento_original text,
  p_concepto        text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_original public.conta_asientos;
  v_reverso  public.conta_asientos;
  v_fecha    date;
BEGIN
  SELECT * INTO v_original FROM public.conta_asientos
  WHERE company_id = p_company_id AND origen = 'automatico'
    AND origen_tabla = p_origen_tabla AND origen_id = p_origen_id
    AND origen_evento = p_evento_original
    AND estado = 'publicado' AND anulado_por_id IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL; -- nada que reversar (no se contabilizó o ya fue reversado)
  END IF;

  v_fecha := CASE
    WHEN v_original.project_id IS NOT NULL
         AND public.conta_periodo_cerrado(v_original.project_id, v_original.periodo)
    THEN CURRENT_DATE
    ELSE v_original.fecha
  END;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, numero, fecha, tipo, concepto, estado,
    origen, origen_tabla, origen_id, origen_evento,
    moneda_base, total_debe, total_haber, reversa_de_id, publicado_at
  )
  VALUES (
    v_original.company_id, v_original.project_id,
    public.conta_siguiente_folio(p_company_id, v_original.project_id), v_fecha, v_original.tipo,
    p_concepto || ' (reverso de póliza #' || COALESCE(v_original.numero::text, '?') || ')',
    'publicado', 'automatico', p_origen_tabla, p_origen_id,
    p_evento_original || '_revertido',
    v_original.moneda_base, v_original.total_haber, v_original.total_debe,
    v_original.id, now()
  )
  ON CONFLICT (company_id, origen_tabla, origen_id, origen_evento)
    WHERE origen = 'automatico' AND estado <> 'anulado'
  DO NOTHING
  RETURNING * INTO v_reverso;

  IF v_reverso.id IS NULL THEN
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RETURN NULL; -- reverso ya existía
  END IF;

  INSERT INTO public.conta_asiento_lineas (
    asiento_id, company_id, cuenta_id, orden, descripcion,
    debe, haber, moneda_origen, monto_origen, tipo_cambio
  )
  SELECT v_reverso.id, l.company_id, l.cuenta_id, l.orden, l.descripcion,
         l.haber, l.debe, l.moneda_origen, l.monto_origen, l.tipo_cambio
  FROM public.conta_asiento_lineas l
  WHERE l.asiento_id = v_original.id;

  UPDATE public.conta_asientos
  SET anulado_por_id = v_reverso.id, updated_at = now()
  WHERE id = v_original.id;

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_reverso.id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'conta_reversar_automatico(%/%/%): %', p_origen_tabla, p_origen_id, p_evento_original, SQLERRM;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN NULL;
END;
$$;

-- ── 4. Reportes: p_project_id = identidad del ledger ────────────────────────
CREATE OR REPLACE FUNCTION public.conta_balanza_comprobacion(
  p_company_id uuid,
  p_project_id uuid,
  p_periodo    text
)
RETURNS TABLE (
  cuenta_id          uuid,
  codigo             text,
  nombre             text,
  tipo               text,
  naturaleza         text,
  moneda             text,
  saldo_inicial      numeric,
  cargos             numeric,
  abonos             numeric,
  saldo_final        numeric,
  saldo_final_origen numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.tipo,
    c.naturaleza,
    c.moneda,
    COALESCE(SUM(CASE WHEN a.periodo < p_periodo THEN l.debe - l.haber END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo = p_periodo THEN l.debe  END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo = p_periodo THEN l.haber END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo <= p_periodo THEN l.debe - l.haber END), 0)::numeric(14,2),
    CASE WHEN c.moneda IS NOT NULL THEN
      COALESCE(SUM(CASE WHEN a.periodo <= p_periodo
        THEN CASE WHEN l.debe > 0 THEN COALESCE(l.monto_origen, l.debe)
                  ELSE -COALESCE(l.monto_origen, l.haber) END
      END), 0)::numeric(14,2)
    END
  FROM public.conta_asiento_lineas l
  JOIN public.conta_asientos a ON a.id = l.asiento_id
  JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
  WHERE l.company_id = p_company_id
    AND a.estado = 'publicado'
    AND a.periodo <= p_periodo
    AND a.project_id IS NOT DISTINCT FROM p_project_id
  GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.naturaleza, c.moneda
  ORDER BY c.codigo
$$;

CREATE OR REPLACE FUNCTION public.conta_estado_resultados(
  p_company_id uuid,
  p_project_id uuid,
  p_desde      text,
  p_hasta      text
)
RETURNS TABLE (
  cuenta_id uuid,
  codigo    text,
  nombre    text,
  tipo      text,
  monto     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.tipo,
    SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
             ELSE l.debe - l.haber END)::numeric(14,2)
  FROM public.conta_asiento_lineas l
  JOIN public.conta_asientos a ON a.id = l.asiento_id
  JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
  WHERE l.company_id = p_company_id
    AND a.estado = 'publicado'
    AND a.tipo <> 'cierre'
    AND a.periodo BETWEEN p_desde AND p_hasta
    AND c.tipo IN ('ingreso','gasto')
    AND a.project_id IS NOT DISTINCT FROM p_project_id
  GROUP BY c.id, c.codigo, c.nombre, c.tipo
  HAVING SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                  ELSE l.debe - l.haber END) <> 0
  ORDER BY c.codigo
$$;

CREATE OR REPLACE FUNCTION public.conta_balance_general(
  p_company_id uuid,
  p_project_id uuid,
  p_periodo    text
)
RETURNS TABLE (
  cuenta_id uuid,
  codigo    text,
  nombre    text,
  tipo      text,
  saldo     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH lineas AS (
    SELECT l.cuenta_id, l.debe, l.haber
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE l.company_id = p_company_id
      AND a.estado = 'publicado'
      AND a.periodo <= p_periodo
      AND a.project_id IS NOT DISTINCT FROM p_project_id
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.tipo,
    SUM(CASE WHEN c.naturaleza = 'deudora' THEN x.debe - x.haber
             ELSE x.haber - x.debe END)::numeric(14,2)
  FROM lineas x
  JOIN public.conta_cuentas c ON c.id = x.cuenta_id
  WHERE c.tipo IN ('activo','pasivo','capital')
  GROUP BY c.id, c.codigo, c.nombre, c.tipo
  HAVING SUM(CASE WHEN c.naturaleza = 'deudora' THEN x.debe - x.haber
                  ELSE x.haber - x.debe END) <> 0
  UNION ALL
  SELECT
    NULL::uuid,
    'RESULTADO',
    'Resultado del periodo (sin cerrar)',
    'capital',
    COALESCE(SUM(x.haber - x.debe), 0)::numeric(14,2)
  FROM lineas x
  JOIN public.conta_cuentas c ON c.id = x.cuenta_id
  WHERE c.tipo IN ('ingreso','gasto')
  HAVING COALESCE(SUM(x.haber - x.debe), 0) <> 0
  ORDER BY 2
$$;

CREATE OR REPLACE FUNCTION public.conta_flujo_efectivo(
  p_company_id uuid,
  p_project_id uuid,
  p_periodo    text
)
RETURNS TABLE (
  cuenta_id     uuid,
  codigo        text,
  nombre        text,
  saldo_inicial numeric,
  entradas      numeric,
  salidas       numeric,
  saldo_final   numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH efectivo AS (
    SELECT DISTINCT cuenta_id FROM (
      SELECT m.cuenta_id
      FROM public.conta_mapeo_cuentas m
      WHERE m.company_id = p_company_id
        AND m.project_id IS NOT DISTINCT FROM p_project_id
        AND m.evento LIKE 'metodo_%'
      UNION
      -- Cuentas contables de bancos cuya cuenta pertenezca al ledger (las
      -- cuentas_bancarias ganan project_id en la parte D; mientras tanto el
      -- join por conta_cuentas.project_id ya acota correctamente el ledger).
      SELECT cb.cuenta_contable_id
      FROM public.cuentas_bancarias cb
      JOIN public.conta_cuentas cc ON cc.id = cb.cuenta_contable_id
      WHERE cb.company_id = p_company_id
        AND cc.project_id IS NOT DISTINCT FROM p_project_id
    ) q
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    COALESCE(SUM(CASE WHEN a.periodo < p_periodo THEN l.debe - l.haber END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo = p_periodo THEN l.debe  END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo = p_periodo THEN l.haber END), 0)::numeric(14,2),
    COALESCE(SUM(CASE WHEN a.periodo <= p_periodo THEN l.debe - l.haber END), 0)::numeric(14,2)
  FROM efectivo e
  JOIN public.conta_cuentas c ON c.id = e.cuenta_id
  LEFT JOIN public.conta_asiento_lineas l
    ON l.cuenta_id = e.cuenta_id AND l.company_id = p_company_id
  LEFT JOIN public.conta_asientos a
    ON a.id = l.asiento_id AND a.estado = 'publicado' AND a.periodo <= p_periodo
   AND a.project_id IS NOT DISTINCT FROM p_project_id
  GROUP BY c.id, c.codigo, c.nombre
  ORDER BY c.codigo
$$;

-- ── 5. Migración de datos pre-ledger ────────────────────────────────────────
-- Asientos con project_id creados bajo el modelo anterior: sus cuentas y
-- moneda son del catálogo de EMPRESA → pertenecen al ledger empresa. Se mueven
-- a project_id NULL con nota, así los reportes de empresa no cambian y los
-- ledgers de proyecto arrancan limpios.
DO $$
DECLARE v_movidos int;
BEGIN
  -- Pre-check: si al mover, alguna empresa quedaría con >1 apertura publicada
  -- en el ledger empresa, abortar con instrucción clara (resolver a mano).
  IF EXISTS (
    SELECT 1 FROM public.conta_asientos
    WHERE tipo = 'apertura' AND estado = 'publicado'
    GROUP BY company_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'LEDGER_MIGRACION: hay empresas con múltiples aperturas publicadas (empresa + proyecto). Anule las aperturas de proyecto antes de aplicar esta migración.';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.conta_asientos a
  SET concepto   = a.concepto || ' [pre-ledger: ' || COALESCE(p.nombre, 'proyecto') || ']',
      project_id = NULL,
      updated_at = now()
  FROM public.projects p
  WHERE p.id = a.project_id;
  GET DIAGNOSTICS v_movidos = ROW_COUNT;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  IF v_movidos > 0 THEN
    RAISE NOTICE 'LEDGER_MIGRACION: % asiento(s) pre-ledger movidos al ledger de la empresa.', v_movidos;
  END IF;
END $$;
