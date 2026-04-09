-- Fase 3 (Parte 2): Add explicit DENY policy to company_payment_secrets
-- Ensures no one can access payment secrets through RLS
-- Only service_role (Edge Functions) can access this table

ALTER TABLE public.company_payment_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny access to all" ON public.company_payment_secrets
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "Deny access to all" ON public.company_payment_secrets IS 'DENY all RLS access - only service_role can access payment secrets';
