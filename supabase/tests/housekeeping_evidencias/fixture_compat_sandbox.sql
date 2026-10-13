-- Capa que acerca el PostgreSQL desechable al CONTRATO del sandbox, para poder ejecutar aquí el
-- guion `sandbox_housekeeping.sql` ANTES de lanzarlo contra el proyecto real:
--   · auth.uid() lee `request.jwt.claim.sub` (como Supabase), no `app.uid`;
--   · los permisos salen del RBAC real (roles / role_permissions / user_roles);
--   · las columnas que el guion inserta y el fixture mínimo no trae.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS default_currency text;
ALTER TABLE public.user_project_assignments ADD COLUMN IF NOT EXISTS permission_type text;
CREATE TABLE public.roles (id uuid PRIMARY KEY, company_id uuid, name text);
CREATE TABLE public.role_permissions (role_id uuid NOT NULL, permission_key text NOT NULL, effect text NOT NULL DEFAULT 'allow');
CREATE TABLE public.user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL, expires_at timestamptz);
GRANT ALL ON public.roles, public.role_permissions, public.user_roles TO anon, authenticated, service_role;
ALTER TABLE public.servicios_housekeeping ALTER COLUMN fecha DROP DEFAULT;   -- como el real: NOT NULL sin default

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
-- Definición vigente en el sandbox (copiada de pg_get_functiondef).
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT role FROM public.app_users WHERE id = auth.uid())
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN (SELECT role FROM me) IN ('super_admin', 'superadmin', 'company_owner', 'admin') THEN true
    WHEN EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                  WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key AND rp.effect = 'deny'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now())) THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp ON rp.role_id = ur.role_id
                  WHERE ur.user_id = auth.uid() AND rp.permission_key = perm_key AND rp.effect = 'allow'
                    AND (ur.expires_at IS NULL OR ur.expires_at > now()))
  END
$$;
