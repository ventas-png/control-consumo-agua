-- ============================================================
-- Repair: poblar permisos de módulos faltantes para usuarios
-- existentes, incluyendo 'comunicacion' añadido después.
--
-- Este script es idempotente (ON CONFLICT DO NOTHING).
-- Cubre dos casos:
--   1. Usuarios con permisos parciales (les falta 'comunicacion')
--   2. Usuarios sin ningún permiso configurado (se crean desde cero)
--
-- Usa INSERT bulk en lugar de loop para evitar timeouts.
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

-- 2. Poblar permisos completos para usuarios sin ningún permiso.
--    Usa un CTE con todos los defaults por rol (sin loop = sin timeout).
WITH role_defaults (role, module_key, can_view, can_create, can_edit, can_change_status) AS (
  VALUES
  -- operator
  ('operator',  'clientes',     true, true,  true,  true ),
  ('operator',  'lecturas',     true, true,  false, false),
  ('operator',  'tabla',        true, false, false, false),
  ('operator',  'dashboard',    true, false, false, false),
  ('operator',  'mapa',         true, false, false, false),
  ('operator',  'calidad',      true, true,  true,  false),
  ('operator',  'rutas',        true, false, true,  false),
  ('operator',  'contadores',   true, false, true,  false),
  ('operator',  'comunicacion', true, false, true,  false),
  -- operador (alias en DB)
  ('operador',  'clientes',     true, true,  true,  true ),
  ('operador',  'lecturas',     true, true,  false, false),
  ('operador',  'tabla',        true, false, false, false),
  ('operador',  'dashboard',    true, false, false, false),
  ('operador',  'mapa',         true, false, false, false),
  ('operador',  'calidad',      true, true,  true,  false),
  ('operador',  'rutas',        true, false, true,  false),
  ('operador',  'contadores',   true, false, true,  false),
  ('operador',  'comunicacion', true, false, true,  false),
  -- admin
  ('admin', 'clientes',      true, true,  true,  true ),
  ('admin', 'lecturas',      true, true,  false, false),
  ('admin', 'tabla',         true, false, true,  true ),
  ('admin', 'dashboard',     true, false, false, false),
  ('admin', 'cobros',        true, true,  true,  true ),
  ('admin', 'mapa',          true, false, false, false),
  ('admin', 'calidad',       true, true,  true,  false),
  ('admin', 'rutas',         true, true,  true,  false),
  ('admin', 'tarifas',       true, true,  true,  false),
  ('admin', 'unidades',      true, true,  true,  false),
  ('admin', 'contadores',    true, true,  true,  false),
  ('admin', 'configuracion', true, false, true,  false),
  ('admin', 'comunicacion',  true, true,  true,  false),
  -- user (alias legacy para operator)
  ('user',  'clientes',     true, true,  true,  true ),
  ('user',  'lecturas',     true, true,  false, false),
  ('user',  'tabla',        true, false, false, false),
  ('user',  'dashboard',    true, false, false, false),
  ('user',  'mapa',         true, false, false, false),
  ('user',  'calidad',      true, true,  true,  false),
  ('user',  'rutas',        true, false, true,  false),
  ('user',  'contadores',   true, false, true,  false),
  ('user',  'comunicacion', true, false, true,  false),
  -- viewer / visor
  ('viewer', 'tabla',     true, false, false, false),
  ('viewer', 'dashboard', true, false, false, false),
  ('viewer', 'mapa',      true, false, false, false),
  ('visor',  'tabla',     true, false, false, false),
  ('visor',  'dashboard', true, false, false, false),
  ('visor',  'mapa',      true, false, false, false),
  -- collector
  ('collector', 'cobros',       true, true, true, true ),
  ('collector', 'comunicacion', true, true, true, false)
)
INSERT INTO public.user_module_permissions
  (user_id, module_key, can_view, can_create, can_edit, can_change_status)
SELECT
  u.id,
  d.module_key,
  d.can_view,
  d.can_create,
  d.can_edit,
  d.can_change_status
FROM public.app_users u
JOIN role_defaults d ON d.role = u.role
WHERE u.role NOT IN ('super_admin', 'superadmin', 'company_owner', 'cliente')
  AND NOT EXISTS (
    SELECT 1 FROM public.user_module_permissions WHERE user_id = u.id
  )
ON CONFLICT (user_id, module_key) DO NOTHING;
