-- ============================================================================
-- MRR cobrable vs potencial + plan trial según signup (F2 / cierra C6 y C12)
-- ============================================================================
-- C6 — El backfill de 20260610053543 dejó a los pilotos con suscripción
--   'active' SIN stripe_subscription_id (una con period_end a 100 años):
--   sync-stripe-quantities las salta, nunca se cobran, pero la MV las suma →
--   el MRR reportado > MRR cobrable, y esos tenants operan gratis sin camino
--   de conversión visible. Fix: la MV separa
--     · mrr_cobrable_cents  — active CON stripe_subscription_id (se cobra)
--     · mrr_potencial_cents — active SIN Stripe (grandfathered/pilotos)
--     · empresas_grandfathered — cuántas son (el target de la campaña)
--   mrr_cents se mantiene con su semántica actual (cobrable + potencial) para
--   no romper la serie diaria de platform_metrics_daily.
--
-- C12 — El trigger create_trial_subscription asignaba SIEMPRE 'bundle' aunque
--   el signup eligiera un solo módulo (sesga la conversión y el MRR
--   potencial). Fix: el plan del trial sale de los flags de la company
--   (servicio_agua/servicio_condominios): solo agua → agua_only; solo
--   condominios → condominios_only; ambos o ninguno → bundle. Fallback a
--   bundle si el code no existe (el alta JAMÁS debe fallar por un seed).
-- ============================================================================

-- ─── 1. C12: trial según los flags del signup ───────────────────────────────

CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_code text;
  v_plan uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = NEW.id) THEN
    -- F2 (C12): el módulo elegido en el signup define el plan del trial.
    v_code := CASE
      WHEN COALESCE(NEW.servicio_agua, false) AND NOT COALESCE(NEW.servicio_condominios, false)
        THEN 'agua_only'
      WHEN COALESCE(NEW.servicio_condominios, false) AND NOT COALESCE(NEW.servicio_agua, false)
        THEN 'condominios_only'
      ELSE 'bundle'
    END;
    SELECT id INTO v_plan FROM public.billing_plans WHERE code = v_code LIMIT 1;
    IF v_plan IS NULL THEN
      SELECT id INTO v_plan FROM public.billing_plans WHERE code = 'bundle' LIMIT 1;
    END IF;
    INSERT INTO public.subscriptions (company_id, plan_id, status, billing_cycle,
                                      current_period_start, current_period_end, trial_end)
    VALUES (
      NEW.id, v_plan,
      'trialing', 'monthly', now(), now() + interval '14 days', now() + interval '14 days'
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 2. C6: MV con MRR cobrable vs potencial ────────────────────────────────
-- (Las MV no admiten CREATE OR REPLACE con nueva query → DROP + CREATE, mismo
-- procedimiento que 20260710000000. Se recrea WITH DATA; la RPC se recrea abajo
-- porque cambia su RETURNS TABLE.)

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
),
-- F2 (C6): partición del MRR active por cobrabilidad. Una empresa es COBRABLE
-- si su suscripción active tiene stripe_subscription_id (Stripe la factura);
-- sin él es un piloto grandfathered que opera gratis (MRR potencial).
mrr_particion AS (
  SELECT
    COALESCE(sum(ec.monthly_total_cents) FILTER (WHERE cob.es_cobrable), 0)::bigint     AS cobrable,
    COALESCE(sum(ec.monthly_total_cents) FILTER (WHERE NOT cob.es_cobrable), 0)::bigint AS potencial,
    count(*) FILTER (WHERE NOT cob.es_cobrable)::int                                    AS grandfathered
  FROM public.mv_superadmin_empresa_counts ec
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.company_id = ec.company_id
        AND s.status = 'active'
        AND s.stripe_subscription_id IS NOT NULL
    ) AS es_cobrable
  ) cob
  WHERE ec.subscription_status = 'active'
)
SELECT
  1::smallint AS singleton,
  (SELECT count(*)::int FROM public.companies)                       AS total_empresas,
  (SELECT count(*)::int FROM public.companies WHERE activa)          AS empresas_activas,
  (SELECT count(*)::int FROM public.companies WHERE NOT activa)      AS empresas_inactivas,
  (SELECT count(*)::int FROM public.app_users)                       AS total_usuarios,
  (SELECT count(*)::int FROM public.projects)                        AS total_proyectos,
  (SELECT count(*)::int FROM public.unidades)                        AS total_unidades,
  -- mrr_cents: semántica INTACTA (todas las active, por uso) — la serie diaria
  -- de platform_metrics_daily sigue comparable. El desglose va aparte.
  COALESCE((
    SELECT sum(ec.monthly_total_cents)::bigint
    FROM public.mv_superadmin_empresa_counts ec
    WHERE ec.subscription_status = 'active'
  ), 0)                                                              AS mrr_cents,
  (SELECT cobrable FROM mrr_particion)                               AS mrr_cobrable_cents,
  (SELECT potencial FROM mrr_particion)                              AS mrr_potencial_cents,
  (SELECT grandfathered FROM mrr_particion)                          AS empresas_grandfathered,
  (SELECT count(*)::int FROM sub WHERE status = 'active')            AS suscripciones_activas,
  (SELECT count(*)::int FROM sub WHERE status = 'trialing')          AS suscripciones_trialing,
  (SELECT count(*)::int FROM sub
     WHERE status = 'canceled'
       AND canceled_at IS NOT NULL
       AND canceled_at >= now() - interval '30 days')                AS canceladas_30d,
  (SELECT count(*)::int FROM vigentes)                              AS suscripciones_vigentes,
  COALESCE((SELECT dist FROM plan_dist), '[]'::jsonb)               AS plan_distribution,
  now()                                                             AS refreshed_at;

