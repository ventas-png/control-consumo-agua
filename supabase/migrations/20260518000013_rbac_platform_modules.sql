-- ─── Phase D: Platform modules into RBAC ───────────────────────────────────
-- Adds platform-level module permissions (clientes, unidades, configuracion,
-- comunicacion, condominios) and 4 platform system roles that match the
-- existing app_users.role values: admin / operator / viewer / collector.
--
-- After this migration, every UI permission check that previously went
-- through user_module_permissions can be served from user_roles + RBAC
-- permissions. The next migration (000015) drops the legacy columns and
-- the user_module_permissions table.

-- 1. Seed 20 platform permissions (5 modules × 4 actions)
DO $$
DECLARE
  modules text[][] := ARRAY[
    ['clientes',      'Clientes'],
    ['unidades',      'Unidades'],
    ['configuracion', 'Configuración'],
    ['comunicacion',  'Comunicación'],
    ['condominios',   'Condominios (acceso general)']
  ];
  actions text[][] := ARRAY[
    ['view',          'Ver'],
    ['create',        'Crear'],
    ['edit',          'Editar'],
    ['change_status', 'Cambiar estado']
  ];
  i int; j int;
  mod_key text; mod_label text;
  act_key text; act_label text;
BEGIN
  FOR i IN 1..array_length(modules, 1) LOOP
    mod_key   := modules[i][1];
    mod_label := modules[i][2];
    FOR j IN 1..array_length(actions, 1) LOOP
      act_key   := actions[j][1];
      act_label := actions[j][2];
      INSERT INTO public.permissions (key, category, label, description) VALUES (
        'platform.' || mod_key || '.' || act_key,
        'platform_' || mod_key,
        act_label || ' — ' || mod_label,
        act_label || ' en el módulo ' || mod_label
      )
      ON CONFLICT (key) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 2. Seed 4 platform system roles
INSERT INTO public.roles (id, company_id, name, description, is_system, color, service) VALUES
  ('00000000-0000-0000-0000-000000000201', NULL, 'Admin Plataforma',       'Administrador platform: acceso completo a todos los módulos platform', true, '#0ea5e9', 'general'),
  ('00000000-0000-0000-0000-000000000202', NULL, 'Operador Plataforma',    'Operador platform: lecturas, actualizaciones y comunicación', true, '#10b981', 'general'),
  ('00000000-0000-0000-0000-000000000203', NULL, 'Visualizador Plataforma','Solo lectura de dashboards y reportes', true, '#8b5cf6', 'general'),
  ('00000000-0000-0000-0000-000000000204', NULL, 'Cobrador Plataforma',    'Acceso enfocado a cobros y comunicación', true, '#f59e0b', 'general')
ON CONFLICT (company_id, name) DO NOTHING;

-- 3. Map platform roles -> permissions (mirrors ROLE_DEFAULT_TEMPLATES in moduleConfig.ts)
DO $$
DECLARE
  rid_admin     uuid := '00000000-0000-0000-0000-000000000201';
  rid_operator  uuid := '00000000-0000-0000-0000-000000000202';
  rid_viewer    uuid := '00000000-0000-0000-0000-000000000203';
  rid_collector uuid := '00000000-0000-0000-0000-000000000204';
BEGIN
  -- Admin platform: covers all platform.* + all agua.* permissions.
  -- Does NOT include condominios.tab.* — those must be granted separately
  -- via a condominios system role (e.g. administrador_general) or a custom
  -- role. This matches the legacy admin defaults (no condominios access by
  -- default for the platform admin tier).
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'platform.%'
  ON CONFLICT DO NOTHING;
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'agua.%'
  ON CONFLICT DO NOTHING;

  -- Operator platform: matches ROLE_DEFAULT_TEMPLATES.operator
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rid_operator, 'platform.clientes.view',          'allow'),
    (rid_operator, 'platform.clientes.create',        'allow'),
    (rid_operator, 'platform.clientes.edit',          'allow'),
    (rid_operator, 'platform.clientes.change_status', 'allow'),
    (rid_operator, 'platform.unidades.view',          'allow'),
    (rid_operator, 'platform.comunicacion.view',      'allow'),
    (rid_operator, 'platform.comunicacion.edit',      'allow'),
    (rid_operator, 'platform.condominios.view',       'allow'),
    (rid_operator, 'platform.condominios.edit',       'allow'),
    -- Agua (matches AGUA_ROLE_PERMISSIONS.operator: view/create/edit, no change_status)
    (rid_operator, 'agua.lecturas.view',   'allow'),
    (rid_operator, 'agua.lecturas.create', 'allow'),
    (rid_operator, 'agua.lecturas.edit',   'allow'),
    (rid_operator, 'agua.tabla.view',      'allow'),
    (rid_operator, 'agua.dashboard.view',  'allow'),
    (rid_operator, 'agua.mapa.view',       'allow'),
    (rid_operator, 'agua.calidad.view',    'allow'),
    (rid_operator, 'agua.calidad.create',  'allow'),
    (rid_operator, 'agua.calidad.edit',    'allow'),
    (rid_operator, 'agua.rutas.view',      'allow'),
    (rid_operator, 'agua.rutas.edit',      'allow'),
    (rid_operator, 'agua.contadores.view', 'allow'),
    (rid_operator, 'agua.contadores.edit', 'allow'),
    (rid_operator, 'agua.servicios_energia.view',   'allow'),
    (rid_operator, 'agua.servicios_energia.create', 'allow'),
    (rid_operator, 'agua.servicios_energia.edit',   'allow')
  ON CONFLICT DO NOTHING;

  -- Viewer platform: read-only dashboards
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rid_viewer, 'agua.tabla.view',             'allow'),
    (rid_viewer, 'agua.dashboard.view',         'allow'),
    (rid_viewer, 'agua.mapa.view',              'allow'),
    (rid_viewer, 'agua.servicios_energia.view', 'allow')
  ON CONFLICT DO NOTHING;

  -- Collector platform: focused on cobros + comunicacion
  INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
    (rid_collector, 'agua.cobros.view',           'allow'),
    (rid_collector, 'agua.cobros.create',         'allow'),
    (rid_collector, 'agua.cobros.edit',           'allow'),
    (rid_collector, 'agua.cobros.change_status',  'allow'),
    (rid_collector, 'platform.comunicacion.view',   'allow'),
    (rid_collector, 'platform.comunicacion.create', 'allow'),
    (rid_collector, 'platform.comunicacion.edit',   'allow')
  ON CONFLICT DO NOTHING;
END $$;

-- 4. Migrate existing users: assign platform system role based on app_users.role.
--    Super admins and company owners are exempt (they bypass all permission checks).
INSERT INTO public.user_roles (user_id, role_id, assigned_at)
SELECT
  u.id,
  CASE u.role
    WHEN 'admin'     THEN '00000000-0000-0000-0000-000000000201'::uuid
    WHEN 'operator'  THEN '00000000-0000-0000-0000-000000000202'::uuid
    WHEN 'operador'  THEN '00000000-0000-0000-0000-000000000202'::uuid
    WHEN 'viewer'    THEN '00000000-0000-0000-0000-000000000203'::uuid
    WHEN 'visor'     THEN '00000000-0000-0000-0000-000000000203'::uuid
    WHEN 'collector' THEN '00000000-0000-0000-0000-000000000204'::uuid
  END,
  now()
FROM public.app_users u
WHERE u.role IN ('admin','operator','operador','viewer','visor','collector')
ON CONFLICT DO NOTHING;
