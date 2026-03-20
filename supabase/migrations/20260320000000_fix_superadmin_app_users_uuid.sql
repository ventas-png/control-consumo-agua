-- ============================================================
-- Reset app_users table with correct role check constraint
-- and correct UUID/role for superadmin@plataforma.com
--
-- Root causes fixed:
-- 1. Original app_users had random UUID not matching auth.users UUID
-- 2. Check constraint only allowed 'superadmin' but production code
--    expects 'super_admin' (with underscore)
-- 3. RLS policies not aligned with valid role values
-- ============================================================

-- Drop dependent RLS policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.app_users;
DROP POLICY IF EXISTS "Admins can view all users in their company" ON public.app_users;
DROP POLICY IF EXISTS "Admins can manage users in their company" ON public.app_users;

-- Drop and recreate with correct check constraint
DROP TABLE IF EXISTS public.app_users CASCADE;

CREATE TABLE public.app_users (
  id              uuid        PRIMARY KEY,
  full_name       text,
  role            text        NOT NULL CHECK (role = ANY (ARRAY[
                                'super_admin','superadmin','company_owner',
                                'admin','operator','user','viewer','visor',
                                'operador','cliente'
                              ])),
  created_at      timestamptz DEFAULT now(),
  cliente_id      uuid,
  permission_type text        CHECK (permission_type = ANY (ARRAY[
                                'total','lectura','financiero','administrativo'
                              ])),
  project_id      uuid,
  company_id      uuid,
  activo          boolean     NOT NULL DEFAULT true
);

-- Insert superadmin with role = 'super_admin' (matches production code mapping)
INSERT INTO public.app_users (id, full_name, role, company_id, activo)
VALUES (
  'acce8cd9-fb0b-4b03-8d21-564c42d88198',
  'Super Administrador',
  'super_admin',
  'acce8cd9-fb0b-4b03-8d21-564c42d88198',
  true
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.app_users FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins can view all users in their company"
  ON public.app_users FOR SELECT TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users WHERE id = auth.uid()
      AND role = ANY (ARRAY['admin','super_admin','superadmin','company_owner'])
    )
  );

CREATE POLICY "Admins can manage users in their company"
  ON public.app_users FOR ALL TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users WHERE id = auth.uid()
      AND role = ANY (ARRAY['admin','super_admin','superadmin','company_owner'])
    )
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users WHERE id = auth.uid()
      AND role = ANY (ARRAY['admin','super_admin','superadmin','company_owner'])
    )
  );
