-- Add condominios_roles array column to support multiple roles per user
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS condominios_roles text[] DEFAULT '{}';

-- Migrate existing single-role values to the new array column
UPDATE public.app_users
  SET condominios_roles = ARRAY[condominios_role]
  WHERE condominios_role IS NOT NULL
    AND (condominios_roles IS NULL OR condominios_roles = '{}');

-- Validate all array elements are valid role values
ALTER TABLE public.app_users
  ADD CONSTRAINT condominios_roles_valid CHECK (
    condominios_roles <@ ARRAY[
      'administrador_general', 'junta_directiva', 'finanzas',
      'operaciones', 'seguridad', 'comunidad', 'recepcion', 'visualizador'
    ]::text[]
  );

-- Index for queries filtering by role membership
CREATE INDEX IF NOT EXISTS idx_app_users_condominios_roles
  ON public.app_users USING GIN (condominios_roles);
