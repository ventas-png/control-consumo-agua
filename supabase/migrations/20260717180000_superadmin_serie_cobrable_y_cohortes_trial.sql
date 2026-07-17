-- ============================================================================
-- Serie diaria de MRR cobrable + cohortes de trial (dashboard superadmin)
-- ============================================================================
-- Rediseño del dashboard superadmin (follow-up de F2/C6 y avance parcial de
-- C11 — AUDITORIA_LOGICA_SAAS_2026-07-16):
--   1. platform_metrics_daily gana el desglose cobrable/potencial y el conteo
--      de trials como columnas NULLABLES SIN DEFAULT: NULL significa "día sin
--      desglose registrado" (el front pinta hueco, no cero). La serie del
--      desglose existe solo desde esta migración — no es reconstruible hacia
--      atrás, igual que la serie base (20260612180100).
--   2. snapshot_platform_metrics() copia las columnas nuevas desde
--      mv_superadmin_plataforma (mismo job pg_cron diario, no se toca).
--   3. get_superadmin_mrr_trend() expone el desglose + suscripciones_vigentes
--      (columna que la tabla siempre tuvo y la RPC omitía). Cambia su
--      RETURNS TABLE → DROP + CREATE (42P13), patrón de 20260717130000.
--   4. get_superadmin_trial_cohortes(p_months): cohortes mensuales de
--      EMPRESAS por su primer trial, clasificadas por el estado actual de su
--      suscripción vigente, para la gráfica de conversión del dashboard.
--   5. Snapshot inline al final para que el desglose exista desde el deploy
--      sin esperar al cron de 00:10 UTC (precedente 20260612180100).
--
-- mrr_cents NO cambia de semántica (cobrable + potencial, solo 'active', por
-- uso) — decisión sellada en 20260717130000 para no romper la serie diaria.
--
-- Reversión: DROP FUNCTION public.get_superadmin_trial_cohortes(integer);
-- restaurar get_superadmin_mrr_trend y snapshot_platform_metrics a la versión
-- de 20260612180100. Las columnas nuevas pueden quedarse (nullables e inocuas).
-- ============================================================================

-- ─── 1. Columnas nuevas del snapshot diario ─────────────────────────────────

ALTER TABLE public.platform_metrics_daily
  ADD COLUMN IF NOT EXISTS mrr_cobrable_cents     bigint,
  ADD COLUMN IF NOT EXISTS mrr_potencial_cents    bigint,
  ADD COLUMN IF NOT EXISTS suscripciones_trialing integer;

COMMENT ON COLUMN public.platform_metrics_daily.mrr_cobrable_cents IS
  'MRR active CON stripe_subscription_id (lo que Stripe factura). NULL = día sin desglose (columna existe desde 20260717180000; no reconstruible hacia atrás).';
COMMENT ON COLUMN public.platform_metrics_daily.mrr_potencial_cents IS
  'MRR active SIN Stripe (pilotos grandfathered). NULL = día sin desglose (columna existe desde 20260717180000).';
COMMENT ON COLUMN public.platform_metrics_daily.suscripciones_trialing IS
  'Suscripciones en trial al momento del snapshot. NULL = día sin dato (columna existe desde 20260717180000).';

-- ─── 2. Snapshot con desglose (misma firma → OR REPLACE) ────────────────────

CREATE OR REPLACE FUNCTION public.snapshot_platform_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.platform_metrics_daily
    (day, mrr_cents, empresas_activas, suscripciones_vigentes,
     mrr_cobrable_cents, mrr_potencial_cents, suscripciones_trialing)
  SELECT current_date, m.mrr_cents, m.empresas_activas, m.suscripciones_vigentes,
         m.mrr_cobrable_cents, m.mrr_potencial_cents, m.suscripciones_trialing
  FROM public.mv_superadmin_plataforma m
  ON CONFLICT (day) DO UPDATE SET
    mrr_cents              = EXCLUDED.mrr_cents,
    empresas_activas       = EXCLUDED.empresas_activas,
    suscripciones_vigentes = EXCLUDED.suscripciones_vigentes,
    mrr_cobrable_cents     = EXCLUDED.mrr_cobrable_cents,
    mrr_potencial_cents    = EXCLUDED.mrr_potencial_cents,
    suscripciones_trialing = EXCLUDED.suscripciones_trialing;
END
$$;

COMMENT ON FUNCTION public.snapshot_platform_metrics() IS
  'Snapshot diario de MRR (total + desglose cobrable/potencial) y conteos desde mv_superadmin_plataforma hacia platform_metrics_daily. SECURITY DEFINER; sólo service_role / pg_cron.';

REVOKE EXECUTE ON FUNCTION public.snapshot_platform_metrics() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.snapshot_platform_metrics() FROM anon;
REVOKE EXECUTE ON FUNCTION public.snapshot_platform_metrics() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.snapshot_platform_metrics() TO service_role;

-- ─── 3. Serie diaria con desglose (cambia RETURNS TABLE → DROP + CREATE) ────

DROP FUNCTION IF EXISTS public.get_superadmin_mrr_trend(integer);

