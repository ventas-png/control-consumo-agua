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

ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_plan_check;
ALTER TABLE public.companies DROP COLUMN IF EXISTS plan;
