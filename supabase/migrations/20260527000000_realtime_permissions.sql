-- ============================================================================
-- Realtime de permisos (plat:P7, F2.5)
-- ============================================================================
-- Habilitar Realtime para las tablas RBAC para que el cliente pueda
-- suscribirse a cambios de roles/permisos del usuario actual y refrescar la
-- sesion sin necesidad de logout/login.
--
-- Tablas que se agregan a `supabase_realtime`:
--   - user_roles      → admin asigna/revoca rol al usuario
--   - app_users       → cambio de role legacy, company_id, activo
--   - role_permissions → admin modifica el set de permisos de un rol
--
-- RLS sigue aplicando: el cliente solo recibe eventos de filas que pasan la
-- policy SELECT correspondiente (user_roles.user_id = auth.uid() para el
-- residente comun, app_users.id = auth.uid() para self).
--
-- Idempotencia: DO block con WHEN duplicate_object NULL replicando el patron
-- usado en 20260522000003_create_user_notifications.sql.
-- ============================================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.role_permissions;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
