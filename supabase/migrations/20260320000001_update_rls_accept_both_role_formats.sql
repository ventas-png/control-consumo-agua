-- Update RLS policies on app_users to accept both 'superadmin' and 'super_admin'
-- The app_users_role_check constraint only allows: superadmin, company_owner, admin, user, cliente
-- The frontend code maps these to UI roles. RLS must recognize the DB-native values.

DROP POLICY IF EXISTS "Admins can manage users in their company" ON public.app_users;
DROP POLICY IF EXISTS "Admins can view all users in their company" ON public.app_users;

CREATE POLICY "Admins can view all users in their company"
  ON public.app_users FOR SELECT
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
      AND role = ANY (ARRAY['admin', 'superadmin', 'company_owner'])
    )
  );

CREATE POLICY "Admins can manage users in their company"
  ON public.app_users FOR ALL
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
      AND role = ANY (ARRAY['admin', 'superadmin', 'company_owner'])
    )
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1)
    AND EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
      AND role = ANY (ARRAY['admin', 'superadmin', 'company_owner'])
    )
  );
