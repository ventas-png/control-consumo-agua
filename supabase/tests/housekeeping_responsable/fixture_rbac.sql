-- Capa sobre el fixture de housekeeping_evidencias: el RBAC REAL en vez de `test_permisos`.
--
-- La migración del responsable evalúa el permiso de OTRA cuenta leyendo user_roles /
-- role_permissions (usuario_tiene_permiso) y el acceso al proyecto con
-- usuario_acceso_a_proyecto (20260906000400). Para que la prueba de EQUIVALENCIA tenga
-- sentido, user_has_permission() tiene que leer las mismas tablas: aquí se sustituye por
-- su definición VIGENTE (copiada de pg_get_functiondef del sandbox el 2026-10-15), igual
-- que usuario_acceso_a_proyecto.
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL, is_system boolean NOT NULL DEFAULT false);
CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL, effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  PRIMARY KEY (role_id, permission_key));
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  expires_at timestamptz, PRIMARY KEY (user_id, role_id));
-- Como en Supabase: RLS activa y sin policies → `authenticated` no lee nada de aquí.
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.roles, public.role_permissions, public.user_roles TO anon, authenticated, service_role;

-- Definición vigente (sandbox, 2026-10-15).
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

-- Definición vigente de 20260906000400 (sandbox, 2026-10-15).
CREATE OR REPLACE FUNCTION public.usuario_acceso_a_proyecto(p_user_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(
    (
      SELECT
        u.role = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
        OR (
          u.role = 'admin'
          AND NOT EXISTS (
            SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id
          )
        )
        OR u.project_id = p_project_id
        OR EXISTS (
          SELECT 1 FROM public.user_project_assignments upa
          WHERE upa.user_id = u.id AND upa.project_id = p_project_id
        )
      FROM public.app_users u
      WHERE u.id = p_user_id
    ),
    false
  )
$$;
REVOKE EXECUTE ON FUNCTION public.usuario_acceso_a_proyecto(uuid, uuid) FROM PUBLIC, anon, authenticated;
