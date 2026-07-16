-- ============================================================================
-- Fundación analítica del TENANT: MV kpis_tenant_mensual + RPC de lectura
-- (auditoría 2026-07-16, C1/V2 — desbloquea C2–C5, D1–D4)
-- ============================================================================
-- Hoy toda la analítica del tenant se calcula EN EL NAVEGADOR sobre arrays
-- truncados a 5.000 filas (D1/D2): KPIs incorrectos en empresas grandes y cada
-- apertura de dashboard re-baja todo. El superadmin ya demostró el patrón
-- correcto (MV + refresh por cron + RPC SECURITY DEFINER); esto lo replica para
-- el tenant.
--
-- GRANO: (company_id, project_id, mes 'YYYY-MM'), unificando las dos verticales
-- (cuotas de condominio + recibos de agua) y el gasto, en una sola fila por mes.
-- Fuente única para los 3 dashboards de tenant (C2) y los comparativos (D1/D4).
--
-- FRESCURA: refresco CONCURRENTLY cada 15 min por pg_cron (mismo patrón y cadencia
-- que las MV del superadmin). El índice único habilita CONCURRENTLY (no bloquea).
--
-- SEGURIDAD: las MV NO soportan RLS. Se REVOCA SELECT a public/anon/authenticated
-- y el acceso pasa SIEMPRE por la RPC get_kpis_tenant_mensual, que acota a
-- company_id = get_my_company_id() (aislamiento por tenant preservado).
--
-- NOTA TZ: el mes de agua/gasto se deriva de `fecha` en UTC (to_char). Coincide
-- con la lógica de cierre de ciclo existente; el ajuste a la zona del tenant es
-- un follow-up separado (hallazgo D5).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

DROP MATERIALIZED VIEW IF EXISTS public.mv_kpis_tenant_mensual;

CREATE MATERIALIZED VIEW public.mv_kpis_tenant_mensual AS
WITH cuotas AS (
  SELECT
    company_id,
    project_id,
    periodo AS mes,
    count(*)::int                                                        AS cuotas_count,
    count(*) FILTER (WHERE estado = 'moroso')::int                       AS cuotas_morosas,
    count(DISTINCT unidad_id) FILTER (WHERE estado <> 'pagado')::int     AS unidades_con_deuda,
    COALESCE(sum(COALESCE(total_a_pagar, monto)), 0)                     AS cuotas_emitido,
    COALESCE(sum(COALESCE(total_a_pagar, monto)) FILTER (WHERE estado = 'pagado'), 0) AS cuotas_cobrado
  FROM public.cuotas_condominio
  WHERE deleted_at IS NULL
    AND periodo ~ '^[0-9]{4}-[0-9]{2}$'
  GROUP BY company_id, project_id, periodo
),
agua AS (
  -- registros NO tiene company_id: se resuelve por su proyecto.
  SELECT
    p.company_id,
    r.project_id,
    to_char(r.fecha, 'YYYY-MM') AS mes,
    count(*)::int                                        AS agua_recibos,
    COALESCE(sum(COALESCE(r.consumo, 0)), 0)             AS agua_consumo_m3,
    COALESCE(sum(COALESCE(r.monto_calculado, r.total_a_pagar, 0)), 0) AS agua_emitido,
    COALESCE(sum(COALESCE(r.monto_pagado, 0)), 0)        AS agua_cobrado
  FROM public.registros r
  JOIN public.projects p ON p.id = r.project_id
  WHERE r.deleted_at IS NULL
    AND r.project_id IS NOT NULL
  GROUP BY p.company_id, r.project_id, to_char(r.fecha, 'YYYY-MM')
),
gastos AS (
  SELECT
    company_id,
    project_id,
    to_char(fecha, 'YYYY-MM') AS mes,
    COALESCE(sum(monto), 0) AS gastos_total
  FROM public.gastos_condominio
  GROUP BY company_id, project_id, to_char(fecha, 'YYYY-MM')
),
llaves AS (
  SELECT company_id, project_id, mes FROM cuotas
  UNION
  SELECT company_id, project_id, mes FROM agua
  UNION
  SELECT company_id, project_id, mes FROM gastos
)
SELECT
  k.company_id,
  k.project_id,
  k.mes,
  -- Condominios
  COALESCE(c.cuotas_count, 0)        AS cuotas_count,
  COALESCE(c.cuotas_morosas, 0)      AS cuotas_morosas,
  COALESCE(c.unidades_con_deuda, 0)  AS unidades_con_deuda,
  COALESCE(c.cuotas_emitido, 0)      AS cuotas_emitido,
  COALESCE(c.cuotas_cobrado, 0)      AS cuotas_cobrado,
  -- Agua
  COALESCE(a.agua_recibos, 0)        AS agua_recibos,
  COALESCE(a.agua_consumo_m3, 0)     AS agua_consumo_m3,
  COALESCE(a.agua_emitido, 0)        AS agua_emitido,
  COALESCE(a.agua_cobrado, 0)        AS agua_cobrado,
  -- Gasto
  COALESCE(g.gastos_total, 0)        AS gastos_total,
  -- Totales combinados (útiles para el dashboard ejecutivo)
  COALESCE(c.cuotas_emitido, 0) + COALESCE(a.agua_emitido, 0) AS total_emitido,
  COALESCE(c.cuotas_cobrado, 0) + COALESCE(a.agua_cobrado, 0) AS total_cobrado
