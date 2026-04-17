-- Add per-company data visibility flag to company_clientes.
-- When activo=false the client keeps their portal account but that company's
-- data is hidden and replaced with a contact message in the portal.

ALTER TABLE public.company_clientes
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

-- Allow company_owner and admin to toggle this flag
DROP POLICY IF EXISTS "staff_company_clientes_update" ON public.company_clientes;
CREATE POLICY "staff_company_clientes_update" ON public.company_clientes
  FOR UPDATE
  USING (company_id IN (SELECT company_id FROM public.app_users WHERE id = auth.uid()));
