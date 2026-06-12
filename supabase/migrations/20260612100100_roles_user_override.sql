-- ─── Rol de ajustes individuales por usuario ─────────────────────────────────
-- "Ajustes finos": el panel de permisos efectivos del modal de roles permite
-- conceder (allow) o bloquear (deny) permisos puntuales a UN usuario sin crear
-- un rol reutilizable. Se persisten en un rol oculto auto-gestionado, marcado
-- con esta columna y asignado vía user_roles (sin expiración). La aplicación
-- server-side ya existe: get_user_permissions / user_has_permission restan los
-- deny de los allow (migración 20260518000008). Sin cambios de RLS: las
-- políticas existentes ya autorizan a company_owner/admin sobre roles
-- no-system de su empresa.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS user_override_for uuid
  REFERENCES public.app_users(id) ON DELETE CASCADE;

-- Un solo rol de ajustes por usuario; habilita get-or-create lazy seguro
-- (una segunda creación concurrente falla en vez de duplicar en silencio).
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_user_override
  ON public.roles(user_override_for)
  WHERE user_override_for IS NOT NULL;

-- Los roles de ajustes son siempre roles de empresa (nunca de sistema).
DO $$ BEGIN
  ALTER TABLE public.roles ADD CONSTRAINT roles_override_not_system_chk
    CHECK (user_override_for IS NULL OR is_system = false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
