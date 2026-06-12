-- ─── Conversión: asignaciones de roles del sistema → copias de empresa ──────
-- Con el modelo de plantillas, los roles del sistema dejan de asignarse
-- directamente. Esta migración convierte las asignaciones existentes: por cada
-- (empresa, rol de sistema en uso) crea — o reutiliza por linaje — la copia de
-- empresa con los mismos permisos, y re-apunta user_roles a la copia.
--
-- El re-point se hace con INSERT + DELETE (no UPDATE) para que el trigger de
-- auditoría trg_audit_user_roles (que solo cubre INSERT/DELETE) deje rastro
-- del cambio en permission_audit_log (actor_id NULL = migración).
--
-- Usuarios sin company_id (p. ej. super admins) conservan sus asignaciones
-- directas: no hay empresa donde crear la copia y la UI tolera ese estado
-- (badge "Plantilla (heredado)" con conversión manual).

DO $$
DECLARE
  pair record;
  tpl record;
  copy_id uuid;
  copy_name text;
BEGIN
  FOR pair IN
    SELECT DISTINCT u.company_id, ur.role_id AS template_id
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id AND r.is_system = true
    JOIN public.app_users u ON u.id = ur.user_id
    WHERE u.company_id IS NOT NULL
  LOOP
    SELECT * INTO tpl FROM public.roles WHERE id = pair.template_id;

    -- Reutilizar una adopción fiel existente (linaje + nombre de la plantilla);
    -- las copias personalizadas (renombradas) no cuentan como adopción.
    SELECT id INTO copy_id
    FROM public.roles
    WHERE company_id = pair.company_id
      AND cloned_from_role_id = pair.template_id
      AND name IN (tpl.name, tpl.name || ' (plantilla)')
    ORDER BY created_at
    LIMIT 1;

    IF copy_id IS NULL THEN
      -- Nombre libre: el de la plantilla, o variantes con sufijo si una
      -- empresa ya tiene un rol homónimo hecho a mano (UNIQUE company_id, name).
      IF NOT EXISTS (SELECT 1 FROM public.roles WHERE company_id = pair.company_id AND name = tpl.name) THEN
        copy_name := tpl.name;
      ELSIF NOT EXISTS (SELECT 1 FROM public.roles WHERE company_id = pair.company_id AND name = tpl.name || ' (plantilla)') THEN
        copy_name := tpl.name || ' (plantilla)';
      ELSE
        copy_name := tpl.name || ' (' || left(pair.template_id::text, 8) || ')';
      END IF;

      INSERT INTO public.roles (company_id, name, description, is_system, color, service, cloned_from_role_id)
      VALUES (pair.company_id, copy_name, tpl.description, false, tpl.color, tpl.service, pair.template_id)
      RETURNING id INTO copy_id;

      INSERT INTO public.role_permissions (role_id, permission_key, effect)
      SELECT copy_id, rp.permission_key, rp.effect
      FROM public.role_permissions rp
      WHERE rp.role_id = pair.template_id
      ON CONFLICT DO NOTHING;
    END IF;

    -- Re-point de las asignaciones de esta empresa, preservando expiración,
    -- fecha y autor de la asignación original.
    INSERT INTO public.user_roles (user_id, role_id, assigned_by, assigned_at, expires_at)
    SELECT ur.user_id, copy_id, ur.assigned_by, ur.assigned_at, ur.expires_at
    FROM public.user_roles ur
    JOIN public.app_users u ON u.id = ur.user_id
    WHERE ur.role_id = pair.template_id
      AND u.company_id = pair.company_id
    ON CONFLICT (user_id, role_id) DO NOTHING;

    DELETE FROM public.user_roles ur
    USING public.app_users u
    WHERE u.id = ur.user_id
      AND ur.role_id = pair.template_id
      AND u.company_id = pair.company_id;
  END LOOP;
END $$;
