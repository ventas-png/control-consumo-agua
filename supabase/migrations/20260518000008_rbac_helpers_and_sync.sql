-- ─── RBAC helper functions ──────────────────────────────────────────────────

-- Check if the current user has a specific permission.
-- Considers explicit deny (deny overrides allow across roles).
-- Treats super_admin/company_owner/admin as having all permissions.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT role FROM public.app_users WHERE id = auth.uid()
  )
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN false
      WHEN (SELECT role FROM me) IN ('super_admin', 'superadmin', 'company_owner', 'admin') THEN true
      WHEN EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = auth.uid()
          AND rp.permission_key = perm_key
          AND rp.effect = 'deny'
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
      ) THEN false
      ELSE EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = auth.uid()
          AND rp.permission_key = perm_key
          AND rp.effect = 'allow'
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
      )
    END
$$;

GRANT EXECUTE ON FUNCTION public.user_has_permission(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.user_has_permission(text) FROM anon;

-- Returns the set of effective permission keys for a given user.
-- Used by the session loader. SECURITY DEFINER bypasses RLS so the join works,
-- but callers can only query their own permissions unless they are an admin
-- in the target user's company. This prevents users from enumerating other
-- users' permissions.
CREATE OR REPLACE FUNCTION public.get_user_permissions(target_user_id uuid)
RETURNS SETOF text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_self boolean := target_user_id = auth.uid();
  is_admin_of_target boolean := false;
BEGIN
  IF NOT is_self THEN
    SELECT EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = target_user_id
        AND (
          public.is_super_admin()
          OR (
            u.company_id = public.get_my_company_id()
            AND public.current_user_role() IN ('company_owner', 'admin')
          )
        )
    ) INTO is_admin_of_target;
    IF NOT is_admin_of_target THEN
      RAISE EXCEPTION 'access denied: cannot read permissions of other users';
    END IF;
  END IF;

  RETURN QUERY
    WITH allowed AS (
      SELECT DISTINCT rp.permission_key
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = target_user_id
        AND rp.effect = 'allow'
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    ),
    denied AS (
      SELECT DISTINCT rp.permission_key
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = target_user_id
        AND rp.effect = 'deny'
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    )
    SELECT permission_key FROM allowed
    WHERE permission_key NOT IN (SELECT permission_key FROM denied);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO authenticated;

-- ─── Sync trigger: keep app_users.condominios_role(s) in sync with user_roles
-- This preserves backward compatibility for any code still reading the legacy
-- columns (sidebar, communication section, queries). The new RBAC tables are
-- the source of truth; these columns are a denormalized cache.

CREATE OR REPLACE FUNCTION public.sync_legacy_condominios_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  role_names text[];
  legacy_map jsonb := jsonb_build_object(
    '00000000-0000-0000-0000-000000000001', 'administrador_general',
    '00000000-0000-0000-0000-000000000002', 'junta_directiva',
    '00000000-0000-0000-0000-000000000003', 'finanzas',
    '00000000-0000-0000-0000-000000000004', 'operaciones',
    '00000000-0000-0000-0000-000000000005', 'seguridad',
    '00000000-0000-0000-0000-000000000006', 'comunidad',
    '00000000-0000-0000-0000-000000000007', 'recepcion',
    '00000000-0000-0000-0000-000000000008', 'visualizador'
  );
BEGIN
  uid := COALESCE(NEW.user_id, OLD.user_id);
  IF uid IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(array_agg(legacy_map ->> ur.role_id::text) FILTER (WHERE legacy_map ? ur.role_id::text), ARRAY[]::text[])
  INTO role_names
  FROM public.user_roles ur
  WHERE ur.user_id = uid
    AND (ur.expires_at IS NULL OR ur.expires_at > now());

  UPDATE public.app_users
  SET
    condominios_roles = role_names,
    condominios_role = CASE WHEN array_length(role_names, 1) > 0 THEN role_names[1] ELSE NULL END
  WHERE id = uid;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_condominios_role ON public.user_roles;
CREATE TRIGGER trg_sync_legacy_condominios_role
  AFTER INSERT OR DELETE OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_legacy_condominios_role();

-- ─── Audit log triggers ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_user_roles_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_user_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      NEW.user_id,
      NEW.role_id,
      'assign_role',
      jsonb_build_object('expires_at', NEW.expires_at, 'assigned_by', NEW.assigned_by)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_user_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      OLD.user_id,
      OLD.role_id,
      'remove_role',
      '{}'::jsonb
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles_changes();

CREATE OR REPLACE FUNCTION public.audit_roles_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      NEW.id,
      'create_role',
      jsonb_build_object('name', NEW.name, 'company_id', NEW.company_id, 'is_system', NEW.is_system)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      NEW.id,
      'update_role',
      jsonb_build_object(
        'before', jsonb_build_object('name', OLD.name, 'description', OLD.description, 'color', OLD.color),
        'after',  jsonb_build_object('name', NEW.name, 'description', NEW.description, 'color', NEW.color)
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      OLD.id,
      'delete_role',
      jsonb_build_object('name', OLD.name, 'company_id', OLD.company_id)
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_roles ON public.roles;
CREATE TRIGGER trg_audit_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_roles_changes();

CREATE OR REPLACE FUNCTION public.audit_role_permissions_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      NEW.role_id,
      'grant_permission',
      jsonb_build_object('permission_key', NEW.permission_key, 'effect', NEW.effect)
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log (actor_id, target_role_id, action, details)
    VALUES (
      auth.uid(),
      OLD.role_id,
      'revoke_permission',
      jsonb_build_object('permission_key', OLD.permission_key, 'effect', OLD.effect)
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_role_permissions ON public.role_permissions;
CREATE TRIGGER trg_audit_role_permissions
  AFTER INSERT OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_role_permissions_changes();
