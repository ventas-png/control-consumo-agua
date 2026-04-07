-- ============================================================
-- Control de Acceso Granular por Módulos
-- Permite al company_owner configurar qué módulos ve cada
-- usuario y qué acciones puede realizar dentro de cada módulo.
-- ============================================================

-- 1. Tabla principal
CREATE TABLE public.user_module_permissions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  module_key      text        NOT NULL,
  can_view        boolean     NOT NULL DEFAULT false,
  can_create      boolean     NOT NULL DEFAULT false,
  can_edit        boolean     NOT NULL DEFAULT false,
  can_change_status boolean   NOT NULL DEFAULT false,
  updated_at      timestamptz DEFAULT now(),
  updated_by      uuid        REFERENCES public.app_users(id),

  CONSTRAINT uq_user_module UNIQUE(user_id, module_key),
  CONSTRAINT chk_module_key CHECK (module_key IN (
    'clientes','lecturas','tabla','dashboard','cobros',
    'mapa','calidad','rutas','tarifas','unidades',
    'contadores','configuracion'
  ))
);

-- Índices para performance
CREATE INDEX idx_ump_user_id ON public.user_module_permissions(user_id);
CREATE INDEX idx_ump_module  ON public.user_module_permissions(module_key);

-- ============================================================
-- 2. RLS
-- ============================================================
ALTER TABLE public.user_module_permissions ENABLE ROW LEVEL SECURITY;

-- Usuarios ven sus propios permisos
CREATE POLICY "Users view own module permissions"
  ON public.user_module_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Super admin ve todos los permisos
CREATE POLICY "SuperAdmin views all module permissions"
  ON public.user_module_permissions FOR SELECT TO authenticated
  USING (is_super_admin());

-- Company owner ve permisos de usuarios de su empresa
CREATE POLICY "CompanyOwner views company module permissions"
  ON public.user_module_permissions FOR SELECT TO authenticated
  USING (
    is_company_owner()
    AND user_id IN (
      SELECT id FROM public.app_users WHERE company_id = get_my_company_id()
    )
  );

-- Super admin gestiona todos los permisos
CREATE POLICY "SuperAdmin manages all module permissions"
  ON public.user_module_permissions FOR ALL TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Company owner gestiona permisos de su empresa
CREATE POLICY "CompanyOwner manages company module permissions"
  ON public.user_module_permissions FOR ALL TO authenticated
  USING (
    is_company_owner()
    AND user_id IN (
      SELECT id FROM public.app_users WHERE company_id = get_my_company_id()
    )
  )
  WITH CHECK (
    is_company_owner()
    AND user_id IN (
      SELECT id FROM public.app_users WHERE company_id = get_my_company_id()
    )
  );

