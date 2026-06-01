-- ============================================================================
-- Email send queue with exponential backoff retry (F2.15e, com:N1 part 2)
-- ============================================================================
-- send-email Edge Function antes enviaba 1 vez y moria — fallas transitorias
-- (Gmail 429, 5xx, network) perdian el correo. Esta migracion agrega la queue
-- + RPCs atomicos para que el worker process-email-queue pueda retomar
-- intentos con backoff exponencial.
--
-- Flujo:
--   1. send-email recibe request, intenta enviar sincronamente.
--   2. Si exito → INSERT email_send_log status='sent' (mismo flujo de antes).
--   3. Si error retriable → INSERT email_send_queue status='pending',
--      next_attempt_at = now() + 30s. Log queda 'pending_retry'.
--   4. Si error NO retriable (400, 403 token revoked) → log 'failed' definitivo.
--   5. process-email-queue cron-driven: pop_email_batch(50) bajo FOR UPDATE
--      SKIP LOCKED, reintenta cada uno, update_email_attempt registra el resultado.
--   6. Backoff: 30s, 60s, 120s, 240s, 480s, 960s (6 intentos ~32 min total).
--   7. Despues de max_attempts → status='failed_permanent', el cron lo ignora.
--
-- RLS: la queue es interna; solo super_admin lee desde UI (futura) y los
-- workers escriben via service_role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_send_queue (
  id bigserial PRIMARY KEY,
  -- Payload completo del EmailPayload original (template_key, to_email, vars, etc.)
  -- para poder reintentar sin que el caller original lo recapture.
  payload jsonb NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  is_superadmin boolean NOT NULL DEFAULT false,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Estado: pending | sending | sent | failed_permanent
  --   pending          → esperando proximo intento
  --   sending          → tomado por un worker (lock implicito via SKIP LOCKED)
  --   sent             → entregado por Gmail
  --   failed_permanent → max_attempts alcanzado o error no retriable
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed_permanent')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 6 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indice para pop_email_batch: status='pending' AND next_attempt_at <= now().
-- Partial WHERE para que solo indexa filas activas (sent/failed_permanent no
-- ocupan espacio en el indice).
CREATE INDEX IF NOT EXISTS idx_email_send_queue_pending_ready
  ON public.email_send_queue(next_attempt_at)
  WHERE status = 'pending';

-- Indice para UI futura "ver fallidos por company".
CREATE INDEX IF NOT EXISTS idx_email_send_queue_company_recent
  ON public.email_send_queue(company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

ALTER TABLE public.email_send_queue ENABLE ROW LEVEL SECURITY;

-- Solo super_admin lee desde frontend; los workers usan service_role que
-- bypassea RLS.
DROP POLICY IF EXISTS "email_send_queue_select_super" ON public.email_send_queue;
CREATE POLICY "email_send_queue_select_super"
  ON public.email_send_queue FOR SELECT
  USING (is_super_admin());

COMMENT ON TABLE public.email_send_queue IS
  'Cola de reintentos para send-email. Worker process-email-queue corre cada 5 min via pg_cron y reintenta con backoff exponencial.';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC enqueue_email: insert atomico desde send-email cuando el intento sync
-- falla con error retriable. Devuelve el id de la nueva fila.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_email(
  p_payload jsonb,
  p_company_id uuid,
  p_is_superadmin boolean,
  p_triggered_by uuid,
  p_first_error text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO public.email_send_queue (
    payload, company_id, is_superadmin, triggered_by,
    status, attempts, next_attempt_at, last_error
  ) VALUES (
    p_payload, p_company_id, p_is_superadmin, p_triggered_by,
    'pending', 1, now() + interval '30 seconds', p_first_error
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Solo service_role llama a este RPC desde send-email.
REVOKE EXECUTE ON FUNCTION public.enqueue_email(jsonb, uuid, boolean, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_email(jsonb, uuid, boolean, uuid, text) TO service_role;

COMMENT ON FUNCTION public.enqueue_email IS
  'Enqueue de un email que fallo el intento sincrono. attempts=1 porque ya hubo 1 intento; next_attempt_at=now()+30s.';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC pop_email_batch: toma hasta N filas pending listas, marca sending y las
-- devuelve. Usa FOR UPDATE SKIP LOCKED para soportar workers concurrentes.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pop_email_batch(p_batch_size integer DEFAULT 50)
RETURNS TABLE(
  id bigint,
  payload jsonb,
  company_id uuid,
  is_superadmin boolean,
  triggered_by uuid,
  attempts integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH popped AS (
    SELECT q.id
    FROM public.email_send_queue q
    WHERE q.status = 'pending'
      AND q.next_attempt_at <= now()
    ORDER BY q.next_attempt_at ASC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_send_queue u
  SET status = 'sending', updated_at = now()
  FROM popped
  WHERE u.id = popped.id
  RETURNING u.id, u.payload, u.company_id, u.is_superadmin, u.triggered_by, u.attempts, u.max_attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.pop_email_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pop_email_batch(integer) TO service_role;

COMMENT ON FUNCTION public.pop_email_batch IS
  'Saca hasta N rows pending listas para reintentar. FOR UPDATE SKIP LOCKED permite multiples workers sin race.';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC update_email_attempt: el worker llama esto despues de cada intento.
-- p_ok=true → status='sent'. p_ok=false → si attempts>=max → failed_permanent,
-- si no → vuelve a pending con backoff exponencial.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_email_attempt(
  p_id bigint,
  p_ok boolean,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_attempts integer;
  v_max integer;
  v_backoff_seconds integer;
BEGIN
  IF p_ok THEN
    UPDATE public.email_send_queue
    SET status = 'sent', updated_at = now(), last_error = NULL
    WHERE id = p_id;
    RETURN;
  END IF;

  SELECT attempts + 1, max_attempts INTO v_attempts, v_max
  FROM public.email_send_queue
  WHERE id = p_id
  FOR UPDATE;

  IF v_attempts >= v_max THEN
    UPDATE public.email_send_queue
    SET status = 'failed_permanent',
        attempts = v_attempts,
        last_error = p_error,
        updated_at = now()
    WHERE id = p_id;
    RETURN;
  END IF;

  -- Backoff exponencial: 30s, 60s, 120s, 240s, 480s, 960s.
  -- Cap a 30 min para no diferir indefinidamente.
  v_backoff_seconds := LEAST(30 * (2 ^ (v_attempts - 1))::integer, 1800);

  UPDATE public.email_send_queue
  SET status = 'pending',
      attempts = v_attempts,
      next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
      last_error = p_error,
      updated_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_email_attempt(bigint, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_email_attempt(bigint, boolean, text) TO service_role;

COMMENT ON FUNCTION public.update_email_attempt IS
  'Reporta el resultado de un intento. p_ok=true marca sent. p_ok=false: si excede max_attempts → failed_permanent, si no → pending con next_attempt_at=now()+exp_backoff.';

-- ────────────────────────────────────────────────────────────────────────────
-- Ampliar el CHECK de email_send_log para aceptar 'pending_retry'. send-email
-- usa este status cuando el envio sincrono fallo pero quedo enqueued con exito.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_status_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_status_check
  CHECK (status IN ('sent', 'failed', 'pending_retry'));

-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron: process-email-queue cada 5 minutos
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo patron que route_reminders: secretos en Vault (no en SQL), function
-- bail-out si no estan configurados todavia.
--
-- Vault keys requeridas (set una vez via dashboard):
--   - email_queue_url          = https://<ref>.supabase.co/functions/v1/process-email-queue
--   - email_queue_cron_secret  = string aleatorio compartido con CRON_SECRET del edge function
--
-- Si faltan, la function corre como no-op (segura de aplicar antes de
-- configurar los secrets).

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_email_queue_worker()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'email_queue_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'email_queue_cron_secret';

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

REVOKE EXECUTE ON FUNCTION public.run_email_queue_worker() FROM PUBLIC;

-- Reschedule idempotente: tira la job anterior si existe, luego (re)programa
-- cada 5 minutos.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'email_queue_worker';
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'email_queue_worker',
  '*/5 * * * *',
  $$SELECT public.run_email_queue_worker();$$
);
