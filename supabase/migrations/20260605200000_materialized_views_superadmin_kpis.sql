-- ============================================================================
-- PERF DE LECTURA · KPIs del Superadministrador en VISTAS MATERIALIZADAS
-- (plat:P14 server-side + dashboards que hoy agregan en cliente)
-- ============================================================================
-- Banda de migración EXCLUSIVA de este PR (track "vistas materializadas",
-- 2026-06-05, 20:00–21:59): 200000–205959. SQL idempotente y re-ejecutable.
--
-- CONTEXTO / PROBLEMA QUE RESUELVE
--   El panel del superadmin (src/components/superadmin/SuperAdminSection.tsx)
--   trae TODAS las empresas y, por cada una, dispara 3 count-queries
--   (projects / app_users / unidades) — patrón N+1 que escala pésimo. Además
--   SuperAdminMetricsCard descarga TODAS las subscriptions y calcula MRR/churn/
--   distribución por plan en JS. Este PR mueve esos agregados a Postgres:
--     · mv_superadmin_empresa_counts — conteos por empresa (caché del N+1).
--     · mv_superadmin_plataforma     — KPIs globales del SaaS (1 fila).
--   refrescadas por pg_cron, y se exponen vía RPC SECURITY DEFINER acotadas a
--   super_admin. El listado se pagina/busca server-side (plat:P14).
--
-- DECISIÓN DE FRESCURA (importante)
--   La RPC de empresas lee los CAMPOS EDITABLES (nombre/plan/activa/límites/
--   servicios) en VIVO desde `companies` y SÓLO los CONTEOS desde la MV. Así un
--   edit del superadmin se refleja al instante; los conteos (caros) quedan a la
--   frescura del cron (~15 min). Una MV pura de companies haría que editar un
--   límite mostrara el valor viejo hasta el próximo refresh.
--
-- SEGURIDAD (lecciones T5)
--   · Las materialized views NO soportan RLS. Por eso se REVOCA SELECT a
--     PUBLIC/anon/authenticated y el acceso pasa SIEMPRE por RPC SECURITY
--     DEFINER que valida is_super_admin() (no hay datos cross-tenant expuestos).
--   · La función de refresh es service-role-only: REVOKE EXECUTE por NOMBRE de
--     rol (PUBLIC, anon, authenticated) + GRANT a service_role.
--   · Las RPC de lectura son user-facing: REVOKE de PUBLIC/anon + GRANT a
--     authenticated, con el chequeo de rol DENTRO de la función.
--   · CONCURRENTLY: cada MV tiene índice ÚNICO → el refresh no bloquea lecturas.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. mv_superadmin_empresa_counts — conteos por empresa (reemplaza el N+1).
-- ────────────────────────────────────────────────────────────────────────────
-- user_count y unit_count replican el conteo del cliente actual (todas las filas
-- por company_id, sin filtrar activo) para no cambiar las cifras mostradas.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_superadmin_empresa_counts AS
SELECT
  c.id                  AS company_id,
  COALESCE(p.cnt,  0)   AS project_count,
  COALESCE(u.cnt,  0)   AS user_count,
  COALESCE(un.cnt, 0)   AS unit_count
FROM public.companies c
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.projects   GROUP BY company_id
) p  ON p.company_id  = c.id
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.app_users  GROUP BY company_id
) u  ON u.company_id  = c.id
LEFT JOIN (
  SELECT company_id, count(*)::int AS cnt FROM public.unidades   GROUP BY company_id
) un ON un.company_id = c.id;

-- Índice único → habilita REFRESH ... CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS mv_superadmin_empresa_counts_pk
  ON public.mv_superadmin_empresa_counts (company_id);

COMMENT ON MATERIALIZED VIEW public.mv_superadmin_empresa_counts IS
  'Conteos (proyectos/usuarios/unidades) por empresa para el panel superadmin. Caché del N+1; refrescada por pg_cron. Acceso sólo vía RPC get_superadmin_empresas.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. mv_superadmin_plataforma — KPIs globales del SaaS (una sola fila).