-- ============================================================
-- 3. Función helper: check_module_permission
-- Disponible para RLS policies y edge functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_module_permission(
  p_module_key text,
  p_permission text  -- 'view', 'create', 'edit', 'change_status'
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Super admin y company_owner siempre tienen acceso total
    WHEN current_user_role() IN ('super_admin','superadmin','company_owner') THEN true
    -- Buscar permiso explícito en la tabla
    ELSE COALESCE(
      (SELECT CASE p_permission
        WHEN 'view' THEN can_view
        WHEN 'create' THEN can_create
        WHEN 'edit' THEN can_edit
        WHEN 'change_status' THEN can_change_status
        ELSE false
       END
       FROM public.user_module_permissions
       WHERE user_id = auth.uid() AND module_key = p_module_key
      ),
      false  -- Sin permiso explícito = sin acceso
    )
  END
$$;

-- ============================================================
-- 4. Función para poblar permisos por defecto según rol
-- Llamada al crear un usuario nuevo o al resetear permisos
-- ============================================================
CREATE OR REPLACE FUNCTION public.populate_default_module_permissions(
  p_user_id uuid,
  p_role text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_defaults jsonb;
BEGIN
  v_defaults := CASE p_role
    WHEN 'admin' THEN '[
      {"m":"clientes","v":true,"c":true,"e":true,"s":true},
      {"m":"lecturas","v":true,"c":true,"e":false,"s":false},
      {"m":"tabla","v":true,"c":false,"e":true,"s":true},
      {"m":"dashboard","v":true,"c":false,"e":false,"s":false},
      {"m":"cobros","v":true,"c":true,"e":true,"s":true},
      {"m":"mapa","v":true,"c":false,"e":false,"s":false},
      {"m":"calidad","v":true,"c":true,"e":true,"s":false},
      {"m":"rutas","v":true,"c":true,"e":true,"s":false},
      {"m":"tarifas","v":true,"c":true,"e":true,"s":false},
      {"m":"unidades","v":true,"c":true,"e":true,"s":false},
      {"m":"contadores","v":true,"c":true,"e":true,"s":false},
      {"m":"configuracion","v":true,"c":false,"e":true,"s":false}
    ]'::jsonb
    WHEN 'operator' THEN '[
      {"m":"clientes","v":true,"c":true,"e":true,"s":true},
      {"m":"lecturas","v":true,"c":true,"e":false,"s":false},
      {"m":"tabla","v":true,"c":false,"e":false,"s":false},
      {"m":"dashboard","v":true,"c":false,"e":false,"s":false},
      {"m":"mapa","v":true,"c":false,"e":false,"s":false},
      {"m":"calidad","v":true,"c":true,"e":true,"s":false},
      {"m":"rutas","v":true,"c":false,"e":true,"s":false},
      {"m":"contadores","v":true,"c":false,"e":true,"s":false}
    ]'::jsonb
    WHEN 'operador' THEN '[
      {"m":"clientes","v":true,"c":true,"e":true,"s":true},
      {"m":"lecturas","v":true,"c":true,"e":false,"s":false},
      {"m":"tabla","v":true,"c":false,"e":false,"s":false},
      {"m":"dashboard","v":true,"c":false,"e":false,"s":false},
      {"m":"mapa","v":true,"c":false,"e":false,"s":false},
      {"m":"calidad","v":true,"c":true,"e":true,"s":false},
      {"m":"rutas","v":true,"c":false,"e":true,"s":false},
      {"m":"contadores","v":true,"c":false,"e":true,"s":false}
    ]'::jsonb
    WHEN 'viewer' THEN '[
      {"m":"tabla","v":true,"c":false,"e":false,"s":false},
      {"m":"dashboard","v":true,"c":false,"e":false,"s":false},
      {"m":"mapa","v":true,"c":false,"e":false,"s":false}
    ]'::jsonb
    WHEN 'visor' THEN '[
      {"m":"tabla","v":true,"c":false,"e":false,"s":false},
      {"m":"dashboard","v":true,"c":false,"e":false,"s":false},
      {"m":"mapa","v":true,"c":false,"e":false,"s":false}
    ]'::jsonb
    WHEN 'collector' THEN '[
      {"m":"cobros","v":true,"c":true,"e":true,"s":true}
    ]'::jsonb
    ELSE '[]'::jsonb
  END;

  -- Insertar permisos por defecto (ignorar duplicados)
  INSERT INTO public.user_module_permissions
    (user_id, module_key, can_view, can_create, can_edit, can_change_status)
  SELECT
    p_user_id,
    (item->>'m')::text,
    (item->>'v')::boolean,
    (item->>'c')::boolean,
    (item->>'e')::boolean,
    (item->>'s')::boolean
  FROM jsonb_array_elements(v_defaults) AS item
  ON CONFLICT (user_id, module_key) DO NOTHING;
END;
$$;

-- ============================================================
-- 5. Poblar permisos para usuarios existentes
-- Solo roles configurables que estén activos
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, role FROM public.app_users
    WHERE role NOT IN ('super_admin','superadmin','company_owner','cliente')
      AND activo = true
  LOOP
    PERFORM populate_default_module_permissions(r.id, r.role);
  END LOOP;
END;
$$;
