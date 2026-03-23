-- Fix: Add default value for permission_type so INSERTs without it don't fail
-- The frontend sends permission_type: 'total' explicitly (code fix), but this
-- default acts as a safety net for any running instances that may not have
-- hot-reloaded the code change yet.
ALTER TABLE public.user_project_assignments
  ALTER COLUMN permission_type SET DEFAULT 'total';
