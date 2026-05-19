-- ─── RBAC RLS hardening: condominios tables Phase 2 ─────────────────────────
-- Phase 1 (20260518000010) covered ~110 tables. This migration covers the
-- remaining 11 tables that still had only company_id isolation, replacing
-- them with permission-gated policies consistent with the Phase 1 pattern.

-- ─── Group A: tables with company_id ─────────────────────────────────────────
-- Drop legacy CRUD policies (cliente_* policies are preserved) and install
-- the standard 4-policy RBAC set.

DO $$
DECLARE
  mapping text[][] := ARRAY[
    ['asambleas_digital',      'condominios.tab.asamblea_digital'],
    ['convenios_pago',         'condominios.tab.convenios_cuota'],
    ['fondo_reserva',          'condominios.tab.fondo_reserva'],
    ['generacion_cuotas_log',  'condominios.tab.generacion_cuotas'],
    ['plantillas_cuota',       'condominios.tab.plantillas_cuota'],
    ['plantillas_tarea_cargo', 'condominios.tab.plantillas_cargo'],
    ['proformas_condominio',   'condominios.tab.proformas']
  ];
  i int;
  tbl text;
  pkey text;
  pol record;
BEGIN
  FOR i IN 1..array_length(mapping, 1) LOOP
    tbl  := mapping[i][1];
    pkey := mapping[i][2];

    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
      RAISE NOTICE 'Skipping %, table does not exist', tbl;
      CONTINUE;
    END IF;

    -- Drop legacy CRUD policies (any cliente_* are preserved)
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
        AND policyname ~ '_(select|insert|update|delete|sel|ins|upd|del)$'
        AND policyname NOT ILIKE '%cliente%'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
    END LOOP;

    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_select', tbl, pkey);

    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_insert', tbl, pkey);

    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR UPDATE TO authenticated
        USING (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
        WITH CHECK (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_update', tbl, pkey, pkey);

    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (
          public.is_super_admin()
          OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
              AND company_id = public.get_my_company_id())
        )
    $pol$, tbl || '_delete', tbl);
  END LOOP;
END $$;

-- ─── Group B: areas_condominio (foundational lookup) ─────────────────────────
-- Referenced by puntos_control_ruta.area_id, tareas_bloque.area_id, and likely
-- other modules. SELECT is open to any company member so cross-module joins
-- work; writes are gated on checklist_areas (the canonical management tab).

DROP POLICY IF EXISTS "areas_condominio_select" ON public.areas_condominio;
DROP POLICY IF EXISTS "areas_condominio_insert" ON public.areas_condominio;
DROP POLICY IF EXISTS "areas_condominio_update" ON public.areas_condominio;
DROP POLICY IF EXISTS "areas_condominio_delete" ON public.areas_condominio;

CREATE POLICY "areas_condominio_select" ON public.areas_condominio
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR company_id = public.get_my_company_id()
  );

CREATE POLICY "areas_condominio_insert" ON public.areas_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.checklist_areas'))
  );

CREATE POLICY "areas_condominio_update" ON public.areas_condominio
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.checklist_areas'))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.checklist_areas'))
  );

CREATE POLICY "areas_condominio_delete" ON public.areas_condominio
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = public.get_my_company_id())
  );

-- ─── Group C: tables without company_id (parent join) ────────────────────────

-- puntos_control_ruta: company derived via rutas_ronda
DROP POLICY IF EXISTS "puntos_control_ruta_select" ON public.puntos_control_ruta;
DROP POLICY IF EXISTS "puntos_control_ruta_insert" ON public.puntos_control_ruta;
DROP POLICY IF EXISTS "puntos_control_ruta_update" ON public.puntos_control_ruta;
DROP POLICY IF EXISTS "puntos_control_ruta_delete" ON public.puntos_control_ruta;

CREATE POLICY "puntos_control_ruta_select" ON public.puntos_control_ruta
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rutas_ronda r
      WHERE r.id = puntos_control_ruta.ruta_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  );

CREATE POLICY "puntos_control_ruta_insert" ON public.puntos_control_ruta
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rutas_ronda r
      WHERE r.id = puntos_control_ruta.ruta_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  );

CREATE POLICY "puntos_control_ruta_update" ON public.puntos_control_ruta
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rutas_ronda r
      WHERE r.id = puntos_control_ruta.ruta_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rutas_ronda r
      WHERE r.id = puntos_control_ruta.ruta_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  );

CREATE POLICY "puntos_control_ruta_delete" ON public.puntos_control_ruta
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rutas_ronda r
      WHERE r.id = puntos_control_ruta.ruta_id
        AND r.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );

-- tareas_bloque: company derived via bloques_turno
DROP POLICY IF EXISTS "tareas_bloque_select" ON public.tareas_bloque;
DROP POLICY IF EXISTS "tareas_bloque_insert" ON public.tareas_bloque;
DROP POLICY IF EXISTS "tareas_bloque_update" ON public.tareas_bloque;
DROP POLICY IF EXISTS "tareas_bloque_delete" ON public.tareas_bloque;

CREATE POLICY "tareas_bloque_select" ON public.tareas_bloque
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  );

CREATE POLICY "tareas_bloque_insert" ON public.tareas_bloque
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  );

CREATE POLICY "tareas_bloque_update" ON public.tareas_bloque
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  );

CREATE POLICY "tareas_bloque_delete" ON public.tareas_bloque
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );

-- visitas_control: company derived via rondas_seguridad
DROP POLICY IF EXISTS "visitas_control_select" ON public.visitas_control;
DROP POLICY IF EXISTS "visitas_control_insert" ON public.visitas_control;
DROP POLICY IF EXISTS "visitas_control_update" ON public.visitas_control;
DROP POLICY IF EXISTS "visitas_control_delete" ON public.visitas_control;

CREATE POLICY "visitas_control_select" ON public.visitas_control
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rondas_seguridad r
      WHERE r.id = visitas_control.ronda_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  );

CREATE POLICY "visitas_control_insert" ON public.visitas_control
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rondas_seguridad r
      WHERE r.id = visitas_control.ronda_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  );

CREATE POLICY "visitas_control_update" ON public.visitas_control
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rondas_seguridad r
      WHERE r.id = visitas_control.ronda_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rondas_seguridad r
      WHERE r.id = visitas_control.ronda_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.rutas_ronda')
    )
  );

CREATE POLICY "visitas_control_delete" ON public.visitas_control
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.rondas_seguridad r
      WHERE r.id = visitas_control.ronda_id
        AND r.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );
