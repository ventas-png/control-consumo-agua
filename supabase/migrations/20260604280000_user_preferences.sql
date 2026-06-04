-- ============================================================================
-- Preferencias regionales por usuario (T3 Plataforma · plat:P18)
-- ============================================================================
-- Banda de migración P18: 20260604280000.
--
-- Hoy las fechas/horas se formatean con 'es' fijo y en UTC, y la moneda vive por
-- proyecto. Esta tabla guarda las preferencias REGIONALES del usuario —idioma,
-- zona horaria y moneda de visualización— para que cada quien vea los datos en su
-- formato local (clave en multi-tenant GT/MX). La adopción app-wide del formateo
-- es incremental (igual que los lotes de i18n/DataTable); este PR aterriza el
-- almacenamiento + el helper de formateo + la UI de Perfil con vista previa.
--
-- Sin RPC ni SECURITY DEFINER: es la fila propia del usuario, así que basta RLS
-- acotada a auth.uid() (SELECT/INSERT/UPDATE). Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Idioma de la interfaz / formateo (es | en por ahora).
  locale     text NOT NULL DEFAULT 'es'  CHECK (locale IN ('es', 'en')),
  -- Zona horaria IANA para mostrar timestamps (texto libre: la UI ofrece la lista).
  timezone   text NOT NULL DEFAULT 'America/Guatemala',
  -- Moneda de visualización (ISO 4217). GT/MX + USD.
  currency   text NOT NULL DEFAULT 'GTQ' CHECK (currency IN ('GTQ', 'MXN', 'USD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_preferences IS
  'plat:P18 — preferencias regionales del usuario (locale, timezone, currency) para formateo local. Fila propia: RLS acotada a auth.uid().';

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- El usuario gestiona EXCLUSIVAMENTE su propia fila.
DROP POLICY IF EXISTS "user_prefs_select" ON public.user_preferences;
CREATE POLICY "user_prefs_select" ON public.user_preferences
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_prefs_insert" ON public.user_preferences;
CREATE POLICY "user_prefs_insert" ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_prefs_update" ON public.user_preferences;
CREATE POLICY "user_prefs_update" ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Mantener updated_at al día en cada UPDATE (trigger ya existente en el proyecto
-- para otras tablas; aquí lo declaramos de forma idempotente y autocontenida).
CREATE OR REPLACE FUNCTION public.touch_user_preferences_updated_at()
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

-- Revocar EXECUTE directo (no rompe el trigger; mismo criterio que
-- 20260521000001_security_harden_trigger_functions).
REVOKE EXECUTE ON FUNCTION public.touch_user_preferences_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_user_preferences_updated_at() TO service_role;

DROP TRIGGER IF EXISTS user_preferences_touch ON public.user_preferences;
CREATE TRIGGER user_preferences_touch
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_user_preferences_updated_at();
