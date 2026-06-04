-- ============================================================================
-- Notifications outbox — backbone del orquestador multi-canal (T2/com:N2)
-- ============================================================================
-- Epica #301 · sub-issue #313 (N2). Banda de migracion T2: 20260604100000.
--
-- Hoy cada productor envia directo: send-email habla con Gmail, route-reminders
-- inserta en user_notifications a mano, etc. No hay un punto unico para encolar,
-- reintentar, diferir (scheduled_at) ni auditar entregas por canal.
--
-- notifications_outbox es ese punto unico: un productor encola UNA fila por
-- (destinatario, canal) y el edge function `notifications-dispatcher` (cron) la
-- toma, despacha por el canal correspondiente y registra el resultado. Es el
-- nivel superior y agnostico de canal; complementa — no reemplaza —
-- email_send_queue (que es la cola de reintentos especifica de Gmail a mas bajo
-- nivel, F2.15e). El dispatcher puede usar in_app directo y email via Gmail.
--
-- Flujo:
--   1. Un productor (cron, edge fn, trigger) inserta status='queued' con el
--      canal, recipient, payload y opcionalmente scheduled_at en el futuro.
--   2. notifications-dispatcher corre por cron: claim_notifications_batch(N)
--      toma hasta N filas queued listas (scheduled_at <= now()) bajo FOR UPDATE
--      SKIP LOCKED y las marca 'sending'.
--   3. Por cada fila despacha segun channel:
--        in_app   → INSERT en public.user_notifications (la campana existente)
--        email    → Gmail via company_email_configs (+ email_templates override)
--        whatsapp → placeholder (follow-up: proveedor WhatsApp)
--        push     → placeholder (follow-up: web push / FCM)
--   4. mark_notification_result reporta exito/fallo: ok → 'sent' (o 'delivered'
--      cuando el canal lo confirme), fallo retriable → vuelve a 'queued' con
--      backoff exponencial, fallo terminal o max intentos → 'failed'.
--
-- Estados:
--   queued    → esperando despacho (scheduled_at marca cuando esta listo)
--   sending   → tomado por el dispatcher (lock implicito via SKIP LOCKED)
--   sent      → entregado al proveedor del canal
--   delivered → confirmado entregado al destinatario (webhooks futuros)
--   read      → el destinatario lo abrio/leyo (in_app marca leido, etc.)
--   failed    → fallo terminal o se agotaron los intentos
--   bounced   → rebote duro reportado por el proveedor (tracking: follow-up)
--
-- RLS: scope por company_id — admin/owner del tenant lee su propio outbox;
-- super_admin ve todo; los workers escriben via service_role (bypassea RLS).
-- Mismo patron que email_send_log (F2.9) y email_send_queue (F2.15e).
--
-- Idempotencia: CREATE TABLE/INDEX/EXTENSION IF NOT EXISTS, DROP POLICY IF
-- EXISTS antes de CREATE POLICY, CREATE OR REPLACE en funciones.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Scope tenant. Nullable para notificaciones de plataforma (super_admin).
  company_id    uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Canal de entrega.
  channel       text NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'push')),
  -- Plantilla a renderizar (opcional). Resuelve contra notification_templates
  -- o, para email, contra email_templates/render por defecto de send-email.
  template_key  text,
  -- Datos para renderizar la plantilla y/o construir la notificacion in-app
  -- (titulo, cuerpo, seccion, ids de navegacion, vars de email, etc.).
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Destinatario segun canal: user_id (in_app), email (email), telefono
  -- (whatsapp), token/endpoint (push). Texto libre para no acoplar el canal.
  recipient     text,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'bounced')),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_error    text,
  -- Cuando la notificacion esta lista para despacharse. Default now() = ya.
  -- Un valor futuro la difiere (recordatorios programados, digests, etc.).
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  -- Sello de cada transicion relevante para auditoria/observabilidad.
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications_outbox IS
  'Outbox multi-canal del orquestador de notificaciones (T2/com:N2). Productores encolan status=queued; el edge function notifications-dispatcher (cron) despacha por canal y actualiza status/attempts/last_error. Scope tenant via company_id (RLS).';

-- Indice principal del dispatcher: claim de filas listas. Partial WHERE para
-- indexar solo lo activo (sent/delivered/read/failed/bounced no ocupan espacio).
CREATE INDEX IF NOT EXISTS idx_notif_outbox_dispatch
  ON public.notifications_outbox(scheduled_at)
  WHERE status = 'queued';

