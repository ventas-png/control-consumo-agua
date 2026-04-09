-- Create explicit RLS policy for company_payment_secrets
-- This table should only be accessible by service_role (used in Edge Functions)
-- All other access is denied

CREATE POLICY "Deny access to all" ON public.company_payment_secrets
  USING (false)
  WITH CHECK (false);

-- Add comment for documentation
COMMENT ON POLICY "Deny access to all" ON public.company_payment_secrets IS 
  'Deny all access except service_role. This table contains sensitive secrets and should only be accessed via Edge Functions with service_role key.';
