-- Drop and recreate companies_safe view with SECURITY INVOKER (more secure)
DROP VIEW IF EXISTS companies_safe;

CREATE VIEW companies_safe WITH (security_invoker) AS
SELECT id, nombre, nit, email, telefono, plan, activa, created_at,
       max_projects, logo_url, max_units,
       stripe_public_key, stripe_configured, stripe_activo,
       paypal_client_id, paypal_configured, paypal_activo
FROM companies;

-- Grant SELECT permission to authenticated users
GRANT SELECT ON companies_safe TO authenticated;

-- Add comment for documentation
COMMENT ON VIEW companies_safe IS 'Safe view of companies table - exposes only public payment keys, not secrets';
