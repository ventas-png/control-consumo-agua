-- Allow users to update their own profile (full_name)
-- Required for the "Mi Cuenta" section
CREATE POLICY "Users can update their own profile" ON public.app_users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
