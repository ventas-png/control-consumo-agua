-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD (partida doble) — FASE 1 · parte B: RPCs
--
--   conta_normalizar_moneda    — helper: símbolos legacy → ISO 4217
--   conta_moneda_base          — helper: moneda base de una empresa
--   conta_siguiente_folio      — folio correlativo (FOR UPDATE sobre conta_folios)
--   conta_publicar_asiento     — valida y publica un borrador (SECURITY DEFINER,
--                                guard tenant+rol; única vía de publicación)
--   conta_anular_asiento       — anula: borrador→estado anulado; publicado→
--                                asiento de reverso publicado
--   conta_balanza_comprobacion — agregación por cuenta/periodo (INVOKER, RLS)
--   conta_libro_mayor          — movimientos de una cuenta con saldo acumulado
--
-- Lección del repo: REVOKE EXECUTE por nombre FROM PUBLIC y anon en cada
-- función; GRANT explícito solo a quien corresponde.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Normaliza monedas legacy de la app ('Q', '$', 'usd') a ISO 4217 mayúsculas.
CREATE OR REPLACE FUNCTION public.conta_normalizar_moneda(p_moneda text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(trim(COALESCE(p_moneda, '')))
    WHEN ''    THEN NULL
    WHEN 'Q'   THEN 'GTQ'
    WHEN '$'   THEN 'USD'
    WHEN 'US$' THEN 'USD'
    WHEN 'MX$' THEN 'MXN'
    ELSE upper(trim(p_moneda))
  END
$$;

REVOKE EXECUTE ON FUNCTION public.conta_normalizar_moneda(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_normalizar_moneda(text) TO authenticated;

-- Moneda base contable de la empresa (ISO), desde companies.default_currency.
CREATE OR REPLACE FUNCTION public.conta_moneda_base(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(public.conta_normalizar_moneda(default_currency), 'GTQ')
  FROM public.companies WHERE id = p_company_id
$$;

REVOKE EXECUTE ON FUNCTION public.conta_moneda_base(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_moneda_base(uuid) TO authenticated;

-- Tasa vigente: la más reciente con fecha <= p_fecha. NULL si no hay.
CREATE OR REPLACE FUNCTION public.conta_tasa_vigente(p_company_id uuid, p_moneda text, p_fecha date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT tasa FROM public.conta_tipos_cambio
  WHERE company_id = p_company_id AND moneda = p_moneda AND fecha <= p_fecha
  ORDER BY fecha DESC LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tasa_vigente(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_tasa_vigente(uuid, text, date) TO authenticated;

-- Folio correlativo por empresa. Solo lo llaman las funciones del sistema.
CREATE OR REPLACE FUNCTION public.conta_siguiente_folio(p_company_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_folio bigint;
BEGIN
  INSERT INTO public.conta_folios (company_id, ultimo) VALUES (p_company_id, 0)
  ON CONFLICT (company_id) DO NOTHING;
  SELECT ultimo + 1 INTO v_folio FROM public.conta_folios
  WHERE company_id = p_company_id FOR UPDATE;
  UPDATE public.conta_folios SET ultimo = v_folio WHERE company_id = p_company_id;
  RETURN v_folio;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_siguiente_folio(uuid) FROM PUBLIC, anon, authenticated;

-- ¿El periodo (YYYY-MM) de un proyecto está cerrado en cierres_mensuales?
CREATE OR REPLACE FUNCTION public.conta_periodo_cerrado(p_project_id uuid, p_periodo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cierres_mensuales
    WHERE project_id = p_project_id AND periodo = p_periodo AND estado = 'cerrado'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.conta_periodo_cerrado(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_periodo_cerrado(uuid, text) TO authenticated;

-- ── Publicar asiento ────────────────────────────────────────────────────────
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

  -- Todas las cuentas: de detalle, activas y de la misma empresa.
  SELECT count(*) INTO v_invalidas
  FROM public.conta_asiento_lineas l
  JOIN public.conta_cuentas c ON c.id = l.cuenta_id
  WHERE l.asiento_id = p_asiento_id
    AND (NOT c.es_detalle OR NOT c.activa OR c.company_id <> v_asiento.company_id);
  IF v_invalidas > 0 THEN
    RAISE EXCEPTION 'El asiento usa % cuenta(s) no válidas (agrupadoras, inactivas o de otra empresa).', v_invalidas
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
      numero       = public.conta_siguiente_folio(v_asiento.company_id),
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

REVOKE EXECUTE ON FUNCTION public.conta_publicar_asiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_publicar_asiento(uuid) TO authenticated;

-- ── Anular asiento ──────────────────────────────────────────────────────────
-- Borrador → estado 'anulado' directo. Publicado → asiento de REVERSO
-- publicado (líneas espejo); el original conserva estado 'publicado' y apunta
-- al reverso vía anulado_por_id (neto cero, rastro auditable completo).
-- Si el periodo original está cerrado, el reverso se fecha hoy.
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
    public.conta_siguiente_folio(v_asiento.company_id), v_fecha, v_asiento.tipo,
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

REVOKE EXECUTE ON FUNCTION public.conta_anular_asiento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_anular_asiento(uuid, text) TO authenticated;

-- ── Balanza de comprobación ─────────────────────────────────────────────────
-- SECURITY INVOKER: la RLS de conta_* aplica sola. Agrega TODO en servidor.
-- Devuelve solo cuentas de detalle con movimiento (la UI arma los rollups de
-- las agrupadoras con el árbol del catálogo). Montos en moneda base; las
-- cuentas con moneda propia reciben además el saldo en moneda origen.
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
    AND (p_project_id IS NULL OR a.project_id = p_project_id)
  GROUP BY c.id, c.codigo, c.nombre, c.tipo, c.naturaleza, c.moneda
  ORDER BY c.codigo
$$;

REVOKE EXECUTE ON FUNCTION public.conta_balanza_comprobacion(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_balanza_comprobacion(uuid, uuid, text) TO authenticated;

-- ── Libro mayor ─────────────────────────────────────────────────────────────
-- Movimientos de una cuenta en un rango, con saldo acumulado que parte del
-- saldo previo a p_desde. SECURITY INVOKER (RLS aplica).
CREATE OR REPLACE FUNCTION public.conta_libro_mayor(
  p_cuenta_id uuid,
  p_desde     date,
  p_hasta     date
)
RETURNS TABLE (
  linea_id    uuid,
  asiento_id  uuid,
  numero      bigint,
  fecha       date,
  concepto    text,
  descripcion text,
  debe        numeric,
  haber       numeric,
  saldo       numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH inicial AS (
    SELECT COALESCE(SUM(l.debe - l.haber), 0) AS saldo
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE l.cuenta_id = p_cuenta_id AND a.estado = 'publicado' AND a.fecha < p_desde
  )
  SELECT
    l.id,
    a.id,
    a.numero,
    a.fecha,
    a.concepto,
    l.descripcion,
    l.debe,
    l.haber,
    ((SELECT saldo FROM inicial)
      + SUM(l.debe - l.haber) OVER (ORDER BY a.fecha, a.numero, l.orden, l.id))::numeric(14,2)
  FROM public.conta_asiento_lineas l
  JOIN public.conta_asientos a ON a.id = l.asiento_id
  WHERE l.cuenta_id = p_cuenta_id
    AND a.estado = 'publicado'
    AND a.fecha BETWEEN p_desde AND p_hasta
  ORDER BY a.fecha, a.numero, l.orden, l.id
$$;

REVOKE EXECUTE ON FUNCTION public.conta_libro_mayor(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_libro_mayor(uuid, date, date) TO authenticated;
