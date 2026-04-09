-- Fase 1: Add Critical Performance Indexes for RLS Policies
-- These indexes are referenced in 100+ RLS policies
-- Expected benefit: 20-30% RLS performance improvement

-- Index for app_users.company_id (used in 35+ policies)
CREATE INDEX IF NOT EXISTS idx_app_users_company_id ON public.app_users(company_id);

-- Index for app_users.role (used in 60+ policies)
CREATE INDEX IF NOT EXISTS idx_app_users_role ON public.app_users(role);

-- Index for app_users.cliente_id (used in 15+ policies)
CREATE INDEX IF NOT EXISTS idx_app_users_cliente_id ON public.app_users(cliente_id);

-- Index for user_project_assignments.user_id (used in 6+ policies)
CREATE INDEX IF NOT EXISTS idx_user_project_assignments_user_id ON public.user_project_assignments(user_id);

-- Composite index for company_clientes lookup
CREATE INDEX IF NOT EXISTS idx_company_clientes_lookup ON public.company_clientes(company_id, cliente_id);
