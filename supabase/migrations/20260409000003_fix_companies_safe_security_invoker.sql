-- Fase 3 (Parte 1): Fix companies_safe view to use SECURITY INVOKER
-- Changes companies_safe from SECURITY DEFINER to SECURITY INVOKER
-- This prevents privilege escalation while maintaining functionality

DROP VIEW IF EXISTS public.companies_safe CASCADE;

CREATE VIEW public.companies_safe WITH (security_invoker) AS
SELECT
  id,
  nombre,
  created_at
FROM public.companies;

COMMENT ON VIEW companies_safe IS 'Safe public view of companies (SECURITY INVOKER for privilege boundary)';