FROM llaves k
LEFT JOIN cuotas c USING (company_id, project_id, mes)
LEFT JOIN agua   a USING (company_id, project_id, mes)
LEFT JOIN gastos g USING (company_id, project_id, mes);

-- Índice único (NULLS NOT DISTINCT: project_id nulo cuenta como un único valor)
-- → habilita REFRESH ... CONCURRENTLY sin bloquear lecturas.
CREATE UNIQUE INDEX IF NOT EXISTS mv_kpis_tenant_mensual_pk
  ON public.mv_kpis_tenant_mensual (company_id, project_id, mes) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_mv_kpis_tenant_company_mes
  ON public.mv_kpis_tenant_mensual (company_id, mes);

-- Las MV no tienen RLS: cerrar el acceso directo. Solo la RPC (definer) lee.
REVOKE SELECT ON public.mv_kpis_tenant_mensual FROM PUBLIC;
REVOKE SELECT ON public.mv_kpis_tenant_mensual FROM anon, authenticated;

COMMENT ON MATERIALIZED VIEW public.mv_kpis_tenant_mensual IS
  'KPIs mensuales por (company_id, project_id, mes): cuotas emitido/cobrado/mora, agua consumo/emitido/cobrado, gasto. Refrescada por pg_cron cada 15 min. Acceso SOLO vía RPC get_kpis_tenant_mensual (definer, acotada al tenant). Auditoría 2026-07-16, C1.';

-- ────────────────────────────────────────────────────────────────────────────
-- Refresh (service-role-only, SECURITY DEFINER, CONCURRENTLY).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_kpis_tenant_mensual()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_kpis_tenant_mensual;
END
$$;

COMMENT ON FUNCTION public.refresh_kpis_tenant_mensual() IS
  'Refresca (CONCURRENTLY) la MV de KPIs mensuales del tenant. SECURITY DEFINER; solo service_role / pg_cron.';

REVOKE EXECUTE ON FUNCTION public.refresh_kpis_tenant_mensual() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_kpis_tenant_mensual() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_kpis_tenant_mensual() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- RPC de lectura user-facing: acotada al tenant del caller (aislamiento).
-- Rango [p_desde, p_hasta] en 'YYYY-MM' inclusive; p_project_id opcional.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_kpis_tenant_mensual(
  p_desde text,
  p_hasta text,
  p_project_id uuid DEFAULT NULL
)
RETURNS TABLE (
  project_id          uuid,
  mes                 text,
  cuotas_count        int,
  cuotas_morosas      int,
  unidades_con_deuda  int,
  cuotas_emitido      numeric,
  cuotas_cobrado      numeric,
  agua_recibos        int,
  agua_consumo_m3     numeric,
  agua_emitido        numeric,
  agua_cobrado        numeric,
  gastos_total        numeric,
  total_emitido       numeric,
  total_cobrado       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    m.project_id, m.mes,
    m.cuotas_count, m.cuotas_morosas, m.unidades_con_deuda,
    m.cuotas_emitido, m.cuotas_cobrado,
    m.agua_recibos, m.agua_consumo_m3, m.agua_emitido, m.agua_cobrado,
    m.gastos_total, m.total_emitido, m.total_cobrado
  FROM public.mv_kpis_tenant_mensual m
  WHERE m.company_id = public.get_my_company_id()
    AND m.mes BETWEEN p_desde AND p_hasta
    AND (p_project_id IS NULL OR m.project_id = p_project_id)
  ORDER BY m.mes, m.project_id;
$$;

COMMENT ON FUNCTION public.get_kpis_tenant_mensual(text, text, uuid) IS
  'KPIs mensuales del tenant del caller (company_id = get_my_company_id()) en el rango [p_desde,p_hasta] YYYY-MM, opcionalmente por proyecto. Lee la MV (sin RLS) con aislamiento por definer. Auditoría 2026-07-16, C1.';

REVOKE EXECUTE ON FUNCTION public.get_kpis_tenant_mensual(text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_kpis_tenant_mensual(text, text, uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Schedule pg_cron — refresco cada 15 min (idempotente, unschedule-defensivo).
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'refresh_kpis_tenant_15min';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh_kpis_tenant_15min',
  '*/15 * * * *',
  $$SELECT public.refresh_kpis_tenant_mensual();$$
);
