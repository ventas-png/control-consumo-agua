-- ============================================================================
-- companies.signup_source para distinguir self-service vs superadmin (plat:P5)
-- ============================================================================
-- Marca como nacio cada company:
--   - 'self_service': el admin la creo por su cuenta vía signup-company
--   - 'manual_superadmin': el equipo de AdministraTodo la creo desde el panel
--   - 'import' / 'migration' (futuro): cargas masivas, traspasos
--
-- Util para analitica de embudo de adquisicion y para que el superadmin
-- distinga workspaces que necesitan onboarding asistido de los que no.
--
-- Idempotencia: ADD COLUMN IF NOT EXISTS + DEFAULT 'manual_superadmin' (la
-- mayoria de companies existentes vinieron por ese canal).
-- ============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS signup_source text NOT NULL DEFAULT 'manual_superadmin';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_signup_source_check'
      AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_signup_source_check
      CHECK (signup_source IN ('self_service', 'manual_superadmin', 'import', 'migration'));
  END IF;
END $$;

COMMENT ON COLUMN public.companies.signup_source IS
  'Como nacio este tenant. self_service = signup-company edge function; manual_superadmin = panel de admin interno; import/migration para casos especiales.';

-- Indice parcial para que el superadmin filtre workspaces self-service rapido
-- (utiles para onboarding asistido, soporte, analitica de conversion).
CREATE INDEX IF NOT EXISTS idx_companies_self_service
  ON public.companies(created_at DESC)
  WHERE signup_source = 'self_service';
