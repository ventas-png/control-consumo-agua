-- =====================================================================
-- Retiro del modelo de niveles legacy (basico/profesional/enterprise).
--
-- `companies.plan` quedó obsoleto desde 20260528000030: el modelo comercial
-- real es por módulo activo (billing_plans: agua_only/condominios_only/bundle)
-- + uso (proyectos y unidades, 20260528000060). Ninguna lógica de negocio lee
-- esta columna (límites: get_company_effective_limits; features:
-- billing_plans.feature_codes). Sus dos últimos consumidores se retiraron en
-- las migraciones previas de esta banda:
--   · lock_companies_billing_columns ya no congela `plan` (20260612180000).
--   · get_superadmin_empresas v2 ya no la devuelve (20260612180100).
-- =====================================================================

-- companies_safe (20260409000003) enumeraba `plan`: recrearla sin la columna
-- ANTES del DROP (la dependencia bloquea el ALTER TABLE con SQLSTATE 2BP01).
DROP VIEW IF EXISTS public.companies_safe;

CREATE VIEW public.companies_safe WITH (security_invoker) AS
SELECT id, nombre, nit, email, telefono, activa, created_at,
       max_projects, logo_url, max_units,
       stripe_public_key, stripe_configured, stripe_activo,
       paypal_client_id, paypal_configured, paypal_activo
FROM public.companies;

GRANT SELECT ON public.companies_safe TO authenticated;

COMMENT ON VIEW public.companies_safe IS 'Safe view of companies table - exposes only public payment keys, not secrets';

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_plan_check;
ALTER TABLE public.companies DROP COLUMN IF EXISTS plan;