-- ────────────────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_superadmin_plataforma AS
WITH sub AS (
  SELECT s.status, s.canceled_at, bp.code, bp.name, bp.price_monthly_cents
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
  COALESCE((SELECT sum(price_monthly_cents)::bigint FROM vigentes), 0) AS mrr_cents,
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
  'KPIs globales del SaaS (empresas/usuarios/uso + MRR/churn/distribución por plan). Una sola fila. Refrescada por pg_cron. Acceso sólo vía RPC get_superadmin_plataforma_kpis.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Endurecer acceso a las MV: nadie las lee directo (sólo vía RPC definer).
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.mv_superadmin_empresa_counts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.mv_superadmin_plataforma     FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Función de refresh (service-role-only, SECURITY DEFINER, CONCURRENTLY).
-- ────────────────────────────────────────────────────────────────────────────
-- REFRESH MATERIALIZED VIEW CONCURRENTLY sí puede correr dentro de una función
-- plpgsql (a diferencia de CREATE INDEX CONCURRENTLY). Requiere índice único e
-- que la MV ya esté poblada (se crea WITH DATA por defecto) — ambas se cumplen.
CREATE OR REPLACE FUNCTION public.refresh_superadmin_kpis()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_superadmin_empresa_counts;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_superadmin_plataforma;
END
$$;

COMMENT ON FUNCTION public.refresh_superadmin_kpis() IS
  'Refresca (CONCURRENTLY) las MV de KPIs del superadmin. SECURITY DEFINER; sólo service_role / el job de pg_cron pueden ejecutarla.';

REVOKE EXECUTE ON FUNCTION public.refresh_superadmin_kpis() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_superadmin_kpis() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_superadmin_kpis() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.refresh_superadmin_kpis() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC user-facing: KPIs globales (acotada a super_admin).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_superadmin_plataforma_kpis()
RETURNS TABLE (
  total_empresas          int,
  empresas_activas        int,
  empresas_inactivas      int,
  total_usuarios          int,
  total_proyectos         int,
  total_unidades          int,
  mrr_cents               bigint,
  suscripciones_activas   int,
  suscripciones_trialing  int,
  canceladas_30d          int,
  suscripciones_vigentes  int,
  plan_distribution       jsonb,
  refreshed_at            timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT m.total_empresas, m.empresas_activas, m.empresas_inactivas,
           m.total_usuarios, m.total_proyectos, m.total_unidades,
           m.mrr_cents, m.suscripciones_activas, m.suscripciones_trialing,
           m.canceladas_30d, m.suscripciones_vigentes, m.plan_distribution,
           m.refreshed_at
    FROM public.mv_superadmin_plataforma m;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_plataforma_kpis() IS
  'plat KPIs globales del SaaS desde mv_superadmin_plataforma. User-facing acotada a super_admin (GRANT authenticated + chequeo interno).';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RPC user-facing: listado de empresas paginado/buscable (plat:P14).
-- ────────────────────────────────────────────────────────────────────────────
-- Escalares en VIVO desde companies (edits instantáneos) + conteos desde la MV.
-- total_count via window para que el cliente arme la paginación sin 2.ª query.
CREATE OR REPLACE FUNCTION public.get_superadmin_empresas(
  p_search text    DEFAULT NULL,
  p_limit  integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id                    uuid,
  nombre                text,
  nit                   text,
  email                 text,
  telefono              text,
  plan                  text,
  activa                boolean,
  max_projects          integer,
  max_units             integer,
  servicio_agua         boolean,
  servicio_condominios  boolean,
  project_count         int,
  user_count            int,
  unit_count            int,
  total_count           bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit  int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH filtradas AS (
      SELECT c.*
      FROM public.companies c
      WHERE v_search IS NULL
         OR c.nombre ILIKE '%' || v_search || '%'
         OR c.nit    ILIKE '%' || v_search || '%'
         OR c.email  ILIKE '%' || v_search || '%'
    )
    SELECT
      f.id, f.nombre, f.nit, f.email, f.telefono, f.plan, f.activa,
      f.max_projects, f.max_units, f.servicio_agua, f.servicio_condominios,
      COALESCE(mc.project_count, 0) AS project_count,
      COALESCE(mc.user_count,    0) AS user_count,
      COALESCE(mc.unit_count,    0) AS unit_count,
      count(*) OVER ()              AS total_count
    FROM filtradas f
    LEFT JOIN public.mv_superadmin_empresa_counts mc ON mc.company_id = f.id
    ORDER BY f.nombre ASC
    LIMIT v_limit OFFSET v_offset;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_empresas(text, integer, integer) IS
  'plat:P14 — listado de empresas paginado + buscable (nombre/nit/email) server-side. Escalares en vivo de companies + conteos de mv_superadmin_empresa_counts. User-facing acotada a super_admin.';

-- Grants user-facing: REVOKE PUBLIC/anon, GRANT authenticated (chequeo interno).
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_superadmin_plataforma_kpis()',
    'public.get_superadmin_empresas(text, integer, integer)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Schedule pg_cron — refresco cada 15 min (idempotente, unschedule-defensivo).
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'refresh_superadmin_kpis_15min';

SELECT cron.schedule(
  'refresh_superadmin_kpis_15min',
  '*/15 * * * *',
  $$SELECT public.refresh_superadmin_kpis();$$
);
