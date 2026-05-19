-- Performance fix #1: envolver auth.uid() en (SELECT auth.uid()) en políticas RLS
-- para que Postgres lo evalúe una sola vez por query (InitPlan) en lugar de
-- re-evaluarlo por cada fila. Identificadas por el advisor "auth_rls_initplan"
-- de Supabase (26 políticas en 11 tablas calientes del portal del residente
-- y del back-office).
--
-- Referencia oficial:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Esta migración NO cambia la semántica de las políticas. Solo reemplaza las
-- referencias directas a auth.uid() por (SELECT auth.uid()), preservando
-- AS PERMISSIVE, los roles (public/authenticated) y el resto del cuerpo.

-- ── amenidades ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "residents_select_amenidades" ON public.amenidades;
CREATE POLICY "residents_select_amenidades" ON public.amenidades
  FOR SELECT
  USING (
    project_id IN (
      SELECT u.project_id
      FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    )
  );

-- ── amenidades_bloqueos ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "residents_select_amenidades_bloqueos" ON public.amenidades_bloqueos;
CREATE POLICY "residents_select_amenidades_bloqueos" ON public.amenidades_bloqueos
  FOR SELECT
  USING (
    project_id IN (
      SELECT u.project_id
      FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    )
  );

-- ── company_email_configs (4 policies) ────────────────────────────────────────

DROP POLICY IF EXISTS "company_email_configs_select" ON public.company_email_configs;
CREATE POLICY "company_email_configs_select" ON public.company_email_configs
  FOR SELECT
  USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

DROP POLICY IF EXISTS "company_email_configs_insert" ON public.company_email_configs;
CREATE POLICY "company_email_configs_insert" ON public.company_email_configs
  FOR INSERT
  WITH CHECK (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

DROP POLICY IF EXISTS "company_email_configs_update" ON public.company_email_configs;
CREATE POLICY "company_email_configs_update" ON public.company_email_configs
  FOR UPDATE
  USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

DROP POLICY IF EXISTS "company_email_configs_delete" ON public.company_email_configs;
CREATE POLICY "company_email_configs_delete" ON public.company_email_configs
  FOR DELETE
  USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

-- ── config_condominio ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "config_cond_select" ON public.config_condominio;
CREATE POLICY "config_cond_select" ON public.config_condominio
  FOR SELECT
  USING (
    company_id = get_my_company_id()
    OR project_id = (
      SELECT app_users.project_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

-- ── email_templates (4 policies) ──────────────────────────────────────────────

DROP POLICY IF EXISTS "email_templates_select" ON public.email_templates;
CREATE POLICY "email_templates_select" ON public.email_templates
  FOR SELECT
  USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

DROP POLICY IF EXISTS "email_templates_insert" ON public.email_templates;
CREATE POLICY "email_templates_insert" ON public.email_templates
  FOR INSERT
  WITH CHECK (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

DROP POLICY IF EXISTS "email_templates_update" ON public.email_templates;
CREATE POLICY "email_templates_update" ON public.email_templates
  FOR UPDATE
  USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

DROP POLICY IF EXISTS "email_templates_delete" ON public.email_templates;
CREATE POLICY "email_templates_delete" ON public.email_templates
  FOR DELETE
  USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) LIMIT 1
    ))
    OR (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'super_admin' LIMIT 1
    ))
  );

-- ── mensajes_portal (6 policies) ──────────────────────────────────────────────

DROP POLICY IF EXISTS "company_users_select_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "company_users_select_mensajes_portal" ON public.mensajes_portal
  FOR SELECT
  USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.company_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "company_users_update_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "company_users_update_mensajes_portal" ON public.mensajes_portal
  FOR UPDATE
  USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.company_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "residents_insert_mensajes" ON public.mensajes_portal;
CREATE POLICY "residents_insert_mensajes" ON public.mensajes_portal
  FOR INSERT TO authenticated
  WITH CHECK (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

DROP POLICY IF EXISTS "residents_insert_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "residents_insert_mensajes_portal" ON public.mensajes_portal
  FOR INSERT
  WITH CHECK (
    unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "residents_select_mensajes" ON public.mensajes_portal;
CREATE POLICY "residents_select_mensajes" ON public.mensajes_portal
  FOR SELECT TO authenticated
  USING (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

DROP POLICY IF EXISTS "residents_select_own_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "residents_select_own_mensajes_portal" ON public.mensajes_portal
  FOR SELECT
  USING (
    unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid())
    )
  );

-- ── permissions ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "permissions_select" ON public.permissions;
CREATE POLICY "permissions_select" ON public.permissions
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

-- ── reservas_amenidades (2 policies) ──────────────────────────────────────────

DROP POLICY IF EXISTS "residents_select_reservas_amenidades" ON public.reservas_amenidades;
CREATE POLICY "residents_select_reservas_amenidades" ON public.reservas_amenidades
  FOR SELECT
  USING (
    unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    )
  );

DROP POLICY IF EXISTS "residents_insert_reservas_amenidades" ON public.reservas_amenidades;
CREATE POLICY "residents_insert_reservas_amenidades" ON public.reservas_amenidades
  FOR INSERT
  WITH CHECK (
    unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    )
  );

-- ── tickets_mantenimiento (2 policies) ────────────────────────────────────────

DROP POLICY IF EXISTS "residents_select_tickets" ON public.tickets_mantenimiento;
CREATE POLICY "residents_select_tickets" ON public.tickets_mantenimiento
  FOR SELECT TO authenticated
  USING (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

DROP POLICY IF EXISTS "residents_insert_tickets" ON public.tickets_mantenimiento;
CREATE POLICY "residents_insert_tickets" ON public.tickets_mantenimiento
  FOR INSERT TO authenticated
  WITH CHECK (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

-- ── user_roles (2 policies) ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT
  USING (
    is_super_admin()
    OR user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = user_roles.user_id
        AND u.company_id = get_my_company_id()
        AND current_user_role() = ANY(ARRAY['company_owner','admin'])
    )
  );

DROP POLICY IF EXISTS "user_roles_insert" ON public.user_roles;
CREATE POLICY "user_roles_insert" ON public.user_roles
  FOR INSERT
  WITH CHECK (
    is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM app_users u
        WHERE u.id = user_roles.user_id
          AND u.company_id = get_my_company_id()
          AND current_user_role() = ANY(ARRAY['company_owner','admin'])
      )
      AND EXISTS (
        SELECT 1 FROM roles r
        WHERE r.id = user_roles.role_id
          AND (r.is_system = true OR r.company_id = get_my_company_id())
      )
      AND (assigned_by IS NULL OR assigned_by = (SELECT auth.uid()))
    )
  );

-- ── visitantes (2 policies) ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "residents_select_visitantes" ON public.visitantes;
CREATE POLICY "residents_select_visitantes" ON public.visitantes
  FOR SELECT TO authenticated
  USING (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

DROP POLICY IF EXISTS "residents_insert_visitantes" ON public.visitantes;
CREATE POLICY "residents_insert_visitantes" ON public.visitantes
  FOR INSERT TO authenticated
  WITH CHECK (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );
