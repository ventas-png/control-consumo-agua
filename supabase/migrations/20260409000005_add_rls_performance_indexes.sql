-- Fase 1: Crear índices críticos para optimizar RLS performance
-- Estos índices aceleran las subqueries EXISTS en políticas RLS

-- Índices en app_users (columnas usadas en ~100+ evaluaciones RLS)
CREATE INDEX IF NOT EXISTS idx_app_users_company_id ON public.app_users(company_id);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON public.app_users(role);
CREATE INDEX IF NOT EXISTS idx_app_users_cliente_id ON public.app_users(cliente_id);

-- Índice en user_project_assignments (usado en 6+ políticas)
CREATE INDEX IF NOT EXISTS idx_user_project_assignments_user_id 
  ON public.user_project_assignments(user_id);

-- Índice composite para JOINs eficientes en políticas de clientes
CREATE INDEX IF NOT EXISTS idx_company_clientes_lookup 
  ON public.company_clientes(company_id, cliente_id);

-- Comentarios para documentación
COMMENT ON INDEX idx_app_users_company_id IS 'Performance: Used in RLS policies to filter by company_id (~35+ policies)';
COMMENT ON INDEX idx_app_users_role IS 'Performance: Used in RLS policies to filter by role (~60+ policies)';
COMMENT ON INDEX idx_app_users_cliente_id IS 'Performance: Used in RLS policies to filter by cliente_id (~15+ policies)';
COMMENT ON INDEX idx_user_project_assignments_user_id IS 'Performance: Used in RLS policies for project access checks (6+ policies)';
COMMENT ON INDEX idx_company_clientes_lookup IS 'Performance: Composite index for efficient JOINs in client-scoped policies';
