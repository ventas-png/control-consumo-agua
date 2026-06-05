-- ============================================================================
-- Preferencias de canal de notificación por usuario (T2 Comunicación · com:N9/N10)
-- ============================================================================
-- Épica #301 · banda de migración T2 (HOY): 20260605180000.
--
-- El orquestador (#378, notifications_outbox + notifications-dispatcher) ya
-- despacha por canal (in_app / email / whatsapp / push), pero hoy NO consulta
-- ninguna preferencia del destinatario: si un productor encola un email, se
-- envía aunque el usuario prefiera solo la campana in-app. Esta tabla guarda,
-- por usuario y canal, si ese canal está habilitado para él.
--
-- Modelo OPT-OUT: la AUSENCIA de fila = canal habilitado (default sano para no
-- romper entregas existentes al aterrizar la tabla). El usuario solo persiste
-- filas cuando ajusta sus toggles; deshabilitar un canal inserta enabled=false.
--
-- Alcance de este PR (com:N9/N10): el MODELO + la UI para que el usuario gestione
-- sus canales. Que el dispatcher RESPETE estas preferencias es un follow-up de
-- coordinación con la Sesión A (territorio del dispatcher). Para dejarlo listo,
-- exponemos el helper `notification_channel_enabled(user_id, channel)` que ese
-- follow-up puede consultar desde el dispatcher (service_role).
--
-- Sin acoplar 'push' todavía: la UI de hoy gestiona in_app/email/whatsapp; el
-- CHECK admite los mismos canales que notifications_outbox para no divergir.
--
-- RLS: fila propia del usuario (user_id = auth.uid()) para SELECT/INSERT/UPDATE/
-- DELETE — mismo patrón que user_preferences (plat:P18). company_id se guarda
-- como scope de tenant (analítica/segmentación futura), nullable y ON DELETE
-- SET NULL para no perder la preferencia si se recrea el vínculo de empresa.
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, DROP POLICY IF EXISTS antes de
-- CREATE POLICY, CREATE OR REPLACE en funciones.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id    uuid    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Canal de entrega. Mismo dominio que notifications_outbox.channel salvo
  -- 'push' (aún no gestionado por la UI; se admite para no divergir el CHECK).
  channel    text    NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'push')),
  enabled    boolean NOT NULL DEFAULT true,
  -- Scope tenant (analítica / segmentación). Nullable: la preferencia es del
  -- usuario, no de la empresa, pero guardarlo ayuda al follow-up del dispatcher.
  company_id uuid    REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);

COMMENT ON TABLE public.notification_preferences IS
  'com:N9/N10 — preferencias de canal por usuario (in_app/email/whatsapp/push). Modelo opt-out: ausencia de fila = habilitado. RLS acotada a auth.uid(). El dispatcher las respetará en un follow-up (helper notification_channel_enabled).';

-- Lookup por usuario para el dispatcher/UI. La PK ya cubre (user_id, channel);
-- este índice parcial acelera "qué canales desactivó este usuario".
CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_disabled
  ON public.notification_preferences(user_id)
  WHERE enabled = false;

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- El usuario gestiona EXCLUSIVAMENTE sus propias filas.
DROP POLICY IF EXISTS "notif_prefs_select" ON public.notification_preferences;
CREATE POLICY "notif_prefs_select" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_prefs_insert" ON public.notification_preferences;
CREATE POLICY "notif_prefs_insert" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_prefs_update" ON public.notification_preferences;
CREATE POLICY "notif_prefs_update" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notif_prefs_delete" ON public.notification_preferences;
CREATE POLICY "notif_prefs_delete" ON public.notification_preferences
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Política explícita para service_role (dispatcher / productores). Redundante
-- con el bypass de RLS de service_role, pero declara la intención igual que
-- notifications_outbox.
DROP POLICY IF EXISTS "notif_prefs_service_role" ON public.notification_preferences;
CREATE POLICY "notif_prefs_service_role" ON public.notification_preferences
  TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────────
-- updated_at touch trigger (mismo patrón que user_preferences/P18).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_notification_preferences_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_notification_preferences_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_notification_preferences_updated_at() TO service_role;

DROP TRIGGER IF EXISTS notification_preferences_touch ON public.notification_preferences;
CREATE TRIGGER notification_preferences_touch
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_notification_preferences_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- Helper para el follow-up del dispatcher: ¿está habilitado este canal para
-- este usuario? Modelo opt-out → true si no hay fila. SECURITY DEFINER para que
-- el dispatcher (service_role) lo consulte sin depender de RLS; acota la lectura
-- a la fila (user_id, channel) que se le pasa. No expone datos del usuario.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notification_channel_enabled(
  p_user_id uuid,
  p_channel text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT enabled
       FROM public.notification_preferences
      WHERE user_id = p_user_id AND channel = p_channel),
    true  -- opt-out: sin fila = habilitado
  );
$$;

-- Solo el dispatcher/productores (service_role). REVOKE por nombre de rol
-- (revocar solo PUBLIC NO basta en Supabase — anon/authenticated reciben EXECUTE
-- por default privileges; lección de #378/#380).
REVOKE EXECUTE ON FUNCTION public.notification_channel_enabled(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_channel_enabled(uuid, text) TO service_role;

COMMENT ON FUNCTION public.notification_channel_enabled IS
  'com:N9 — ¿canal habilitado para el usuario? Modelo opt-out (sin fila = true). Solo service_role: lo consulta el dispatcher en el follow-up que respeta preferencias.';
