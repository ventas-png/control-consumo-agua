-- ─── RBAC for agua WRITES (additive, non-regressive) ───────────────────────
-- Until now, water tables (contadores, unidades, tarifas, registros, calidad,
-- servicios_energia) gated INSERT/UPDATE/DELETE on the legacy platform role
-- (app_users.role via has_admin_project_access / has_operator_project_access /
-- current_user_role()). Only SELECT had been moved to user_has_permission().
--
-- That coupling is why "Admin de Agua" had to be app_users.role='admin', which
-- ALSO grants the company-wide exempt bypass (god-mode over condominios + RBAC).
--
-- This migration makes the agua.* RBAC permission keys actually grant water
-- access, so a water admin can be a NON-exempt user that simply holds the
-- "Admin Agua" / "Admin Plataforma" role. It is intentionally ADDITIVE: every
-- existing clause is preserved and we only OR-in a new RBAC clause, so no
-- current user loses access. A follow-up migration can drop the legacy clauses
-- once all users are migrated to RBAC roles.
--
-- Permission key mapping:
--   INSERT  -> agua.<module>.create
--   UPDATE  -> agua.<module>.edit
--   DELETE  -> agua.<module>.change_status   (only admin-tier agua roles hold it)
--   SELECT  -> agua.<module>.view            (added where SELECT was still role-based)
-- The new clause is always tenant-scoped (company_id / project-in-my-company)
-- so it can never widen access across companies. super_admin / company_owner /
-- admin already pass via user_has_permission() too.

-- ─── contadores  (agua.contadores) ──────────────────────────────────────────
DROP POLICY IF EXISTS "contadores_select" ON public.contadores;
CREATE POLICY "contadores_select" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
    OR (
      current_user_role() = 'cliente'
      AND activo = true
      AND EXISTS (
        SELECT 1 FROM public.unidades u
        WHERE u.id = contadores.unidad_id AND u.cliente_id = get_my_cliente_id()
      )
    )
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.contadores.view')))
  );

DROP POLICY IF EXISTS "contadores_insert" ON public.contadores;
CREATE POLICY "contadores_insert" ON public.contadores
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.contadores.create')))
  );

DROP POLICY IF EXISTS "contadores_update" ON public.contadores;
CREATE POLICY "contadores_update" ON public.contadores
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.contadores.edit')))
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.contadores.edit')))
  );

DROP POLICY IF EXISTS "contadores_delete" ON public.contadores;
CREATE POLICY "contadores_delete" ON public.contadores
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.contadores.change_status')))
  );

-- ─── unidades  (platform.unidades) ──────────────────────────────────────────
DROP POLICY IF EXISTS "unidades_select" ON public.unidades;
CREATE POLICY "unidades_select" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id() AND activo = true)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('platform.unidades.view')))
  );

DROP POLICY IF EXISTS "unidades_insert" ON public.unidades;
CREATE POLICY "unidades_insert" ON public.unidades
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('platform.unidades.create')))
  );

DROP POLICY IF EXISTS "unidades_update" ON public.unidades;
CREATE POLICY "unidades_update" ON public.unidades
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('platform.unidades.edit')))
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('platform.unidades.edit')))
  );

DROP POLICY IF EXISTS "unidades_delete" ON public.unidades;
CREATE POLICY "unidades_delete" ON public.unidades
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_company_owner_company_access(company_id)
    OR has_admin_project_access(project_id)
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('platform.unidades.change_status')))
  );

-- ─── tarifas  (agua.tarifas) — project-scoped via projects.company_id ────────
DROP POLICY IF EXISTS "tarifas_select" ON public.tarifas;
CREATE POLICY "tarifas_select" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR has_viewer_project_access(project_id)
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.tarifas.view')))
  );

DROP POLICY IF EXISTS "tarifas_insert" ON public.tarifas;
CREATE POLICY "tarifas_insert" ON public.tarifas
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.tarifas.create')))
  );

DROP POLICY IF EXISTS "tarifas_update" ON public.tarifas;
CREATE POLICY "tarifas_update" ON public.tarifas
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.tarifas.edit')))
  )
  WITH CHECK (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.tarifas.edit')))
  );

DROP POLICY IF EXISTS "tarifas_delete" ON public.tarifas;
CREATE POLICY "tarifas_delete" ON public.tarifas
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR (current_user_role() = 'company_owner' AND EXISTS (
      SELECT 1 FROM public.projects p WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
    ))
    OR has_admin_project_access(project_id)
    OR has_operator_project_access(project_id)
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.tarifas.change_status')))
  );

