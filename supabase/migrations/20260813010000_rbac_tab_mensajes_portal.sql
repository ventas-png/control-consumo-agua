-- Catálogo RBAC del tab nuevo "Mensajes Portal" (bandeja de la administración
-- para `mensajes_portal`).
--
-- Contexto: los mensajes que el residente envía desde su portal ya se guardaban
-- bien, pero del lado admin solo los leía la vista previa del portal (tab
-- `portal`), que exige elegir la unidad de antemano — un mensaje nuevo no
-- aparecía en ninguna bandeja. El tab `mensajes_portal` los lista por proyecto;
-- para que lo vea alguien que NO es rol exento (super_admin / company_owner /
-- admin) hace falta la clave en el catálogo, porque hasPermission() exige la
-- fila explícita.
--
-- Idempotente (ON CONFLICT DO NOTHING); no toca datos de negocio.

-- 1. Clave de visibilidad (3 segmentos = "Ver", convención de 20260518000005).
INSERT INTO public.permissions (key, category, label, description) VALUES
  ('condominios.tab.mensajes_portal', 'residentes', 'Mensajes portal', 'Mensajes de residentes desde el portal')
ON CONFLICT (key) DO NOTHING;

-- 2. Acciones del tab (misma derivación que la parte 3 de 20260703000000).
INSERT INTO public.permissions (key, category, label, description)
SELECT
  p.key || '.' || a.akey,
  p.category,
  a.alabel || ' — ' || p.label,
  a.alabel || ' en ' || p.label
FROM public.permissions p
CROSS JOIN (VALUES
  ('create',        'Crear'),
  ('edit',          'Editar'),
  ('change_status', 'Cambiar estado'),
  ('approve',       'Autorizar / Denegar'),
  ('delete',        'Eliminar')
) AS a(akey, alabel)
WHERE p.key = 'condominios.tab.mensajes_portal'
ON CONFLICT (key) DO NOTHING;

-- 3. Administrador General (condominios): acceso completo, como en la parte 4
--    de 20260703000000.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, p.key, 'allow'
FROM public.permissions p
WHERE p.key LIKE 'condominios.tab.mensajes_portal%'
ON CONFLICT DO NOTHING;

-- 4. Compatibilidad: quien ya administra el portal del residente es la misma
--    persona que debe recibir sus mensajes. Se copian los grants existentes de
--    `condominios.tab.portal` (visibilidad y cada acción, respetando el effect
--    allow/deny tal cual) al tab nuevo, para que un rol personalizado que hoy
--    atiende el portal no estrene la bandeja vacía de permisos. Después cada
--    empresa puede ajustarlo por rol desde el editor.
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT rp.role_id, p.key, rp.effect
FROM public.role_permissions rp
JOIN public.permissions p
  ON p.key = replace(rp.permission_key, 'condominios.tab.portal', 'condominios.tab.mensajes_portal')
WHERE rp.permission_key = 'condominios.tab.portal'
   OR rp.permission_key LIKE 'condominios.tab.portal.%'
ON CONFLICT DO NOTHING;
