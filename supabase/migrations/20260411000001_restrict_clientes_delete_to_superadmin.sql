-- Restrict DELETE on clientes table to super_admin only.
-- Company owners/admins should remove clients from their company via
-- the company_clientes junction table, not by deleting the master record.
-- This prevents data loss when a client belongs to multiple companies.
DROP POLICY IF EXISTS "clientes_delete_by_role" ON public.clientes;
CREATE POLICY "clientes_delete_by_role" ON public.clientes
  FOR DELETE TO authenticated
  USING (
    current_user_role() IN ('super_admin', 'superadmin')
  );