-- ─── registros (lecturas)  (agua.lecturas) — SELECT already RBAC, keep it ────
DROP POLICY IF EXISTS "registros_insert" ON public.registros;
CREATE POLICY "registros_insert" ON public.registros
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY (ARRAY['admin','super_admin','superadmin','company_owner','operator','operador'])
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.lecturas.create')))
  );

DROP POLICY IF EXISTS "registros_update" ON public.registros;
CREATE POLICY "registros_update" ON public.registros
  FOR UPDATE TO authenticated
  USING (
    (SELECT current_user_role()) = ANY (ARRAY['admin','super_admin','superadmin','company_owner','operator','operador'])
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.lecturas.edit')))
  );

DROP POLICY IF EXISTS "registros_delete" ON public.registros;
CREATE POLICY "registros_delete" ON public.registros
  FOR DELETE TO authenticated
  USING (
    (SELECT current_user_role()) = ANY (ARRAY['admin','super_admin','superadmin','company_owner'])
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id
    )
    OR (project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT get_my_company_id()))
        AND (SELECT public.user_has_permission('agua.lecturas.change_status')))
  );

-- ─── fuentes_agua  (agua.calidad) — SELECT already RBAC, keep it ─────────────
DROP POLICY IF EXISTS "fuentes_agua_insert" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_insert" ON public.fuentes_agua
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.create')))
  );

DROP POLICY IF EXISTS "fuentes_agua_update" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_update" ON public.fuentes_agua
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.edit')))
  )
  WITH CHECK (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.edit')))
  );

DROP POLICY IF EXISTS "fuentes_agua_delete" ON public.fuentes_agua;
CREATE POLICY "fuentes_agua_delete" ON public.fuentes_agua
  FOR DELETE TO authenticated
  USING (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = 'company_owner' AND company_id = get_my_company_id())
    OR (current_user_role() = 'admin' AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.change_status')))
  );

-- ─── registros_calidad  (agua.calidad) — SELECT already RBAC, keep it ────────
DROP POLICY IF EXISTS "registros_calidad_insert" ON public.registros_calidad;
CREATE POLICY "registros_calidad_insert" ON public.registros_calidad
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.create')))
  );

DROP POLICY IF EXISTS "registros_calidad_update" ON public.registros_calidad;
CREATE POLICY "registros_calidad_update" ON public.registros_calidad
  FOR UPDATE TO authenticated
  USING (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.edit')))
  )
  WITH CHECK (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.edit')))
  );

DROP POLICY IF EXISTS "registros_calidad_delete" ON public.registros_calidad;
CREATE POLICY "registros_calidad_delete" ON public.registros_calidad
  FOR DELETE TO authenticated
  USING (
    current_user_role() = ANY (ARRAY['super_admin','superadmin'])
    OR (current_user_role() = ANY (ARRAY['company_owner','admin','operator','operador']) AND company_id = get_my_company_id())
    OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.calidad.change_status')))
  );

-- ─── servicios_energia tables  (agua.servicios_energia) ─────────────────────
-- proveedores_energia / tarifas_energia / fuentes_energia / facturas_energia
-- share the same shape (company_id + project_id; writes were admin-only).
DO $$
DECLARE
  t text;
  energia_tables text[] := ARRAY['proveedores_energia','tarifas_energia','fuentes_energia','facturas_energia'];
BEGIN
  FOREACH t IN ARRAY energia_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          has_super_admin_access()
          OR has_company_owner_company_access(company_id)
          OR has_admin_project_access(project_id)
          OR has_operator_project_access(project_id)
          OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.servicios_energia.view')))
        )$f$, t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          has_super_admin_access()
          OR has_company_owner_company_access(company_id)
          OR has_admin_project_access(project_id)
          OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.servicios_energia.create')))
        )$f$, t || '_insert', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR UPDATE TO authenticated
        USING (
          has_super_admin_access()
          OR has_company_owner_company_access(company_id)
          OR has_admin_project_access(project_id)
          OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.servicios_energia.edit')))
        )
        WITH CHECK (
          has_super_admin_access()
          OR has_company_owner_company_access(company_id)
          OR has_admin_project_access(project_id)
          OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.servicios_energia.edit')))
        )$f$, t || '_update', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (
          has_super_admin_access()
          OR has_company_owner_company_access(company_id)
          OR has_admin_project_access(project_id)
          OR (company_id = (SELECT get_my_company_id()) AND (SELECT public.user_has_permission('agua.servicios_energia.change_status')))
        )$f$, t || '_delete', t);
  END LOOP;
END $$;
