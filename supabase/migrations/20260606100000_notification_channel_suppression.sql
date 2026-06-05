-- ============================================================================
-- Supresión por preferencia de canal (T2 Comunicación · com:N9/N10 follow-up)
-- ============================================================================
-- Épica #301 · banda de migración T2 (2026-06-06): 20260606100000.
--
-- El orquestador (#378: notifications_outbox + notifications-dispatcher) ya
-- despacha por canal y la migración 20260605180000 aterrizó las preferencias del
-- usuario (notification_preferences) + el helper `notification_channel_enabled`.
-- Lo que faltaba (este PR): que el dispatcher RESPETE esas preferencias.
--
-- Cuando el dispatcher (service_role) detecta que el destinatario desactivó el
-- canal de una fila, NO la despacha ni la marca 'failed' (no es un error de
-- envío): la marca 'suppressed' con la razón 'channel_disabled' y NO la reintenta.
-- 'in_app' nunca se suprime (la campana siempre recibe) — eso lo garantiza el
-- helper puro `resolvePreferenceUserId` (devuelve null para in_app).
--
-- Modelo OPT-OUT (ya en notification_preferences): ausencia de fila = habilitado.
--
-- Este PR agrega:
--   1. El estado 'suppressed' al CHECK de notifications_outbox.status.
--   2. La columna suppressed_at (sello de la transición, simétrico a sent_at).
--   3. El RPC mark_notification_suppressed(p_id, p_reason) que el dispatcher usa
--      en vez de mark_notification_result para esta transición terminal-no-error.
--
-- Idempotente: DROP/ADD CONSTRAINT IF EXISTS, ADD COLUMN IF NOT EXISTS, CREATE OR
-- REPLACE en la función. SEGURIDAD: REVOKE EXECUTE FROM PUBLIC, anon, authenticated
-- POR NOMBRE + GRANT service_role (revocar solo PUBLIC NO basta — lección #378/#380).
-- ============================================================================

-- 1) Estado 'suppressed' en el CHECK de status. El CHECK inline original es
--    anónimo → Postgres lo nombró notifications_outbox_status_check. Lo tiramos y
--    recreamos con el nuevo valor (idempotente).
ALTER TABLE public.notifications_outbox
  DROP CONSTRAINT IF EXISTS notifications_outbox_status_check;
ALTER TABLE public.notifications_outbox
  ADD CONSTRAINT notifications_outbox_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'bounced', 'suppressed'));

-- 2) Sello de la transición a 'suppressed' (auditoría/observabilidad, simétrico a
--    sent_at/delivered_at/read_at).
ALTER TABLE public.notifications_outbox
  ADD COLUMN IF NOT EXISTS suppressed_at timestamptz;

-- ────────────────────────────────────────────────────────────────────────────
-- RPC mark_notification_suppressed: el dispatcher reporta que una fila NO se
-- despachó porque el destinatario desactivó el canal. Transición TERMINAL pero
-- NO de error: status='suppressed', suppressed_at=now(), la razón en last_error
-- (texto libre; el detalle estructurado va en notification_events). No reintenta.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_notification_suppressed(
  p_id     uuid,
  p_reason text DEFAULT 'channel_disabled'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.notifications_outbox
  SET status       = 'suppressed',
      suppressed_at = now(),
      last_error    = p_reason,
      updated_at    = now()
  WHERE id = p_id
    -- Solo desde el estado de trabajo: el dispatcher acaba de hacer el claim
    -- ('sending'). Evita pisar una fila ya entregada/fallida por una corrida tardía.
    AND status IN ('sending', 'queued');
END;
$$;

-- Solo el dispatcher/productores (service_role). REVOKE por nombre de rol
-- (revocar solo PUBLIC NO basta en Supabase — anon/authenticated reciben EXECUTE
-- por default privileges; lección de #378/#380).
REVOKE EXECUTE ON FUNCTION public.mark_notification_suppressed(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_suppressed(uuid, text) TO service_role;

COMMENT ON FUNCTION public.mark_notification_suppressed IS
  'com:N9 — marca una fila del outbox como suppressed (canal desactivado por el usuario). Transición terminal NO-error: no reintenta. Solo service_role (lo llama el dispatcher).';
