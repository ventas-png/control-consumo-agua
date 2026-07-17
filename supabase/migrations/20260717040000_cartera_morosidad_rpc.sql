-- ============================================================================
-- Aging de cartera + score de riesgo de morosidad (auditoría 2026-07-16, O2/V4)
-- ============================================================================
-- AnalisisCarteraTab calcula el aging EN EL CLIENTE sobre el array de cuotas
-- (sujeto al truncado de 5.000 filas) y no tiene score de riesgo. Este RPC lo
-- mueve al servidor y agrega la señal comercial más directa: un score
-- determinista por unidad que prioriza la cobranza (el cron de recordatorios
-- puede pasar de "recordar a todos" a "escalar a los de mayor riesgo").
--
-- SECURITY INVOKER: la RLS de cuotas_condominio aplica → aislamiento por tenant
-- y por permiso sin lógica extra. Solo agrega/computa lo que el usuario ya ve.
--
-- SCORE (0..100, determinista y explicable):
--   40% · proporción de la deuda con +90 días (lo más incobrable)
--   30% · qué tan atrasada está la cuota más vieja (cap 180 días)
--   30% · reincidencia = periodos históricos en estado 'moroso' (cap 6)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cartera_morosidad(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  unidad_id       uuid,
  bucket_0_30     numeric,
  bucket_31_60    numeric,
  bucket_61_90    numeric,
  bucket_90_plus  numeric,
  total_vencido   numeric,
  cuotas_vencidas int,
  dias_atraso_max int,
  periodos_morosos int,
  score           int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH base AS (
    SELECT
      c.unidad_id,
      COALESCE(c.total_a_pagar, c.monto) AS monto,
      GREATEST(0, (CURRENT_DATE - c.fecha_vencimiento))::int AS dias,
      c.estado,
      c.periodo
    FROM public.cuotas_condominio c
    WHERE c.deleted_at IS NULL
      AND c.unidad_id IS NOT NULL
      AND (p_project_id IS NULL OR c.project_id = p_project_id)
  ),
  vencidas AS (
    SELECT * FROM base
    WHERE estado <> 'pagado'
      AND dias > 0  -- fecha_vencimiento < hoy
  ),
  reincidencia AS (
    SELECT unidad_id, COUNT(DISTINCT periodo)::int AS periodos_morosos
    FROM base
    WHERE estado = 'moroso'
    GROUP BY unidad_id
  ),
  agg AS (
    SELECT
      v.unidad_id,
      COALESCE(SUM(monto) FILTER (WHERE dias BETWEEN 1 AND 30), 0)  AS b0,
      COALESCE(SUM(monto) FILTER (WHERE dias BETWEEN 31 AND 60), 0) AS b1,
      COALESCE(SUM(monto) FILTER (WHERE dias BETWEEN 61 AND 90), 0) AS b2,
      COALESCE(SUM(monto) FILTER (WHERE dias > 90), 0)             AS b3,
      COALESCE(SUM(monto), 0) AS total,
      COUNT(*)::int  AS n,
      MAX(dias)::int AS dmax
    FROM vencidas v
    GROUP BY v.unidad_id
  )
  SELECT
    a.unidad_id,
    a.b0::numeric(14,2),
    a.b1::numeric(14,2),
    a.b2::numeric(14,2),
    a.b3::numeric(14,2),
    a.total::numeric(14,2),
    a.n,
    a.dmax,
    COALESCE(r.periodos_morosos, 0),
    LEAST(100, GREATEST(0, ROUND(
        40 * (a.b3 / NULLIF(a.total, 0))
      + 30 * LEAST(a.dmax / 180.0, 1)
      + 30 * LEAST(COALESCE(r.periodos_morosos, 0) / 6.0, 1)
    )))::int AS score
  FROM agg a
  LEFT JOIN reincidencia r ON r.unidad_id = a.unidad_id
  ORDER BY score DESC, total DESC
$$;

COMMENT ON FUNCTION public.cartera_morosidad(uuid) IS
  'Aging de cartera + score de riesgo de morosidad por unidad (SECURITY INVOKER: RLS de cuotas aplica). Buckets 0-30/31-60/61-90/90+ sobre cuotas vencidas impagas; score 0-100 determinista (40% deuda +90d, 30% atraso máx, 30% reincidencia). Auditoría 2026-07-16, O2.';

REVOKE EXECUTE ON FUNCTION public.cartera_morosidad(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cartera_morosidad(uuid) TO authenticated;
