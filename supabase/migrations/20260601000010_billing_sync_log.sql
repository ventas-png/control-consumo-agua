-- ============================================================================
-- Stripe usage-based billing sync (F2.15d, plat:P1 part 5)
-- ============================================================================
-- Cierra el gap: calculate_monthly_total_cents (F2.14) calcula el monto que
-- Stripe deberia cobrar, pero las quantities de los subscription items solo
-- se setean en el checkout inicial. Si una company pasa de 100 → 800 unidades
-- en el mes, Stripe sigue facturando 100 hasta el proximo checkout.
--
-- Esta migracion:
--   1. Crea billing_sync_log para rastrear ejecuciones del worker.
--   2. Crea run_billing_sync() invocado por pg_cron diario (03:00 UTC) que
--      llama al edge function sync-stripe-quantities.
--   3. Secretos via Vault (mismo patron que email_queue_worker / route_reminders).
--
-- Pre-requisito: el edge function sync-stripe-quantities (deploy manual via
-- supabase functions deploy) toma cada subscription activa, calcula quantity
-- esperada, compara con la subscription_item de Stripe, y hace
-- subscriptionItems.update con proration_behavior='create_prorations'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.billing_sync_log (
  id bigserial PRIMARY KEY,
  -- Una fila por subscription procesada en cada run.
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  stripe_subscription_id text,
  -- 'noop' = quantities ya estaban correctos
  -- 'updated' = al menos 1 item se actualizo
  -- 'skipped' = subscription no elegible (canceled, no stripe_subscription_id)
  -- 'error' = excepcion durante la sync (last_error tiene el detalle)
  outcome text NOT NULL CHECK (outcome IN ('noop', 'updated', 'skipped', 'error')),
  -- Snapshot del before/after en JSONB: { activation: {before, after},
  -- unit_primary: {...}, extra_project: {...}, unit_extra: {...} }.
  -- Permite reconstruir que cambio sin volver a llamar Stripe.
  changes jsonb,
  last_error text,
  ran_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_sync_log_recent
  ON public.billing_sync_log(ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_sync_log_company
  ON public.billing_sync_log(company_id, ran_at DESC)
  WHERE company_id IS NOT NULL;

ALTER TABLE public.billing_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "billing_sync_log_select_super" ON public.billing_sync_log;
CREATE POLICY "billing_sync_log_select_super"
  ON public.billing_sync_log FOR SELECT
  USING (is_super_admin());

COMMENT ON TABLE public.billing_sync_log IS
  'Bitacora por subscription de cada run de sync-stripe-quantities (F2.15d). Una fila por subscription procesada.';

-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron: sync-stripe-quantities diario 03:00 UTC
-- ────────────────────────────────────────────────────────────────────────────
-- Vault keys requeridas:
--   billing_sync_url          = https://<ref>.supabase.co/functions/v1/sync-stripe-quantities
--   billing_sync_cron_secret  = string aleatorio compartido con CRON_SECRET del edge function
--
-- Si faltan, run_billing_sync() es no-op (safe to apply antes de configurar).

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_billing_sync()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'billing_sync_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'billing_sync_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.run_billing_sync() FROM PUBLIC;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'billing_sync_daily';
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'billing_sync_daily',
  '0 3 * * *',
  $$SELECT public.run_billing_sync();$$
);