-- Indice por tenant para la UI futura ("ver mis notificaciones / fallidas").
CREATE INDEX IF NOT EXISTS idx_notif_outbox_company
  ON public.notifications_outbox(company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin ve todo; admin/owner ve su propio tenant. Sin
-- INSERT/UPDATE/DELETE para 'authenticated' — solo el dispatcher y los
-- productores (service_role, que bypassea RLS) escriben. Mismo patron que
-- email_send_log.
DROP POLICY IF EXISTS "notif_outbox_select" ON public.notifications_outbox;
CREATE POLICY "notif_outbox_select" ON public.notifications_outbox
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

-- Politica explicita para service_role (workers). Redundante con el bypass de
-- RLS de service_role, pero declara la intencion igual que email_send_queue.
DROP POLICY IF EXISTS "notif_outbox_service_role" ON public.notifications_outbox;
CREATE POLICY "notif_outbox_service_role" ON public.notifications_outbox
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- RPC enqueue_notification: insert atomico para productores (service_role).
-- Devuelve el id de la nueva fila. scheduled_at default now() = despacho ya.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_channel       text,
  p_recipient     text,
  p_payload       jsonb DEFAULT '{}'::jsonb,
  p_company_id    uuid DEFAULT NULL,
  p_template_key  text DEFAULT NULL,
  p_scheduled_at  timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_channel NOT IN ('in_app', 'email', 'whatsapp', 'push') THEN
    RAISE EXCEPTION 'canal invalido: %', p_channel;
  END IF;

  INSERT INTO public.notifications_outbox (
    company_id, channel, template_key, payload, recipient, scheduled_at
  ) VALUES (
    p_company_id, p_channel, p_template_key, COALESCE(p_payload, '{}'::jsonb),
    p_recipient, COALESCE(p_scheduled_at, now())
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enqueue_notification(text, text, jsonb, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(text, text, jsonb, uuid, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.enqueue_notification IS
  'Encola una notificacion en notifications_outbox (status=queued). Solo service_role. scheduled_at futuro difiere el despacho.';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC claim_notifications_batch: toma hasta N filas queued listas, las marca
-- 'sending' y las devuelve. FOR UPDATE SKIP LOCKED → dispatchers concurrentes
-- sin race. Mismo patron que pop_email_batch (F2.15e).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_notifications_batch(p_batch_size integer DEFAULT 50)
RETURNS TABLE(
  id           uuid,
  company_id   uuid,
  channel      text,
  template_key text,
  payload      jsonb,
  recipient    text,
  attempts     integer,
  max_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id
    FROM public.notifications_outbox o
    WHERE o.status = 'queued'
      AND o.scheduled_at <= now()
    ORDER BY o.scheduled_at ASC
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notifications_outbox u
  SET status = 'sending', updated_at = now()
  FROM claimed
  WHERE u.id = claimed.id
  RETURNING u.id, u.company_id, u.channel, u.template_key, u.payload, u.recipient, u.attempts, u.max_attempts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_notifications_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_notifications_batch(integer) TO service_role;

COMMENT ON FUNCTION public.claim_notifications_batch IS
  'Saca hasta N filas queued listas (scheduled_at<=now()) y las marca sending. FOR UPDATE SKIP LOCKED permite multiples dispatchers sin race.';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC mark_notification_result: el dispatcher reporta el resultado de un envio.
--   p_ok=true  → status='sent', sent_at=now() (delivered/read los marcan
--                webhooks/confirmaciones futuras).
--   p_ok=false → si attempts+1 >= max o el error es terminal (p_retriable=false)
--                → 'failed'; si no → vuelve a 'queued' con backoff exponencial.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notification_result(
  p_id        uuid,
  p_ok        boolean,
  p_error     text DEFAULT NULL,
  p_retriable boolean DEFAULT true
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
    UPDATE public.notifications_outbox
    SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now()
    WHERE id = p_id;
    RETURN;
  END IF;

  SELECT attempts + 1, max_attempts INTO v_attempts, v_max
  FROM public.notifications_outbox
  WHERE id = p_id
  FOR UPDATE;

  IF v_attempts IS NULL THEN
    RETURN;  -- fila inexistente
  END IF;

  -- Fallo terminal (no retriable) o se agotaron los intentos → failed.
  IF NOT p_retriable OR v_attempts >= v_max THEN
    UPDATE public.notifications_outbox
    SET status = 'failed', attempts = v_attempts, last_error = p_error, updated_at = now()
    WHERE id = p_id;
    RETURN;
  END IF;

  -- Backoff exponencial: 30s, 60s, 120s, 240s, 480s. Cap a 30 min.
  v_backoff_seconds := LEAST(30 * (2 ^ (v_attempts - 1))::integer, 1800);

  UPDATE public.notifications_outbox
  SET status = 'queued',
      attempts = v_attempts,
      scheduled_at = now() + make_interval(secs => v_backoff_seconds),
      last_error = p_error,
      updated_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notification_result(uuid, boolean, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_result(uuid, boolean, text, boolean) TO service_role;

COMMENT ON FUNCTION public.mark_notification_result IS
  'Reporta el resultado de un despacho. p_ok=true → sent. p_ok=false: si excede max_attempts o p_retriable=false → failed; si no → queued con backoff exponencial.';

-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron: notifications-dispatcher cada minuto
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo patron que route_reminders / email_queue_worker: secretos en Vault (no
-- en SQL), la function es no-op si no estan configurados todavia → segura de
-- aplicar antes de configurar los secrets.
--
-- Vault keys requeridas (set una vez via dashboard):
--   - notifications_dispatcher_url          = https://<ref>.supabase.co/functions/v1/notifications-dispatcher
--   - notifications_dispatcher_cron_secret  = string aleatorio compartido con CRON_SECRET del edge function

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_notifications_dispatcher()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'notifications_dispatcher_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'notifications_dispatcher_cron_secret';

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

REVOKE EXECUTE ON FUNCTION public.run_notifications_dispatcher() FROM PUBLIC;

-- Reschedule idempotente: tira la job anterior si existe, luego (re)programa
-- cada minuto.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'notifications_dispatcher';
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'notifications_dispatcher',
  '* * * * *',
  $$SELECT public.run_notifications_dispatcher();$$
);
