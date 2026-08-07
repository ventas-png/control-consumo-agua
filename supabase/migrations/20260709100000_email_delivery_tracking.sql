-- ============================================================================
-- Tracking de entrega/lectura/bounce — com:N4 / com:N26 (épica #301, issue #315)
-- ============================================================================
-- Banda de migración 2026-07-09: 20260709100000.
--
-- notifications_outbox ya definía los estados delivered/read/bounced y los
-- sellos delivered_at/read_at, pero NINGÚN código los escribía, y ningún sender
-- persistía el message id de Gmail — sin eso no hay correlación envío↔evento.
-- Esta migración cablea la mitad que NO depende de decisiones del dueño:
--
--   1. Correlación: notifications_outbox.provider_message_id (Gmail message id
--      para email; user_notifications.id para in_app) + email_send_log
--      {gmail_message_id, tracking_id} para los envíos directos de send-email.
--   2. Lectura de emails (píxel): el edge público track-email-open valida un
--      token HMAC y marca read (outbox, vía mark_notification_delivery) u
--      opened_at (email_send_log, vía mark_email_open).
--   3. Lectura in_app: trigger sobre user_notifications.leido → propaga read al
--      outbox (correlacionado por provider_message_id).
--   4. Bounce: mark_notification_delivery ya acepta 'bounced' (estado, sello y
--      razón) — el PRODUCTOR queda parqueado a propósito: Gmail (proveedor
--      actual, scope gmail.send) no emite webhooks de bounce ni permite leer
--      los DSN de mailer-daemon sin ampliar scope (gmail.readonly = scope
--      restringido de Google → re-verificación CASA). Cuando el dueño decida
--      (proveedor con webhooks tipo Resend/SES, o ampliar scope), el receptor
--      solo tiene que llamar a este RPC. Mismo patrón que #391/#430.
--
-- Seguridad: RPCs SECURITY DEFINER con REVOKE por nombre de rol + GRANT solo a
-- service_role (lección #380). El trigger es SECURITY DEFINER para poder
-- actualizar el outbox (deny-write para authenticated) cuando el destinatario
-- marca leída su campana.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT/TRIGGER IF EXISTS,
-- CREATE OR REPLACE en funciones.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Correlación + sellos de bounce en el outbox
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications_outbox ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE public.notifications_outbox ADD COLUMN IF NOT EXISTS bounced_at timestamptz;
ALTER TABLE public.notifications_outbox ADD COLUMN IF NOT EXISTS bounce_reason text;

COMMENT ON COLUMN public.notifications_outbox.provider_message_id IS
  'Referencia del mensaje en el canal: Gmail message id (email) o user_notifications.id (in_app). Correlaciona envío↔evento de entrega/lectura/bounce.';

-- Lookup del webhook/checker de bounces y del trigger de lectura in_app.
CREATE INDEX IF NOT EXISTS idx_notif_outbox_provider_msg
  ON public.notifications_outbox(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Correlación + tracking en email_send_log (envíos directos de send-email)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_send_log ADD COLUMN IF NOT EXISTS gmail_message_id text;
ALTER TABLE public.email_send_log ADD COLUMN IF NOT EXISTS tracking_id uuid;
ALTER TABLE public.email_send_log ADD COLUMN IF NOT EXISTS opened_at timestamptz;
ALTER TABLE public.email_send_log ADD COLUMN IF NOT EXISTS bounced_at timestamptz;
ALTER TABLE public.email_send_log ADD COLUMN IF NOT EXISTS bounce_reason text;

COMMENT ON COLUMN public.email_send_log.tracking_id IS
  'Id efímero embebido (firmado) en el píxel del correo; track-email-open marca opened_at por este id sin exponer el id del log.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_send_log_tracking
  ON public.email_send_log(tracking_id)
  WHERE tracking_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. notification_events acepta 'read' (apertura del píxel / campana in_app)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.notification_events DROP CONSTRAINT IF EXISTS notification_events_event_type_check;
ALTER TABLE public.notification_events ADD CONSTRAINT notification_events_event_type_check
  CHECK (event_type IN ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed', 'read'));

-- ────────────────────────────────────────────────────────────────────────────
-- 4. RPC mark_notification_delivery — transición post-envío del outbox
--    ('delivered' | 'read' | 'bounced') + rastro append-only.
--    Solo transiciona filas que YA llegaron al proveedor (sent/delivered/read):
--    nunca resucita queued/sending/failed/suppressed. Idempotente: los sellos
--    usan COALESCE y el estado nunca "baja" (read no vuelve a delivered).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_notification_delivery(
  p_outbox_id uuid,
  p_event     text,
  p_detail    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF p_event NOT IN ('delivered', 'read', 'bounced') THEN
    RAISE EXCEPTION 'evento de entrega invalido: %', p_event;
  END IF;

  SELECT status INTO v_status
  FROM public.notifications_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF v_status IS NULL OR v_status NOT IN ('sent', 'delivered', 'read') THEN
    RETURN;  -- inexistente o aún no entregada al proveedor: no-op
  END IF;

  IF p_event = 'delivered' THEN
    UPDATE public.notifications_outbox
    SET delivered_at = COALESCE(delivered_at, now()),
        -- no degradar 'read' a 'delivered'
        status = CASE WHEN status = 'read' THEN 'read' ELSE 'delivered' END,
        updated_at = now()
    WHERE id = p_outbox_id;
  ELSIF p_event = 'read' THEN
    UPDATE public.notifications_outbox
    SET read_at = COALESCE(read_at, now()),
        -- una apertura implica entrega
        delivered_at = COALESCE(delivered_at, now()),
        status = 'read',
        updated_at = now()
    WHERE id = p_outbox_id;
  ELSE  -- bounced
    UPDATE public.notifications_outbox
    SET bounced_at = COALESCE(bounced_at, now()),
        bounce_reason = COALESCE(NULLIF(p_detail->>'reason', ''), bounce_reason),
        status = 'bounced',
        updated_at = now()
    WHERE id = p_outbox_id;
  END IF;

  INSERT INTO public.notification_events (outbox_id, event_type, detail)
  VALUES (p_outbox_id, p_event, COALESCE(p_detail, '{}'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notification_delivery(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_delivery(uuid, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.mark_notification_delivery IS
  'Transición post-envío del outbox: delivered/read/bounced + evento append-only. Solo desde sent/delivered/read (no resucita fallidas). Idempotente. Solo service_role (track-email-open, futuro receptor de bounces).';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RPC mark_email_open — apertura de un envío directo de send-email.
--    El píxel embebe tracking_id (uuid efímero firmado), no el id del log.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_email_open(p_tracking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.email_send_log
  SET opened_at = COALESCE(opened_at, now())
  WHERE tracking_id = p_tracking_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_email_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_email_open(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_email_open IS
  'Marca opened_at (primera apertura) de un envío de send-email por su tracking_id. Idempotente. Solo service_role (track-email-open).';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Lectura in_app → outbox: cuando el destinatario marca leída su campana
--    (user_notifications.leido false→true), propagar read a la fila del outbox
--    que la creó (provider_message_id = user_notifications.id). SECURITY
--    DEFINER: authenticated no tiene UPDATE sobre el outbox (deny-write) y no
--    debe tenerlo; el trigger corre con los privilegios del owner.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_outbox_read_from_user_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_outbox_id uuid;
BEGIN
  UPDATE public.notifications_outbox
  SET read_at = COALESCE(read_at, COALESCE(NEW.leido_at, now())),
      delivered_at = COALESCE(delivered_at, COALESCE(NEW.leido_at, now())),
      status = 'read',
      updated_at = now()
  WHERE channel = 'in_app'
    AND provider_message_id = NEW.id::text
    AND status IN ('sent', 'delivered')
  RETURNING id INTO v_outbox_id;

  IF v_outbox_id IS NOT NULL THEN
    INSERT INTO public.notification_events (outbox_id, event_type, detail)
    VALUES (v_outbox_id, 'read', jsonb_build_object('via', 'in_app_leido'));
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_outbox_read_from_user_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_user_notifications_read_sync ON public.user_notifications;
CREATE TRIGGER trg_user_notifications_read_sync
  AFTER UPDATE OF leido ON public.user_notifications
  FOR EACH ROW
  WHEN (NEW.leido AND NOT OLD.leido)
  EXECUTE FUNCTION public.sync_outbox_read_from_user_notification();

COMMENT ON FUNCTION public.sync_outbox_read_from_user_notification IS
  'Propaga la lectura de la campana (user_notifications.leido) al outbox correlacionado por provider_message_id. Dispara solo en la transición false→true.';