CREATE FUNCTION public.get_superadmin_mrr_trend(p_days integer DEFAULT 90)
RETURNS TABLE (
  day                    date,
  mrr_cents              bigint,
  mrr_cobrable_cents     bigint,
  mrr_potencial_cents    bigint,
  empresas_activas       int,
  suscripciones_vigentes int,
  suscripciones_trialing int
)
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
    SELECT d.day, d.mrr_cents, d.mrr_cobrable_cents, d.mrr_potencial_cents,
           d.empresas_activas, d.suscripciones_vigentes, d.suscripciones_trialing
    FROM public.platform_metrics_daily d
    WHERE d.day >= current_date - v_days
    ORDER BY d.day ASC;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_mrr_trend(integer) IS
  'Serie diaria de MRR (total + desglose cobrable/potencial, NULL en días previos a 20260717180000) y conteos desde platform_metrics_daily para el dashboard superadmin. Acotada a super_admin.';

REVOKE ALL ON FUNCTION public.get_superadmin_mrr_trend(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_superadmin_mrr_trend(integer) TO authenticated;

-- ─── 4. Cohortes de trial por mes de alta (a nivel EMPRESA) ─────────────────
-- Cohorte = mes del PRIMER trial de la empresa (min created_at de sus subs con
-- trial_end no nulo — las que nacen del trigger create_trial_subscription;
-- empresas dadas de alta manualmente directo a 'active' sin trial quedan
-- fuera). La clasificación usa la suscripción VIGENTE de la empresa (o la más
-- reciente si no hay vigente): el flujo de conversión de Stripe CANCELA la sub
-- de trial e INSERTA una nueva con stripe_subscription_id
-- (stripe-platform-webhook), así que contar filas de subscriptions reportaría
-- cada conversión como "cancelada". Reporta el estado ACTUAL de cada camada —
-- NO es conversión a ventana de 30 días (no existe historial de
-- transiciones). Los 6 buckets particionan la cohorte (suman = trials).

CREATE OR REPLACE FUNCTION public.get_superadmin_trial_cohortes(p_months integer DEFAULT 12)
RETURNS TABLE (
  mes               date,
  trials            int,
  activas_cobrables int,
  activas_sin_cobro int,
  en_trial          int,
  trial_vencido     int,
  pago_vencido      int,
  canceladas        int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_months int := LEAST(GREATEST(COALESCE(p_months, 12), 1), 24);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    WITH c_meses AS (
      SELECT (date_trunc('month', now()) - make_interval(months => g))::date AS mes_inicio
      FROM generate_series(0, v_months - 1) AS g
    ),
    -- Mes del primer trial por empresa (define su cohorte).
    c_trial AS (
      SELECT s.company_id, date_trunc('month', min(s.created_at))::date AS mes_inicio
      FROM public.subscriptions s
      WHERE s.trial_end IS NOT NULL
      GROUP BY s.company_id
    ),
    -- Suscripción que representa el estado ACTUAL de la empresa: la vigente
    -- (única por el índice parcial subscriptions_company_active) o, si no hay,
    -- la más reciente.
    c_estado AS (
      SELECT DISTINCT ON (s.company_id)
             s.company_id, s.status, s.stripe_subscription_id, s.trial_end
      FROM public.subscriptions s
      ORDER BY s.company_id,
               (s.status IN ('trialing', 'active', 'past_due', 'incomplete')) DESC,
               s.created_at DESC
    ),
    c_cohortes AS (
      SELECT t.mes_inicio,
             count(*)::int AS trials,
             count(*) FILTER (WHERE e.status = 'active'   AND e.stripe_subscription_id IS NOT NULL)::int AS activas_cobrables,
             count(*) FILTER (WHERE e.status = 'active'   AND e.stripe_subscription_id IS NULL)::int     AS activas_sin_cobro,
             count(*) FILTER (WHERE e.status = 'trialing' AND (e.trial_end IS NULL OR e.trial_end >= now()))::int AS en_trial,
             count(*) FILTER (WHERE e.status = 'trialing' AND e.trial_end < now())::int                  AS trial_vencido,
             count(*) FILTER (WHERE e.status IN ('past_due', 'incomplete'))::int                         AS pago_vencido,
             count(*) FILTER (WHERE e.status IN ('canceled', 'incomplete_expired', 'unpaid'))::int       AS canceladas
      FROM c_trial t
      JOIN c_estado e ON e.company_id = t.company_id
      WHERE t.mes_inicio >= (date_trunc('month', now()) - make_interval(months => v_months - 1))::date
      GROUP BY t.mes_inicio
    )
    SELECT m.mes_inicio,
           COALESCE(c.trials, 0), COALESCE(c.activas_cobrables, 0),
           COALESCE(c.activas_sin_cobro, 0), COALESCE(c.en_trial, 0),
           COALESCE(c.trial_vencido, 0), COALESCE(c.pago_vencido, 0),
           COALESCE(c.canceladas, 0)
    FROM c_meses m
    LEFT JOIN c_cohortes c ON c.mes_inicio = m.mes_inicio
    ORDER BY m.mes_inicio ASC;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_trial_cohortes(integer) IS
  'Cohortes mensuales de EMPRESAS por su primer trial (min created_at de subs con trial_end), clasificadas por el estado ACTUAL de su suscripción vigente/última — no es conversión a 30 días. La conversión Stripe cancela el trial e inserta una sub nueva, por eso la clasificación es por empresa y no por fila. Empresas sin trial (altas manuales directas a active) quedan fuera. Acotada a super_admin.';

REVOKE ALL ON FUNCTION public.get_superadmin_trial_cohortes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_superadmin_trial_cohortes(integer) TO authenticated;

-- ─── 5. Primer punto del desglose (no esperar al cron de 00:10 UTC) ─────────

SELECT public.snapshot_platform_metrics();
