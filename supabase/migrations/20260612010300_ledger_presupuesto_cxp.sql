-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte G: presupuesto y CxP POR LEDGER
--
--   · presupuesto_partidas: la cuenta debe pertenecer al ledger del
--     presupuesto (trigger de validación).
--   · presupuesto_vs_real y presupuesto_partida_estado: ámbito EXACTO del
--     ledger (IS NOT DISTINCT FROM) — un gasto de proyecto ya no se compara
--     contra el presupuesto de la empresa (las cuentas son de catálogos
--     distintos bajo el modelo ledger).
--   · cxp_antiguedad_saldos y cxp_proyeccion_pagos: ámbito exacto del ledger
--     (p_project_id NULL = facturas de la empresa, no "todas").
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Partida ↔ cuenta del mismo ledger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_tg_partida_mismo_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_project uuid;
BEGIN
  SELECT project_id INTO v_project FROM public.presupuestos WHERE id = NEW.presupuesto_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_cuentas c
    WHERE c.id = NEW.cuenta_id
      AND c.company_id = NEW.company_id
      AND c.project_id IS NOT DISTINCT FROM v_project
  ) THEN
    RAISE EXCEPTION 'PRESUPUESTO_LEDGER: la cuenta no pertenece a la contabilidad (empresa/proyecto) del presupuesto.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuesto_partida_mismo_ledger ON public.presupuesto_partidas;
CREATE TRIGGER trg_presupuesto_partida_mismo_ledger
  BEFORE INSERT OR UPDATE OF cuenta_id ON public.presupuesto_partidas
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_tg_partida_mismo_ledger();

-- ── 2. Comparativo vs real: ámbito exacto del ledger ────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_vs_real(p_presupuesto_id uuid)
RETURNS TABLE (
  cuenta_id     uuid,
  codigo        text,
  nombre        text,
  naturaleza    text,
  periodo       text,
  presupuestado numeric,
  ejecutado     numeric,
  variacion     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH pres AS (
    SELECT * FROM public.presupuestos WHERE id = p_presupuesto_id
  ),
  reales AS (
    SELECT
      l.cuenta_id,
      a.periodo,
      SUM(CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber
               ELSE l.haber - l.debe END) AS ejecutado
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    JOIN pres ON true
    WHERE l.company_id = pres.company_id
      AND a.estado = 'publicado'
      AND a.periodo LIKE pres.anio::text || '-%'
      AND a.project_id IS NOT DISTINCT FROM pres.project_id
    GROUP BY l.cuenta_id, a.periodo
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.naturaleza,
    pp.periodo,
    pp.monto::numeric(14,2),
    COALESCE(r.ejecutado, 0)::numeric(14,2),
    (COALESCE(r.ejecutado, 0) - pp.monto)::numeric(14,2)
  FROM public.presupuesto_partidas pp
  JOIN public.conta_cuentas c ON c.id = pp.cuenta_id
  LEFT JOIN reales r ON r.cuenta_id = pp.cuenta_id AND r.periodo = pp.periodo
  WHERE pp.presupuesto_id = p_presupuesto_id
  ORDER BY c.codigo, pp.periodo
$$;

-- ── 3. Control presupuestario: ledger exacto (sin fallback empresa) ─────────
CREATE OR REPLACE FUNCTION public.presupuesto_partida_estado(
  p_company_id uuid,
  p_project_id uuid,
  p_cuenta_id  uuid,
  p_periodo    text
)
RETURNS TABLE (
  presupuesto_id uuid,
  presupuestado  numeric(14,2),
  ejecutado      numeric(14,2)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pres public.presupuestos;
BEGIN
  -- Bajo el modelo ledger el presupuesto aplicable es el del ÁMBITO EXACTO:
  -- las cuentas de un proyecto no existen en el presupuesto de la empresa.
  SELECT p.* INTO v_pres
  FROM public.presupuestos p
  WHERE p.company_id = p_company_id
    AND p.estado = 'aprobado'
    AND p.anio = substring(p_periodo, 1, 4)::int
    AND p.project_id IS NOT DISTINCT FROM p_project_id
  LIMIT 1;

  IF v_pres.id IS NULL THEN
    RETURN; -- sin presupuesto aprobado del ledger para ese año
  END IF;

  RETURN QUERY
  SELECT
    v_pres.id,
    COALESCE((SELECT pp.monto FROM public.presupuesto_partidas pp
              WHERE pp.presupuesto_id = v_pres.id
                AND pp.cuenta_id = p_cuenta_id AND pp.periodo = p_periodo), 0)::numeric(14,2),
    COALESCE((SELECT SUM(CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber
                              ELSE l.haber - l.debe END)
              FROM public.conta_asiento_lineas l
              JOIN public.conta_asientos a ON a.id = l.asiento_id
              JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
              WHERE l.company_id = p_company_id
                AND l.cuenta_id = p_cuenta_id
                AND a.estado = 'publicado'
                AND a.periodo = p_periodo
                AND a.project_id IS NOT DISTINCT FROM v_pres.project_id), 0)::numeric(14,2);
END;
$$;

-- ── 4. CxP: ámbito exacto del ledger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cxp_antiguedad_saldos(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS TABLE (
  proveedor_id uuid,
  proveedor    text,
  total        numeric,
  corriente    numeric,
  d1_30        numeric,
  d31_60       numeric,
  d61_90       numeric,
  d90_mas      numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    p.id,
    p.nombre,
    SUM(f.monto_total - f.monto_pagado)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento IS NULL OR f.fecha_vencimiento >= CURRENT_DATE
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento BETWEEN 1 AND 30
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento BETWEEN 31 AND 60
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento BETWEEN 61 AND 90
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento > 90
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2)
  FROM public.facturas_proveedor f
  JOIN public.proveedores p ON p.id = f.proveedor_id
  WHERE f.company_id = p_company_id
    AND f.estado IN ('aprobada','pagada_parcial')
    AND f.project_id IS NOT DISTINCT FROM p_project_id
  GROUP BY p.id, p.nombre
  ORDER BY 3 DESC
$$;

CREATE OR REPLACE FUNCTION public.cxp_proyeccion_pagos(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS TABLE (
  proveedor_id uuid,
  proveedor    text,
  total        numeric,
  vencido      numeric,
  d0_7         numeric,
  d8_14        numeric,
  d15_30       numeric,
  d31_mas      numeric,
  sin_fecha    numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    p.id,
    p.nombre,
    SUM(f.monto_total - f.monto_pagado)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE BETWEEN 0 AND 7
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE BETWEEN 8 AND 14
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE BETWEEN 15 AND 30
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE > 30
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento IS NULL
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2)
  FROM public.facturas_proveedor f
  JOIN public.proveedores p ON p.id = f.proveedor_id
  WHERE f.company_id = p_company_id
    AND f.estado IN ('aprobada','pagada_parcial')
    AND f.project_id IS NOT DISTINCT FROM p_project_id
  GROUP BY p.id, p.nombre
  ORDER BY 4 DESC, 3 DESC
$$;
