-- ============================================================================
-- Billing schema foundation (plat:P1, F2.11)
-- ============================================================================
-- Crea las tres tablas core para SaaS billing:
--   1. billing_plans  — catalogo de planes (Solo Agua / Solo Condominios /
--      Bundle). Reemplaza el companies.plan text-libre con un FK a una entry
--      versionada con limits + features + stripe_price_id.
--   2. subscriptions — una por company. Tracking de status (trialing/active/
--      past_due/canceled), periodo actual, trial_end, ids de Stripe.
--   3. invoices      — historial de cobros emitidos a las companies por su
--      uso de AdministraTodo. Distinto de la tabla `pagos` que registra cobros
--      del TENANT a SUS clientes.
--
-- Sin integracion Stripe en este PR — todos los campos stripe_* arrancan NULL.
-- F2.12 conectara Checkout + webhook handler para poblarlos.
--
-- RLS:
--   - billing_plans: SELECT publico para authenticated (catalogo).
--   - subscriptions: super_admin ve todo; company_owner/admin ve su company.
--   - invoices: super_admin ve todo; company_owner/admin ve su company.
--   - Sin INSERT/UPDATE/DELETE policies en client — solo service_role del
--     webhook handler (F2.12) modifica subscriptions e invoices.
--
-- Backfill: cada company existente recibe una subscription activa con plan
-- inferido de servicio_agua + servicio_condominios. Period del mes en curso.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. billing_plans — catalogo de planes
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text          NOT NULL UNIQUE,
  name                     text          NOT NULL,
  description              text,
  price_monthly_cents      integer       NOT NULL DEFAULT 0,
  price_yearly_cents       integer,
  currency                 text          NOT NULL DEFAULT 'usd',
  max_projects             integer,
  max_units                integer,
  includes_agua            boolean       NOT NULL DEFAULT false,
  includes_condominios     boolean       NOT NULL DEFAULT false,
  features                 jsonb         NOT NULL DEFAULT '[]'::jsonb,
  is_active                boolean       NOT NULL DEFAULT true,
  stripe_price_id_monthly  text,
  stripe_price_id_yearly   text,
  sort_order               integer       NOT NULL DEFAULT 0,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_plans_select" ON public.billing_plans;
CREATE POLICY "billing_plans_select" ON public.billing_plans
  FOR SELECT TO authenticated
  USING (is_active = true OR is_super_admin());