CREATE UNIQUE INDEX IF NOT EXISTS mv_superadmin_plataforma_pk
  ON public.mv_superadmin_plataforma (singleton);

COMMENT ON MATERIALIZED VIEW public.mv_superadmin_plataforma IS
  'KPIs globales del SaaS. mrr_cents = total mensual por USO de las active; mrr_cobrable_cents/mrr_potencial_cents lo parten por cobrabilidad (con/sin stripe_subscription_id — F2/C6); empresas_grandfathered = pilotos active sin Stripe. Refrescada por pg_cron después de mv_superadmin_empresa_counts. Acceso sólo vía RPC.';

REVOKE ALL ON public.mv_superadmin_plataforma FROM PUBLIC, anon, authenticated;

-- ─── 3. RPC con las columnas nuevas (cambia RETURNS TABLE → DROP + CREATE) ──

DROP FUNCTION IF EXISTS public.get_superadmin_plataforma_kpis();

CREATE FUNCTION public.get_superadmin_plataforma_kpis()
RETURNS TABLE (
  total_empresas          int,
  empresas_activas        int,
  empresas_inactivas      int,
  total_usuarios          int,
  total_proyectos         int,
  total_unidades          int,
  mrr_cents               bigint,
  mrr_cobrable_cents      bigint,
  mrr_potencial_cents     bigint,
  empresas_grandfathered  int,
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
           m.mrr_cents, m.mrr_cobrable_cents, m.mrr_potencial_cents,
           m.empresas_grandfathered,
           m.suscripciones_activas, m.suscripciones_trialing,
           m.canceladas_30d, m.suscripciones_vigentes, m.plan_distribution,
           m.refreshed_at
    FROM public.mv_superadmin_plataforma m;
END
$$;

COMMENT ON FUNCTION public.get_superadmin_plataforma_kpis() IS
  'plat KPIs globales del SaaS desde mv_superadmin_plataforma (incluye el desglose MRR cobrable/potencial de F2). User-facing acotada a super_admin (GRANT authenticated + chequeo interno).';

REVOKE ALL ON FUNCTION public.get_superadmin_plataforma_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_superadmin_plataforma_kpis() TO authenticated;
