-- ============================================================================
-- notification_events — audit trail del ciclo de vida de cada notificación (T2)
-- ============================================================================
-- Épica #301 · banda de migración T2 (2026-06-06): 20260606120000.
--
-- notifications_outbox guarda el ESTADO ACTUAL de cada notificación (queued →
-- sending → sent/failed/suppressed…), pero se sobrescribe en cada transición: no
-- queda historia. Para entrega/bounce necesitamos un rastro APPEND-ONLY: cada
-- transición relevante deja un evento inmutable. El dispatcher inserta 'sent' /
-- 'failed' / 'suppressed'; 'delivered' / 'bounced' los registrará un webhook del
-- proveedor cuando exista (ver TODO abajo).
--
-- Por qué tabla separada y no columnas en el outbox: un envío puede reintentarse
-- N veces (varios 'failed') y luego confirmarse ('delivered') o rebotar
-- ('bounced'); eso es una serie temporal, no un único estado. Append-only encaja.
--
-- RLS: DENY-ALL para anon/authenticated (sin políticas que les den acceso) +
-- política explícita service_role. El dispatcher/webhook escriben con service_role
-- (bypass de RLS). La lectura para el destinatario authenticated (read-receipts de
-- in_app) es un follow-up explícito — NO en este PR.
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS antes de
-- CREATE POLICY.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fila del outbox a la que pertenece el evento. ON DELETE CASCADE: si se purga
  -- el outbox, su historia se va con él.
  outbox_id  uuid NOT NULL REFERENCES public.notifications_outbox(id) ON DELETE CASCADE,
  -- Tipo de transición. Mismo dominio que notifications_outbox.status (menos los
  -- estados de trabajo 'sending'/'read'): cubre el ciclo de vida de entrega.
  event_type text NOT NULL
               CHECK (event_type IN ('queued', 'sent', 'delivered', 'bounced', 'failed', 'suppressed')),
  -- Contexto estructurado del evento: canal, razón de supresión, error del
  -- proveedor, intento, terminal/retriable, payload del webhook, etc.
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_events IS
  'Audit trail append-only del ciclo de vida de notifications_outbox (T2). El dispatcher inserta sent/failed/suppressed; delivered/bounced los registra un webhook del proveedor (follow-up). RLS deny-all (solo service_role escribe/lee); read-receipts in_app para el destinatario authenticated es follow-up.';

-- Lookup de la historia de una fila del outbox, más reciente primero.
CREATE INDEX IF NOT EXISTS idx_notif_events_outbox
  ON public.notification_events(outbox_id, created_at DESC);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

-- DENY-ALL: con RLS habilitado y SIN política permisiva para anon/authenticated,
-- esos roles no ven ni escriben nada. Solo declaramos la política de service_role
-- (que igual bypassa RLS) para dejar la intención explícita, como notifications_outbox.
DROP POLICY IF EXISTS "notif_events_service_role" ON public.notification_events;
CREATE POLICY "notif_events_service_role" ON public.notification_events
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- TODO (follow-up, fuera de este PR):
--   * notifications-webhook (edge): recibe callbacks de entrega/bounce del
--     proveedor de email, VERIFICA la firma del proveedor (secreto en tabla
--     deny-all service-role-only, nunca al cliente) y registra 'delivered' /
--     'bounced' como service_role. Gmail API (proveedor actual del dispatcher) NO
--     emite webhooks de entrega/bounce de salida → no hay endpoint que construir
--     hoy; queda documentado para cuando se adopte un proveedor que los soporte
--     (SendGrid/Resend/SES, vía SNS/eventos firmados).
--   * read-receipts de in_app: exponer (RLS) los eventos al destinatario
--     authenticated para marcar leído desde la campana.
-- ────────────────────────────────────────────────────────────────────────────