COMMENT ON TABLE public.billing_plans IS
  'Catalogo de planes de suscripcion. Lectura publica para authenticated; escritura solo service_role.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. subscriptions — una por company
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id                  uuid          NOT NULL REFERENCES public.billing_plans(id) ON DELETE RESTRICT,
  status                   text          NOT NULL CHECK (status IN (
                              'trialing', 'active', 'past_due', 'canceled',
                              'incomplete', 'incomplete_expired', 'unpaid'
                            )),
  billing_cycle            text          NOT NULL DEFAULT 'monthly'
                            CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start     timestamptz   NOT NULL DEFAULT now(),
  current_period_end       timestamptz   NOT NULL,
  trial_end                timestamptz,
  canceled_at              timestamptz,
  cancel_at_period_end     boolean       NOT NULL DEFAULT false,
  stripe_subscription_id   text          UNIQUE,
  stripe_customer_id       text,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_company
  ON public.subscriptions(company_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON public.subscriptions(status, current_period_end);

-- Una sola suscripcion "activa" (no canceled / expired) por company. Permite
-- mantener historial mientras se enfuerza unicidad del estado vigente.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_company_active
  ON public.subscriptions(company_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'incomplete');

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;
CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

DROP POLICY IF EXISTS "service_role_subscriptions" ON public.subscriptions;
CREATE POLICY "service_role_subscriptions" ON public.subscriptions
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.subscriptions IS
  'Suscripcion de cada tenant al SaaS. Escrita exclusivamente por el webhook handler de Stripe via service_role.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. invoices — historial de cobros emitidos por AdministraTodo al tenant
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id          uuid          NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  company_id               uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amount_cents             integer       NOT NULL CHECK (amount_cents >= 0),
  currency                 text          NOT NULL DEFAULT 'usd',
  status                   text          NOT NULL CHECK (status IN (
                              'draft', 'open', 'paid', 'void', 'uncollectible'
                            )),
  period_start             timestamptz   NOT NULL,
  period_end               timestamptz   NOT NULL,
  due_date                 timestamptz,
  paid_at                  timestamptz,
  stripe_invoice_id        text          UNIQUE,
  pdf_url                  text,
  created_at               timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_company_recent
  ON public.invoices(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_subscription
  ON public.invoices(subscription_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_unpaid
  ON public.invoices(company_id, due_date)
  WHERE status = 'open';

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

DROP POLICY IF EXISTS "service_role_invoices" ON public.invoices;
CREATE POLICY "service_role_invoices" ON public.invoices
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.invoices IS
  'Facturas emitidas por AdministraTodo al tenant por su uso del SaaS. Distinta de public.pagos (cobros del TENANT a SUS clientes).';

-- ────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_billing_plans_updated_at ON public.billing_plans;
CREATE TRIGGER trg_billing_plans_updated_at
  BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Seed inicial de planes (precios en index.html JSON-LD)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.billing_plans (
  code, name, description, price_monthly_cents, price_yearly_cents,
  currency, includes_agua, includes_condominios, max_projects, max_units,
  features, sort_order
) VALUES
  (
    'agua_only', 'Solo Agua',
    'Lecturas, cobros, rutas y tarifas. Ideal para operadoras de agua y juntas vecinales.',
    1000, 10000, 'usd',
    true, false,
    5, 50,
    '["Lecturas en vivo","Cobros automaticos","Mapa de medidores","Reportes mensuales"]'::jsonb,
    10
  ),
  (
    'condominios_only', 'Solo Condominios',
    'Cuotas, areas comunes, visitantes, tickets y comunicacion con residentes.',
    1000, 10000, 'usd',
    false, true,
    5, 50,
    '["Cuotas y conciliacion","Reservas de amenidades","Visitantes y paquetes","Tickets de mantenimiento","Portal del residente"]'::jsonb,
    20
  ),
  (
    'bundle', 'Bundle Completo',
    'Agua + Condominios juntos. Para administradoras integrales.',
    1500, 15000, 'usd',
    true, true,
    5, 50,
    '["Todo de Solo Agua","Todo de Solo Condominios","Cobranza unificada"]'::jsonb,
    30
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_yearly_cents = EXCLUDED.price_yearly_cents,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  includes_agua = EXCLUDED.includes_agua,
  includes_condominios = EXCLUDED.includes_condominios,
  updated_at = now();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Backfill de subscriptions para companies existentes
-- ────────────────────────────────────────────────────────────────────────────
-- Cada company existente recibe una subscription activa con plan inferido de
-- sus flags servicio_agua + servicio_condominios. Period del mes en curso para
-- dar un punto de partida razonable; el webhook handler ajustara cuando empiece
-- a fluir el billing real.
--
-- Skipea companies que ya tengan subscription (idempotencia).
INSERT INTO public.subscriptions (
  company_id, plan_id, status, billing_cycle,
  current_period_start, current_period_end
)
SELECT
  c.id,
  COALESCE(
    bp.id,
    (SELECT id FROM public.billing_plans WHERE code = 'bundle' LIMIT 1)
  ) AS plan_id,
  'active' AS status,
  'monthly' AS billing_cycle,
  date_trunc('month', now()) AS current_period_start,
  date_trunc('month', now()) + interval '1 month' AS current_period_end
FROM public.companies c
LEFT JOIN public.billing_plans bp ON bp.code = CASE
  WHEN c.servicio_agua AND c.servicio_condominios THEN 'bundle'
  WHEN c.servicio_agua AND NOT c.servicio_condominios THEN 'agua_only'
  WHEN c.servicio_condominios AND NOT c.servicio_agua THEN 'condominios_only'
  ELSE 'bundle'
END
WHERE NOT EXISTS (
  SELECT 1 FROM public.subscriptions s
  WHERE s.company_id = c.id
    AND s.status IN ('trialing', 'active', 'past_due', 'incomplete')
);
