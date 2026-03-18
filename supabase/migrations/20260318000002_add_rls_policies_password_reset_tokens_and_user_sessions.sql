-- ============================================================
-- password_reset_tokens
-- Usuarios solo pueden ver sus propios tokens (por user_id).
-- INSERT/UPDATE/DELETE solo vía funciones SECURITY DEFINER.
-- ============================================================
CREATE POLICY "Users can view their own reset tokens"
  ON public.password_reset_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================
-- user_sessions
-- Tabla de sesiones de servidor sin relación a auth.uid().
-- Ningún rol externo debe acceder directamente.
-- ============================================================
CREATE POLICY "No direct access to user_sessions"
  ON public.user_sessions
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);
