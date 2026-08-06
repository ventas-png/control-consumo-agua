-- P0 #3 (auditoría 2026-07-10) — MRR del superadmin correcto.
--
-- BUG: mv_superadmin_plataforma.mrr_cents = sum(price_monthly_cents) sobre subs
-- 'active' + 'trialing'. Dos errores:
--   1. price_monthly_cents es la columna FLAT LEGACY, inutilizada desde el
--      pricing por USO (base + proyectos extra + unidades). El cobro real vive
--      en mv_superadmin_empresa_counts.monthly_total_cents.
--   2. Incluye 'trialing' — subs en prueba que pagan $0.
-- El snapshot diario platform_metrics_daily viene acumulando una serie de MRR
-- errónea; este fix la corrige de aquí en adelante (las filas históricas ya
-- escritas no son reconstruibles y quedan como están).
--
-- FIX: mrr_cents = sum(monthly_total_cents) de las empresas con suscripción
-- 'active' (ingreso recurrente RECONOCIDO). Se excluyen trialing (=$0) y
-- past_due/incomplete (en riesgo / no cobrando). Reusa mv_superadmin_empresa_counts,
-- que ya calcula el total por uso con la MISMA fórmula que
-- calculate_monthly_total_cents y que refresh_superadmin_kpis() refresca ANTES
-- que esta MV (orden correcto → consistencia).
--
-- Las MV no admiten CREATE OR REPLACE con nueva query → DROP + CREATE. La RPC
-- get_superadmin_plataforma_kpis() y refresh_superadmin_kpis() referencian esta
-- MV por nombre (plpgsql) → no se rompen. Se recrea WITH DATA (default): el panel
-- muestra el MRR correcto de inmediato, sin esperar al cron. Validado en prod con
-- BEGIN … ROLLBACK.

DROP MATERIALIZED VIEW IF EXISTS public.mv_superadmin_plataforma;

CREATE MATERIALIZED VIEW public.mv_superadmin_plataforma AS
WITH sub AS (
  SELECT s.status, s.canceled_at, bp.code, bp.name
  FROM public.subscriptions s
  JOIN public.billing_plans bp ON bp.id = s.plan_id
),
vigentes AS (
  SELECT * FROM sub WHERE status IN ('active', 'trialing')
),
plan_dist AS (
  SELECT jsonb_agg(
           jsonb_build_object('planCode', code, 'planName', name, 'count', cnt)
           ORDER BY cnt DESC
         ) AS dist
  FROM (
    SELECT code, name, count(*)::int AS cnt
    FROM vigentes
    GROUP BY code, name
  ) g
)
SELECT
  1::smallint AS singleton,
  (SELECT count(*)::int FROM public.companies)                       AS total_empresas,
  (SELECT count(*)::int FROM public.companies WHERE activa)          AS empresas_activas,
  (SELECT count(*)::int FROM public.companies WHERE NOT activa)      AS empresas_inactivas,
  (SELECT count(*)::int FROM public.app_users)                       AS total_usuarios,
  (SELECT count(*)::int FROM public.projects)                        AS total_proyectos,
  (SELECT count(*)::int FROM public.unidades)                        AS total_unidades,
  -- MRR = ingreso recurrente por USO de las empresas 'active' (no el precio flat
  -- legacy, no los trials $0). monthly_total_cents ya viene calculado por empresa.
  COALESCE((
    SELECT sum(ec.monthly_total_cents)::bigint
    FROM public.mv_superadmin_empresa_counts ec
    WHERE ec.subscription_status = 'active'
  ), 0)                                                              AS mrr_cents,
  (SELECT count(*)::int FROM sub WHERE status = 'active')            AS suscripciones_activas,
  (SELECT count(*)::int FROM sub WHERE status = 'trialing')          AS suscripciones_trialing,
  (SELECT count(*)::int FROM sub
     WHERE status = 'canceled'
       AND canceled_at IS NOT NULL
       AND canceled_at >= now() - interval '30 days')                AS canceladas_30d,
  (SELECT count(*)::int FROM vigentes)                              AS suscripciones_vigentes,
  COALESCE((SELECT dist FROM plan_dist), '[]'::jsonb)               AS plan_distribution,
  now()                                                             AS refreshed_at;

-- Índice único sobre el singleton → habilita CONCURRENTLY en la MV de 1 fila.
CREATE UNIQUE INDEX IF NOT EXISTS mv_superadmin_plataforma_pk
  ON public.mv_superadmin_plataforma (singleton);

COMMENT ON MATERIALIZED VIEW public.mv_superadmin_plataforma IS
  'KPIs globales del SaaS. mrr_cents = total mensual por USO de las empresas con suscripción active (excluye trials $0 y past_due). Una sola fila. Refrescada por pg_cron después de mv_superadmin_empresa_counts. Acceso sólo vía RPC get_superadmin_plataforma_kpis.';

-- Re-endurecer acceso: nadie lee la MV directo (sólo vía RPC definer).
REVOKE ALL ON public.mv_superadmin_plataforma FROM PUBLIC, anon, authenticated;
