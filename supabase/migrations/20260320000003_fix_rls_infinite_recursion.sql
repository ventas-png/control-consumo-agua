-- Fix infinite recursion in app_users RLS policies
-- Root cause: "Admins can manage/view" policies had subqueries to app_users,
-- and current_user_role() was SECURITY INVOKER, both causing recursive RLS evaluation.

-- Step 1: Fix current_user_role() to SECURITY DEFINER (bypasses RLS on app_users)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

-- Step 2: Create get_my_company_id() SECURITY DEFINER helper
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

-- Step 3: Drop the recursive admin policies
DROP POLICY IF EXISTS "Admins can view all users in their company" ON public.app_users;
DROP POLICY IF EXISTS "Admins can manage users in their company" ON public.app_users;

-- Step 4: Recreate using SECURITY DEFINER functions (no recursion)
CREATE POLICY "Admins can view all users in their company" ON public.app_users
  FOR SELECT USING (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner'])
    AND company_id = get_my_company_id()
  );

CREATE POLICY "Admins can manage users in their company" ON public.app_users
  FOR ALL
  USING (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner'])
    AND company_id = get_my_company_id()
  )
  WITH CHECK (
    current_user_role() = ANY(ARRAY['admin','super_admin','superadmin','company_owner'])
    AND company_id = get_my_company_id()
  );
