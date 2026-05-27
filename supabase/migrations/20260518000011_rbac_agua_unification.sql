-- ─── Phase B: Unify agua into RBAC ──────────────────────────────────────────
-- Adds agua permissions (10 modules × 4 actions) and 4 agua system roles to
-- the existing RBAC catalog. Migrates existing users from agua_role -> user_roles.
-- A trigger keeps user_module_permissions in sync with user_roles for the
-- water modules so the existing UI (usePermissions hook) keeps working.

-- 1. Add 'service' column to roles so the unified modal can group by service
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS service text;

DO $$ BEGIN
  ALTER TABLE public.roles
    ADD CONSTRAINT roles_service_valid CHECK (service IS NULL OR service IN ('condominios', 'agua', 'general'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tag the 8 existing system roles as condominios
UPDATE public.roles
  SET service = 'condominios'
  WHERE is_system = true
    AND id IN (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000006',
      '00000000-0000-0000-0000-000000000007',
      '00000000-0000-0000-0000-000000000008'
    );

-- 2. Seed agua permissions catalog (10 modules × 4 actions = 40 permissions)
DO $$
DECLARE
  modules text[][] := ARRAY[
    ['dashboard',         'Dashboard agua'],
    ['lecturas',          'Lecturas'],
    ['cobros',            'Cobros'],
    ['rutas',             'Rutas'],
    ['calidad',           'Calidad de agua'],
    ['mapa',              'Mapa'],
    ['tabla',             'Tabla de consumos'],
    ['contadores',        'Contadores'],
    ['tarifas',           'Tarifas agua'],
    ['servicios_energia', 'Servicios energía']
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
      INSERT INTO public.permissions (key, category, label, description)
      VALUES (
        'agua.' || mod_key || '.' || act_key,
        'agua_' || mod_key,
        act_label || ' — ' || mod_label,
        act_label || ' en el módulo ' || mod_label
      )
      ON CONFLICT (key) DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 3. Seed 4 agua system roles
INSERT INTO public.roles (id, company_id, name, description, is_system, color, service) VALUES
  ('00000000-0000-0000-0000-000000000101', NULL, 'Admin Agua',     'Acceso completo a todos los módulos de agua', true, '#0ea5e9', 'agua'),
  ('00000000-0000-0000-0000-000000000102', NULL, 'Operador Agua',  'Lecturas, rutas, calidad y operaciones (sin cambios de estado)', true, '#10b981', 'agua'),
  ('00000000-0000-0000-0000-000000000103', NULL, 'Cobrador',       'Cobros y cambios de estado (sin edición)', true, '#f59e0b', 'agua'),
  ('00000000-0000-0000-0000-000000000104', NULL, 'Visor Agua',     'Solo lectura de todos los módulos de agua', true, '#8b5cf6', 'agua')
ON CONFLICT (company_id, name) DO NOTHING;

-- 4. Map agua roles -> permissions (mirrors AGUA_ROLE_PERMISSIONS in moduleConfig.ts)
DO $$
DECLARE
  water_modules text[] := ARRAY['dashboard','lecturas','cobros','rutas','calidad','mapa','tabla','contadores','tarifas','servicios_energia'];
  rid_admin     uuid := '00000000-0000-0000-0000-000000000101';
  rid_operator  uuid := '00000000-0000-0000-0000-000000000102';
  rid_collector uuid := '00000000-0000-0000-0000-000000000103';
  rid_viewer    uuid := '00000000-0000-0000-0000-000000000104';
  m text;
BEGIN
  FOREACH m IN ARRAY water_modules LOOP
    -- Admin: all 4 actions
    INSERT INTO public.role_permissions (role_id, permission_key, effect)
      VALUES
        (rid_admin, 'agua.' || m || '.view',          'allow'),
        (rid_admin, 'agua.' || m || '.create',        'allow'),
        (rid_admin, 'agua.' || m || '.edit',          'allow'),
        (rid_admin, 'agua.' || m || '.change_status', 'allow')
      ON CONFLICT DO NOTHING;
    -- Operator: view + create + edit
    INSERT INTO public.role_permissions (role_id, permission_key, effect)
      VALUES
        (rid_operator, 'agua.' || m || '.view',   'allow'),
        (rid_operator, 'agua.' || m || '.create', 'allow'),
        (rid_operator, 'agua.' || m || '.edit',   'allow')
      ON CONFLICT DO NOTHING;
    -- Collector: view + create + change_status
    INSERT INTO public.role_permissions (role_id, permission_key, effect)
      VALUES
        (rid_collector, 'agua.' || m || '.view',          'allow'),
        (rid_collector, 'agua.' || m || '.create',        'allow'),
        (rid_collector, 'agua.' || m || '.change_status', 'allow')
      ON CONFLICT DO NOTHING;
    -- Viewer: view only
    INSERT INTO public.role_permissions (role_id, permission_key, effect)
      VALUES (rid_viewer, 'agua.' || m || '.view', 'allow')
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 5. Migrate existing users from agua_role -> user_roles
INSERT INTO public.user_roles (user_id, role_id, assigned_at)
SELECT
  u.id,
  CASE u.agua_role
    WHEN 'admin'     THEN '00000000-0000-0000-0000-000000000101'::uuid
    WHEN 'operator'  THEN '00000000-0000-0000-0000-000000000102'::uuid
    WHEN 'operador'  THEN '00000000-0000-0000-0000-000000000102'::uuid
    WHEN 'collector' THEN '00000000-0000-0000-0000-000000000103'::uuid
    WHEN 'viewer'    THEN '00000000-0000-0000-0000-000000000104'::uuid
    WHEN 'visor'     THEN '00000000-0000-0000-0000-000000000104'::uuid
  END,
  now()
FROM public.app_users u
WHERE u.agua_role IS NOT NULL
  AND u.agua_role IN ('admin','operator','operador','collector','viewer','visor')
ON CONFLICT DO NOTHING;

-- 6. Sync trigger: when user_roles changes for an agua role, recompute the
--    user's user_module_permissions cache for water modules.
CREATE OR REPLACE FUNCTION public.sync_agua_module_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  affected_role_service text;
  water_modules text[] := ARRAY['dashboard','lecturas','cobros','rutas','calidad','mapa','tabla','contadores','tarifas','servicios_energia'];
  m text;
  legacy_role text;
BEGIN
  uid := COALESCE(NEW.user_id, OLD.user_id);
  IF uid IS NULL THEN RETURN NULL; END IF;

  -- Only act if the affected role is an agua one
  SELECT service INTO affected_role_service
  FROM public.roles
  WHERE id = COALESCE(NEW.role_id, OLD.role_id);

  IF affected_role_service IS DISTINCT FROM 'agua' THEN
    RETURN NULL;
  END IF;

  -- Clear cached water-module permissions for this user
  DELETE FROM public.user_module_permissions
   WHERE user_id = uid AND module_key = ANY(water_modules);

  -- Rebuild from effective RBAC permissions
  FOREACH m IN ARRAY water_modules LOOP
    INSERT INTO public.user_module_permissions (
      user_id, module_key, can_view, can_create, can_edit, can_change_status
    )
    SELECT
      uid,
      m,
      EXISTS (SELECT 1 FROM public.user_roles ur
                JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                WHERE ur.user_id = uid AND rp.effect = 'allow'
                  AND rp.permission_key = 'agua.' || m || '.view'
                  AND (ur.expires_at IS NULL OR ur.expires_at > now())),
      EXISTS (SELECT 1 FROM public.user_roles ur
                JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                WHERE ur.user_id = uid AND rp.effect = 'allow'
                  AND rp.permission_key = 'agua.' || m || '.create'
                  AND (ur.expires_at IS NULL OR ur.expires_at > now())),
      EXISTS (SELECT 1 FROM public.user_roles ur
                JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                WHERE ur.user_id = uid AND rp.effect = 'allow'
                  AND rp.permission_key = 'agua.' || m || '.edit'
                  AND (ur.expires_at IS NULL OR ur.expires_at > now())),
      EXISTS (SELECT 1 FROM public.user_roles ur
                JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                WHERE ur.user_id = uid AND rp.effect = 'allow'
                  AND rp.permission_key = 'agua.' || m || '.change_status'
                  AND (ur.expires_at IS NULL OR ur.expires_at > now()))
    WHERE EXISTS (SELECT 1 FROM public.user_roles ur
                    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                    WHERE ur.user_id = uid AND rp.effect = 'allow'
                      AND rp.permission_key LIKE 'agua.' || m || '.%'
                      AND (ur.expires_at IS NULL OR ur.expires_at > now()));
  END LOOP;

  -- Update legacy agua_role denormalized column from the highest-tier role assigned
  SELECT
    CASE
      WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role_id = '00000000-0000-0000-0000-000000000101') THEN 'admin'
      WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role_id = '00000000-0000-0000-0000-000000000102') THEN 'operator'
      WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role_id = '00000000-0000-0000-0000-000000000103') THEN 'collector'
      WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role_id = '00000000-0000-0000-0000-000000000104') THEN 'viewer'
      ELSE NULL
    END INTO legacy_role;

  UPDATE public.app_users SET agua_role = legacy_role WHERE id = uid;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_agua_module_permissions ON public.user_roles;
CREATE TRIGGER trg_sync_agua_module_permissions
  AFTER INSERT OR DELETE OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_agua_module_permissions();

-- 7. Run sync once for existing assignments (so user_module_permissions is fresh)
DO $$
DECLARE
  ur record;
BEGIN
  -- Alias `t` para evitar colision con la variable PL/pgSQL `ur`: PostgreSQL
  -- rechaza con "record ur is not assigned" cuando el mismo nombre se usa
  -- como variable de loop y como alias de tabla en la misma query.
  FOR ur IN
    SELECT DISTINCT t.user_id, t.role_id
    FROM public.user_roles t
    JOIN public.roles r ON r.id = t.role_id
    WHERE r.service = 'agua'
  LOOP
    -- Touch the row to force the trigger to fire
    UPDATE public.user_roles SET assigned_at = assigned_at
     WHERE user_id = ur.user_id AND role_id = ur.role_id;
  END LOOP;
END $$;
