-- Add missing payment toggle columns
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_activo boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS paypal_activo boolean DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS paypal_client_secret text;

-- Create a safe view that excludes secret columns for frontend queries
CREATE OR REPLACE VIEW companies_safe AS
SELECT id, nombre, nit, email, telefono, plan, activa, created_at,
       max_projects, logo_url, max_units,
       stripe_public_key, stripe_configured, stripe_activo,
       paypal_client_id, paypal_configured, paypal_activo
FROM companies;

-- Grant access to the view for authenticated users
GRANT SELECT ON companies_safe TO authenticated;
