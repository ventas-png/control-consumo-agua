-- ============================================================================
-- Superadmin v2 — listado de empresas con facturación + tendencias del SaaS.
-- ============================================================================
-- Banda de migración de este PR (track "superadmin v2", 2026-06-12 18:01).
-- SQL idempotente y re-ejecutable.
--
-- QUÉ CAMBIA
--   1. mv_superadmin_empresa_counts incorpora la suscripción activa y el total
--      mensual estimado por empresa (misma aritmética que
--      calculate_monthly_total_cents, pre-agregada para que la tabla del panel
--      ordene/filtre sin N llamadas RPC).
--   2. get_superadmin_empresas v2: filtros por estado (activas/suspendidas) y
--      módulo (agua/condominios/ambos), orden seleccionable, y deja de exponer
--      el campo legacy `plan` (se elimina en 20260612180200). Cambiar columnas
--      OUT exige DROP FUNCTION (no CREATE OR REPLACE).
--   3. get_superadmin_trends: altas de empresas y bajas de suscripciones por
--      mes (derivables de datos vivos) para las gráficas del dashboard.
--   4. platform_metrics_daily + snapshot diario por pg_cron: el MRR histórico
--      no es reconstruible hacia atrás, así que se acumula desde hoy.
--
-- SEGURIDAD: mismas lecciones que 20260605200000 — MVs sin RLS se REVOCAN a
-- todos los roles user-facing y el acceso pasa por RPC SECURITY DEFINER con
-- chequeo is_super_admin() interno.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. mv_superadmin_empresa_counts v2 — conteos + suscripción + total mensual.
--    Las MVs no soportan agregar columnas con CREATE OR REPLACE: DROP+CREATE.
-- ────────────────────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS public.mv_superadmin_empresa_counts;

CREATE MATERIALIZED VIEW public.mv_superadmin_empresa_counts AS
WITH primary_project AS (
  -- Proyecto "principal" = el más antiguo (mismo criterio que
  -- calculate_monthly_total_cents: MIN created_at, desempate por id).
  SELECT DISTINCT ON (company_id) company_id, id AS project_id
  FROM public.projects
  ORDER BY company_id, created_at ASC NULLS LAST, id ASC
),
unidades_split AS (
  SELECT
    u.company_id,
    count(*)::int AS unit_count,
    count(*) FILTER (WHERE pp.project_id IS NOT NULL AND u.project_id = pp.project_id)::int AS primary_units,
    count(*) FILTER (WHERE pp.project_id IS NULL OR u.project_id IS DISTINCT FROM pp.project_id)::int AS extra_units
  FROM public.unidades u
  LEFT JOIN primary_project pp ON pp.company_id = u.company_id
  GROUP BY u.company_id
)
SELECT
  c.id                        AS company_id,
  COALESCE(p.cnt,  0)         AS project_count,
  COALESCE(au.cnt, 0)         AS user_count,
  COALESCE(us.unit_count, 0)  AS unit_count,
  s.status                    AS subscription_status,
  bp.code                     AS plan_code,
  CASE WHEN bp.id IS NULL THEN 0 ELSE
    bp.base_activation_cents
    + GREATEST(COALESCE(p.cnt, 0) - 1, 0) * bp.extra_project_cents
    + COALESCE(us.primary_units, 0)       * bp.unit_primary_cents
    + COALESCE(us.extra_units, 0)         * bp.unit_extra_cents
  END                         AS monthly_total_cents
FROM public.companies c
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.projects  GROUP BY company_id
) p  ON p.company_id  = c.id
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.app_users GROUP BY company_id
) au ON au.company_id = c.id
LEFT JOIN unidades_split us ON us.company_id = c.id
LEFT JOIN LATERAL (
  SELECT sub.status, sub.plan_id
  FROM public.subscriptions sub
  WHERE sub.company_id = c.id
    AND sub.status IN ('trialing', 'active', 'past_due', 'incomplete')
  ORDER BY sub.created_at DESC
  LIMIT 1
) s ON true
LEFT JOIN public.billing_plans bp ON bp.id = s.plan_id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_superadmin_empresa_counts_pk
  ON public.mv_superadmin_empresa_counts (company_id);

