-- ============================================================
-- Notificaciones in-app por usuario (campana)
-- ============================================================
-- Feed persistente de notificaciones dirigidas a un usuario concreto. Hoy la app
-- solo tiene toasts (Sonner) que no persisten. Las filas las crea el service role
-- (edge function de recordatorios); el usuario solo puede leer y marcar como
-- leídas las suyas.

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- destinatario
  company_id    uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo          text NOT NULL DEFAULT 'ruta_recordatorio',
  titulo        text NOT NULL,
  cuerpo        text,
  seccion       text,            -- destino de navegación, p.ej. 'rutas'
  ruta_id       uuid REFERENCES public.rutas(id) ON DELETE CASCADE,
  ocurrencia_id uuid REFERENCES public.ruta_ocurrencias(id) ON DELETE CASCADE,
  leido         boolean NOT NULL DEFAULT false,
  leido_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- El usuario solo ve y actualiza (marcar leído) sus propias filas. No hay política
-- de INSERT para 'authenticated': así nadie puede fabricar notificaciones; las
-- inserta el service role (que omite RLS).
DROP POLICY IF EXISTS "un_select_own" ON public.user_notifications;
CREATE POLICY "un_select_own" ON public.user_notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "un_update_own" ON public.user_notifications;
CREATE POLICY "un_update_own" ON public.user_notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE INDEX IF NOT EXISTS idx_un_user_unread
  ON public.user_notifications(user_id, created_at DESC) WHERE leido = false;
CREATE INDEX IF NOT EXISTS idx_un_user_all
  ON public.user_notifications(user_id, created_at DESC);

-- Realtime para que la campana se actualice en vivo (ignora error si ya existe).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
