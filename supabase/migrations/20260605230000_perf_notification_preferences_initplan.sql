-- Perf (advisor 0003 auth_rls_initplan) — envuelve auth.uid() en (select auth.uid())
-- en las 4 políticas RLS de usuario de public.notification_preferences.
--
-- Causa: la migración 20260605180000_notification_preferences.sql creó las
-- políticas SELECT/INSERT/UPDATE/DELETE con `user_id = auth.uid()` directo.
-- Postgres reevalúa auth.uid() POR FILA, lo que dispara el advisor 0003
-- (auth_rls_initplan) y degrada el escaneo cuando la tabla crece. Envolverlo en
-- un subselect `(select auth.uid())` hace que el planner lo evalúe UNA vez
-- (initplan) en lugar de por fila.
--
-- Sin cambio funcional: misma condición de pertenencia por usuario; solo mejora
-- el plan de ejecución. La política `notif_prefs_service_role` usa `true`
-- (no auth.uid()) y NO entra en este advisor: se deja intacta.
--
-- Idempotente: DROP POLICY IF EXISTS → CREATE POLICY. Ya aplicada a prod vía
-- Management API; este archivo deja repo y esquema en sync (lección anti-drift).

DROP POLICY IF EXISTS "notif_prefs_select" ON public.notification_preferences;
CREATE POLICY "notif_prefs_select" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notif_prefs_insert" ON public.notification_preferences;
CREATE POLICY "notif_prefs_insert" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notif_prefs_update" ON public.notification_preferences;
CREATE POLICY "notif_prefs_update" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "notif_prefs_delete" ON public.notification_preferences;
CREATE POLICY "notif_prefs_delete" ON public.notification_preferences
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));