COMMENT ON MATERIALIZED VIEW public.mv_superadmin_empresa_counts IS
  'Conteos (proyectos/usuarios/unidades) + suscripción activa + total mensual estimado por empresa para el panel superadmin. Refrescada por pg_cron. Acceso sólo vía RPC get_superadmin_empresas.';

REVOKE ALL ON public.mv_superadmin_empresa_counts FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. get_superadmin_empresas v2 — filtros + orden + columnas de facturación.
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_superadmin_empresas(text, integer, integer);

CREATE OR REPLACE FUNCTION public.get_superadmin_empresas(
  p_search text    DEFAULT NULL,
  p_limit  integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_status text    DEFAULT NULL,   -- 'activas' | 'suspendidas' | NULL (todas)
  p_module text    DEFAULT NULL,   -- 'agua' | 'condominios' | 'ambos' | NULL
  p_sort   text    DEFAULT 'nombre' -- 'nombre' | 'created_at' | 'unidades' | 'monto'
)
RETURNS TABLE (
  id                    uuid,
  nombre                text,
  nit                   text,
  email                 text,
  telefono              text,
  activa                boolean,
  suspended_at          timestamptz,
  suspended_reason      text,
  created_at            timestamptz,
  max_projects          integer,
  max_units             integer,
  servicio_agua         boolean,
  servicio_condominios  boolean,
  project_count         int,
  user_count            int,
  unit_count            int,
  plan_code             text,
  subscription_status   text,
  monthly_total_cents   int,
  total_count           bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_status text := NULLIF(btrim(COALESCE(p_status, '')), '');
  v_module text := NULLIF(btrim(COALESCE(p_module, '')), '');
  v_sort   text := COALESCE(NULLIF(btrim(COALESCE(p_sort, '')), ''), 'nombre');
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH filtradas AS (
      SELECT c.*
      FROM public.companies c
      WHERE (v_search IS NULL
             OR c.nombre ILIKE '%' || v_search || '%'
             OR c.nit    ILIKE '%' || v_search || '%'
             OR c.email  ILIKE '%' || v_search || '%')
        AND (v_status IS NULL
             OR (v_status = 'activas'     AND c.activa)
             OR (v_status = 'suspendidas' AND NOT c.activa))
        AND (v_module IS NULL
             OR (v_module = 'agua'        AND c.servicio_agua AND NOT c.servicio_condominios)
             OR (v_module = 'condominios' AND c.servicio_condominios AND NOT c.servicio_agua)
             OR (v_module = 'ambos'       AND c.servicio_agua AND c.servicio_condominios))
    )
    SELECT
      f.id, f.nombre, f.nit, f.email, f.telefono,
      f.activa, f.suspended_at, f.suspended_reason, f.created_at,
      f.max_projects, f.max_units, f.servicio_agua, f.servicio_condominios,
      COALESCE(mc.project_count, 0)       AS project_count,
      COALESCE(mc.user_count,    0)       AS user_count,
      COALESCE(mc.unit_count,    0)       AS unit_count,
      mc.plan_code,
      mc.subscription_status,
      COALESCE(mc.monthly_total_cents, 0) AS monthly_total_cents,
      count(*) OVER ()                    AS total_count
    FROM filtradas f
    LEFT JOIN public.mv_superadmin_empresa_counts mc ON mc.company_id = f.id
    ORDER BY
      CASE WHEN v_sort = 'unidades'   THEN COALESCE(mc.unit_count, 0)          END DESC,
      CASE WHEN v_sort = 'monto'      THEN COALESCE(mc.monthly_total_cents, 0) END DESC,
      CASE WHEN v_sort = 'created_at' THEN f.created_at                        END DESC,
      f.nombre ASC
    LIMIT v_limit OFFSET v_offset;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_empresas(text, integer, integer, text, text, text) IS
  'Listado de empresas paginado + buscable + filtrable (estado/módulo) + ordenable, con suscripción y total mensual desde la MV. Escalares en vivo de companies. User-facing acotada a super_admin.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. get_superadmin_trends — altas de empresas y bajas de suscripciones / mes.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_superadmin_trends(p_months integer DEFAULT 12)
RETURNS TABLE (mes date, altas int, bajas int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_months int := LEAST(GREATEST(COALESCE(p_months, 12), 1), 36);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH c_meses AS (
      SELECT (date_trunc('month', now()) - make_interval(months => g))::date AS mes_inicio
      FROM generate_series(0, v_months - 1) AS g
    ),
    c_altas AS (
      SELECT date_trunc('month', c.created_at)::date AS mes_inicio, count(*)::int AS cnt
      FROM public.companies c
      WHERE c.created_at >= date_trunc('month', now()) - make_interval(months => v_months - 1)
      GROUP BY 1
    ),
    c_bajas AS (
      SELECT date_trunc('month', s.canceled_at)::date AS mes_inicio, count(*)::int AS cnt
      FROM public.subscriptions s
      WHERE s.canceled_at IS NOT NULL
        AND s.canceled_at >= date_trunc('month', now()) - make_interval(months => v_months - 1)
      GROUP BY 1
    )
    SELECT m.mes_inicio, COALESCE(a.cnt, 0), COALESCE(b.cnt, 0)
    FROM c_meses m
    LEFT JOIN c_altas a ON a.mes_inicio = m.mes_inicio
    LEFT JOIN c_bajas b ON b.mes_inicio = m.mes_inicio
    ORDER BY m.mes_inicio ASC;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_trends(integer) IS
  'Altas de empresas (companies.created_at) y bajas de suscripciones (subscriptions.canceled_at) agrupadas por mes, para las gráficas del dashboard superadmin. Acotada a super_admin.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. platform_metrics_daily — snapshot diario del MRR (no reconstruible hacia
--    atrás; la serie histórica se acumula desde el primer snapshot).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_metrics_daily (
  day                    date        PRIMARY KEY,
  mrr_cents              bigint      NOT NULL DEFAULT 0,
  empresas_activas       integer     NOT NULL DEFAULT 0,
  suscripciones_vigentes integer     NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Sin policies de cliente: solo el snapshot (definer) escribe y la RPC
-- get_superadmin_mrr_trend (definer) lee.
ALTER TABLE public.platform_metrics_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_metrics_daily FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.snapshot_platform_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.platform_metrics_daily (day, mrr_cents, empresas_activas, suscripciones_vigentes)
  SELECT current_date, m.mrr_cents, m.empresas_activas, m.suscripciones_vigentes
  FROM public.mv_superadmin_plataforma m
  ON CONFLICT (day) DO UPDATE SET
    mrr_cents              = EXCLUDED.mrr_cents,
    empresas_activas       = EXCLUDED.empresas_activas,
    suscripciones_vigentes = EXCLUDED.suscripciones_vigentes;
END
$$;

COMMENT ON FUNCTION public.snapshot_platform_metrics() IS
  'Snapshot diario de MRR/empresas activas desde mv_superadmin_plataforma hacia platform_metrics_daily. SECURITY DEFINER; sólo service_role / pg_cron.';

REVOKE EXECUTE ON FUNCTION public.snapshot_platform_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snapshot_platform_metrics() FROM anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_platform_metrics() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.snapshot_platform_metrics() TO service_role;

-- Primer punto de la serie (la gráfica muestra "desde que hay datos").
SELECT public.snapshot_platform_metrics();

CREATE OR REPLACE FUNCTION public.get_superadmin_mrr_trend(p_days integer DEFAULT 90)
RETURNS TABLE (day date, mrr_cents bigint, empresas_activas int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days int := LEAST(GREATEST(COALESCE(p_days, 90), 7), 365);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT d.day, d.mrr_cents, d.empresas_activas
    FROM public.platform_metrics_daily d
    WHERE d.day >= current_date - v_days
    ORDER BY d.day ASC;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_mrr_trend(integer) IS
  'Serie diaria de MRR/empresas activas desde platform_metrics_daily para la gráfica de tendencia del dashboard superadmin. Acotada a super_admin.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Grants user-facing (REVOKE PUBLIC/anon, GRANT authenticated; el chequeo
--    de rol vive dentro de cada función).
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_superadmin_empresas(text, integer, integer, text, text, text)',
    'public.get_superadmin_trends(integer)',
    'public.get_superadmin_mrr_trend(integer)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Schedule pg_cron — snapshot diario 00:10 UTC (idempotente).
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'snapshot_platform_metrics_daily';

SELECT cron.schedule(
  'snapshot_platform_metrics_daily',
  '10 0 * * *',
  $$SELECT public.snapshot_platform_metrics();$$
);
