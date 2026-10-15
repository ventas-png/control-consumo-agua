-- Lo MÍNIMO para que 20261030000100 se pueda aplicar sobre el fixture de la suite
-- housekeeping_evidencias (que modela los permisos con `test_permisos`, no con RBAC):
-- las tablas que lee usuario_tiene_permiso (vacías: ninguna persona de esa suite
-- asigna responsable) y usuario_acceso_a_proyecto (20260906000400). Así la suite de
-- #927 corre con la migración del responsable encima y demuestra que no cambia nada
-- de lo que ya probaba.
CREATE TABLE IF NOT EXISTS public.roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, name text NOT NULL);
CREATE TABLE IF NOT EXISTS public.role_permissions (role_id uuid NOT NULL, permission_key text NOT NULL, effect text NOT NULL DEFAULT 'allow');
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role_id uuid NOT NULL, expires_at timestamptz);
CREATE OR REPLACE FUNCTION public.usuario_acceso_a_proyecto(p_user_id uuid, p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE((
      SELECT u.role = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
          OR (u.role = 'admin' AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id))
          OR u.project_id = p_project_id
          OR EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id AND upa.project_id = p_project_id)
      FROM public.app_users u WHERE u.id = p_user_id), false)
$$;
REVOKE EXECUTE ON FUNCTION public.usuario_acceso_a_proyecto(uuid, uuid) FROM PUBLIC, anon, authenticated;
