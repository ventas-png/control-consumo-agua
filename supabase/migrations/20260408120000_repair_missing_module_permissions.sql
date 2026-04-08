-- ============================================================
-- Repair: poblar permisos de módulos faltantes para usuarios
-- existentes, incluyendo 'comunicacion' añadido después.
--
-- Este script es idempotente (ON CONFLICT DO NOTHING).
-- Cubre dos casos:
--   1. Usuarios con permisos parciales (les falta 'comunicacion')
--   2. Usuarios sin ningún permiso configurado (se crean desde cero)
-- ============================================================

-- 1. Agregar 'comunicacion' a usuarios que ya tienen otros permisos
--    pero no tienen la entrada de comunicacion
INSERT INTO public.user_module_permissions
  (user_id, module_key, can_view, can_create, can_edit, can_change_status)
SELECT
  u.id,
  'comunicacion',
  true,
  CASE WHEN u.role IN ('admin', 'collector') THEN true ELSE false END,
  true,
  false
FROM public.app_users u
WHERE u.role NOT IN ('super_admin', 'superadmin', 'company_owner', 'cliente')
  AND EXISTS (
    SELECT 1 FROM public.user_module_permissions ump
    WHERE ump.user_id = u.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.user_module_permissions ump
    WHERE ump.user_id = u.id AND ump.module_key = 'comunicacion'
  )
ON CONFLICT (user_id, module_key) DO NOTHING;

-- 2. Poblar permisos completos para usuarios que no tienen ninguno
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, role
    FROM public.app_users
    WHERE role NOT IN ('super_admin', 'superadmin', 'company_owner', 'cliente')
      AND NOT EXISTS (
        SELECT 1 FROM public.user_module_permissions WHERE user_id = id
      )
  LOOP
    PERFORM populate_default_module_permissions(r.id, r.role);
  END LOOP;
END;
$$;
