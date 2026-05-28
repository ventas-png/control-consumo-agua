-- ============================================================================
-- Stripe platform integration: webhook idempotency + audit + rate limit
-- (plat:P1 part 2, F2.12)
-- ============================================================================
-- Sienta la infraestructura de seguridad alrededor de la integracion Stripe
-- platform (cobro del SaaS a las companies). Las edge functions deployadas
-- en este PR la usan:
--
--   - stripe_webhook_events: idempotencia. Stripe a veces reentrega el mismo
--     evento (network jitter, retries). Insertamos antes de procesar; si
--     UNIQUE constraint dispara, retornamos 200 sin re-aplicar el efecto.
--
--   - rate_limit_log: bucketing simple por (user_id, action, ventana 1h).
--     create-checkout-session y create-billing-portal-session lo consultan
--     antes de actuar. Previene abuso/spam.
--
--   - Audit triggers en subscriptions e invoices reutilizando
--     audit_trigger_func() de F2.7 → cada cambio queda en audit_log con
--     before/after + actor (NULL si lo escribio el webhook con service_role).
--
-- Sin secrets en DB. STRIPE_PLATFORM_SECRET_KEY y STRIPE_PLATFORM_WEBHOOK_SECRET
-- viven en env vars de Supabase Edge Functions.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. stripe_webhook_events — idempotencia
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id     text         PRIMARY KEY,
  event_type   text         NOT NULL,
  livemode     boolean      NOT NULL DEFAULT false,
  payload      jsonb        NOT NULL,
  received_at  timestamptz  NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_recent
  ON public.stripe_webhook_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_failed
  ON public.stripe_webhook_events(received_at DESC)
  WHERE processed_at IS NULL OR error_message IS NOT NULL;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stripe_webhook_events_select" ON public.stripe_webhook_events;
CREATE POLICY "stripe_webhook_events_select" ON public.stripe_webhook_events
  FOR SELECT TO authenticated
  USING (is_super_admin());

DROP POLICY IF EXISTS "service_role_stripe_webhook_events" ON public.stripe_webhook_events;
CREATE POLICY "service_role_stripe_webhook_events" ON public.stripe_webhook_events
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.stripe_webhook_events IS
  'Idempotencia de webhooks Stripe platform. event_id es el evt_* de Stripe; INSERT con PK falla en duplicados → webhook devuelve 200 sin re-aplicar.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. rate_limit_log — bucketing por (user_id, action, ventana)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limit_log (
  id       bigserial    PRIMARY KEY,
  user_id  uuid         REFERENCES auth.users(id) ON DELETE CASCADE,
  action   text         NOT NULL,
  at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_action_recent
  ON public.rate_limit_log(user_id, action, at DESC);

-- Limpieza periodica: filas de mas de 24h ya no aportan. Cron mensual o
-- on-demand cuando crezca. Sin auto-vacuum custom; pg_partman queda fuera de
-- scope. El index parcial mantiene queries rapidas igual.

ALTER TABLE public.rate_limit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rate_limit_log_select" ON public.rate_limit_log;
CREATE POLICY "rate_limit_log_select" ON public.rate_limit_log
  FOR SELECT TO authenticated
  USING (is_super_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS "service_role_rate_limit_log" ON public.rate_limit_log;
CREATE POLICY "service_role_rate_limit_log" ON public.rate_limit_log
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE public.rate_limit_log IS
  'Audit ligero para rate limit por (user_id, action). Las edge functions cuentan filas en ventana 1h antes de actuar.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Audit triggers en subscriptions e invoices
--    Reutiliza audit_trigger_func() de 20260528000000_audit_log_generic.sql.
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_subscriptions ON public.subscriptions;
CREATE TRIGGER audit_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_invoices ON public.invoices;
CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Helper: rate_limit_check
--    SECURITY DEFINER para que las edge functions invoquen sin abrir
--    permisos extras al cliente.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_user_id   uuid,
  p_action    text,
  p_max_count integer,
  p_window    interval DEFAULT interval '1 hour'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.rate_limit_log
  WHERE user_id = p_user_id
    AND action = p_action
    AND at > (now() - p_window);

  IF v_count >= p_max_count THEN
    RETURN false;
  END IF;

  INSERT INTO public.rate_limit_log (user_id, action)
  VALUES (p_user_id, p_action);

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_check IS
  'Verifica si user_id puede ejecutar action: cuenta filas en ventana, si esta bajo el max INSERTa y devuelve true. Atomico (sin race condition real en MVP — Stripe maneja idempotency del lado pago).';
