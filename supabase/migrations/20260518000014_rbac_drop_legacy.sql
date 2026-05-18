-- ─── Phase D: Drop legacy columns and tables ───────────────────────────────
-- After migrations 20260518000003-20260518000013 the RBAC tables are the
-- source of truth for all permission checks. The legacy columns and
-- user_module_permissions table become redundant and are removed.
--
-- IMPORTANT: This migration is destructive. Run only after verifying
-- that all application code reads permissions from session.permissions
-- (RBAC) instead of app_users.condominios_role / agua_role /
-- user_module_permissions. Migrations 13 + this one must ship together
-- with the TypeScript refactor in the same release.

-- 1. Drop sync triggers (no longer needed once columns are gone)
DROP TRIGGER IF EXISTS trg_sync_legacy_condominios_role  ON public.user_roles;
DROP TRIGGER IF EXISTS trg_sync_agua_module_permissions  ON public.user_roles;
DROP FUNCTION IF EXISTS public.sync_legacy_condominios_role();
DROP FUNCTION IF EXISTS public.sync_agua_module_permissions();

-- 2. Drop the legacy CHECK constraint and the columns themselves
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS condominios_roles_valid;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS condominios_role;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS condominios_roles;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS agua_role;

-- 3. Drop functions that read from user_module_permissions before dropping the table.
-- DROP TABLE ... CASCADE drops policies and indexes but NOT functions that reference it —
-- those would silently fail at runtime. Versions exist from migrations 20260407, 20260408,
-- 20260504 (each CREATE OR REPLACE overwrites the previous one).
DROP FUNCTION IF EXISTS public.populate_default_module_permissions(uuid, text);

-- 4. Drop the user_module_permissions table (replaced by user_roles + role_permissions)
DROP TABLE IF EXISTS public.user_module_permissions CASCADE;
