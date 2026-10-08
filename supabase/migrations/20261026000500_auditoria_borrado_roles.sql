-- Generada por CLI 20261005192458; renumerada después de la serie vigente
-- 20261026000400 para conservar el mismo orden en replay y despliegue incremental.
-- AFTER DELETE: el rol ya no existe. La FK nullable es sólo una referencia viva;
-- details.role_id conserva la identidad histórica aunque ON DELETE SET NULL actúe.
-- Incluye los DELETE en cascada de permisos y asignaciones. Sin excepciones
-- silenciadas, cambios de RLS, nuevos grants ni desactivación de triggers.
-- Los eventos previos también deben conservar la identidad antes de que la FK
-- viva se vuelva NULL. No se inventa una identidad para eventos ya huérfanos.
UPDATE public.permission_audit_log
SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('role_id', target_role_id)
WHERE target_role_id IS NOT NULL
  AND NOT (COALESCE(details, '{}'::jsonb) ? 'role_id');

CREATE OR REPLACE FUNCTION public.audit_roles_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_role_id, action, details)
    VALUES (auth.uid(), NEW.id, 'create_role', jsonb_build_object(
      'role_id', NEW.id, 'name', NEW.name, 'company_id', NEW.company_id, 'is_system', NEW.is_system));
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_role_id, action, details)
    VALUES (auth.uid(), NEW.id, 'update_role', jsonb_build_object(
      'role_id', NEW.id, 'company_id', NEW.company_id,
      'before', jsonb_build_object('name', OLD.name, 'description', OLD.description, 'color', OLD.color),
      'after', jsonb_build_object('name', NEW.name, 'description', NEW.description, 'color', NEW.color)));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_role_id, action, details)
    VALUES (auth.uid(), NULL, 'delete_role', jsonb_build_object(
      'role_id', OLD.id, 'name', OLD.name, 'company_id', OLD.company_id, 'is_system', OLD.is_system));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_role_permissions_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_role_id, action, details)
    VALUES (auth.uid(), NEW.role_id, 'grant_permission', jsonb_build_object(
      'role_id', NEW.role_id, 'permission_key', NEW.permission_key, 'effect', NEW.effect));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_role_id, action, details)
    VALUES (auth.uid(), (SELECT r.id FROM public.roles r WHERE r.id = OLD.role_id),
      'revoke_permission', jsonb_build_object(
        'role_id', OLD.role_id, 'permission_key', OLD.permission_key, 'effect', OLD.effect));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_user_roles_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_user_id, target_role_id, action, details)
    VALUES (auth.uid(), NEW.user_id, NEW.role_id, 'assign_role', jsonb_build_object(
      'role_id', NEW.role_id, 'user_id', NEW.user_id,
      'expires_at', NEW.expires_at, 'assigned_by', NEW.assigned_by));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.permission_audit_log(actor_id, target_user_id, target_role_id, action, details)
    VALUES (auth.uid(), (SELECT u.id FROM public.app_users u WHERE u.id = OLD.user_id),
      (SELECT r.id FROM public.roles r WHERE r.id = OLD.role_id), 'remove_role',
      jsonb_build_object('role_id', OLD.role_id, 'user_id', OLD.user_id));
  END IF;
  RETURN NULL;
END;
$$;

-- Trigger-only: conservar la prohibición de invocación directa del hardening RBAC.
REVOKE EXECUTE ON FUNCTION public.audit_roles_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_role_permissions_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_user_roles_changes() FROM PUBLIC, anon, authenticated;
