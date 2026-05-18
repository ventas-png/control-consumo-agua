-- ─── RBAC RLS hardening: bulk condominios tables (Phase A) ──────────────────
-- Replaces the generic company_id-only policies with permission-gated policies
-- on the remaining condominios tables. Preserves any cliente_* policies
-- (resident portal access) — those have distinct naming and are not dropped.
--
-- Strategy: a dynamic helper function (kept for future tables) detects the
-- table's existing CRUD policy names (anything ending in _select|_insert|
-- _update|_delete that doesn't contain "cliente") and replaces them with
-- new RBAC-aware policies gated by user_has_permission(perm_key).

-- ─── Helper: install standard 4-policy RBAC set on a company-scoped table ───
CREATE OR REPLACE FUNCTION public.rbac_install_company_policies(
  tbl text,
  perm_key text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pol record;
  existing_ops text[];
  had_select boolean := false;
  had_insert boolean := false;
  had_update boolean := false;
  had_delete boolean := false;
BEGIN
  -- Detect which operations had policies BEFORE we drop them. This preserves
  -- existing immutability patterns (e.g., audit-style tables with no UPDATE).
  SELECT array_agg(DISTINCT cmd) INTO existing_ops
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = tbl
    AND policyname ~ '_(select|insert|update|delete)$'
    AND policyname NOT ILIKE '%cliente%';

  IF existing_ops IS NOT NULL THEN
    had_select := 'SELECT' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_insert := 'INSERT' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_update := 'UPDATE' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
    had_delete := 'DELETE' = ANY(existing_ops) OR 'ALL' = ANY(existing_ops);
  ELSE
    -- No prior CRUD policies → assume the table was fully open or new;
    -- install all four operations.
    had_select := true; had_insert := true; had_update := true; had_delete := true;
  END IF;

  -- Drop existing CRUD policies (skip cliente-specific ones)
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = tbl
      AND policyname ~ '_(select|insert|update|delete)$'
      AND policyname NOT ILIKE '%cliente%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
  END LOOP;

  IF had_select THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_select', tbl, perm_key);
  END IF;

  IF had_insert THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          public.is_super_admin()
          OR (company_id = public.get_my_company_id()
              AND public.user_has_permission(%L))
        )
    $pol$, tbl || '_insert', tbl, perm_key);
  END IF;

  IF had_update THEN
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
    $pol$, tbl || '_update', tbl, perm_key, perm_key);
  END IF;

  IF had_delete THEN
    EXECUTE format($pol$
      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (
          public.is_super_admin()
          OR (public.current_user_role() = ANY(ARRAY['company_owner','admin'])
              AND company_id = public.get_my_company_id())
        )
    $pol$, tbl || '_delete', tbl);
  END IF;
END;
$$;

-- ─── Apply to all condominios tables ────────────────────────────────────────
-- Mapping: table → canonical permission key. Each table gates on the most
-- representative tab. Custom roles (company-defined) can override by granting
-- the specific permission needed.

DO $$
DECLARE
  mapping text[][] := ARRAY[
    -- FINANZAS
    ['campanas_cobro',           'condominios.tab.campanas_cobro'],
    ['cierres_anuales',          'condominios.tab.cierre_anual'],
    ['cierres_mensuales',        'condominios.tab.cierres'],
    ['cobranza_judicial',        'condominios.tab.cobranza_judicial'],
    ['convenios_cuota_cond',     'condominios.tab.convenios_cuota'],
    ['fondo_reserva_condominio', 'condominios.tab.fondo_reserva'],
    ['gestion_cobranza',         'condominios.tab.cobranza'],
    ['planes_pago_condominio',   'condominios.tab.plan_pago'],
    ['recargos_mora',            'condominios.tab.recargos_mora'],
    ['recibos_digitales',        'condominios.tab.recibos_digitales'],
    ['reglas_mora_config',       'condominios.tab.reglas_mora'],
    ['avisos_cobro',             'condominios.tab.avisos_cobro'],
    ['caja_chica',               'condominios.tab.caja_chica'],
    ['movimientos_caja',         'condominios.tab.caja_chica'],
    ['cargos_adicionales_unidad','condominios.tab.cargos_adicionales'],
    ['historial_saldos_unidad',  'condominios.tab.historial_saldos'],
    ['tarifas_condominio',       'condominios.tab.tarifas'],
    ['informes_mensuales',       'condominios.tab.informe_mensual'],
    -- OPERACIONES / MANTENIMIENTO
    ['tickets_mantenimiento',    'condominios.tab.mantenimiento'],
    ['ejecuciones_mantenimiento','condominios.tab.mantenimiento'],
    ['comentarios_ticket',       'condominios.tab.kanban_tickets'],
    ['planes_mantenimiento',     'condominios.tab.mant_preventivo'],
    ['bitacora_manto',           'condominios.tab.bitacora_manto'],
    ['inventario_condominio',    'condominios.tab.inventario'],
    ['suministros_condominio',   'condominios.tab.suministros'],
    ['movimientos_suministro',   'condominios.tab.suministros'],
    ['tareas_condominio',        'condominios.tab.tareas_cond'],
    ['contratos_proveedores',    'condominios.tab.proveedores'],
    ['evaluaciones_proveedor',   'condominios.tab.eval_proveedor'],
    ['obras_mejoras',            'condominios.tab.obras'],
    ['proyectos_condominio',     'condominios.tab.proyectos_cond'],
    ['permisos_obra_unidad',     'condominios.tab.permisos_obra'],
    ['garantias_equipo',         'condominios.tab.garantias'],
    ['checklist_areas',          'condominios.tab.checklist_areas'],
    ['programacion_limpieza',    'condominios.tab.prog_limpieza'],
    ['control_plagas',           'condominios.tab.control_plagas'],
    ['prestamos_equipo',         'condominios.tab.prestamos'],
    -- INSTALACIONES
    ['amenidades',               'condominios.tab.amenidades'],
    ['amenidades_bloqueos',      'condominios.tab.amenidades'],
    ['reservas_amenidades',      'condominios.tab.amenidades'],
    ['parqueos_condominio',      'condominios.tab.parqueos'],
    ['estacionamiento_visita',   'condominios.tab.estac_visita'],
    ['bodegas_condominio',       'condominios.tab.bodegas'],
    ['llaves_condominio',        'condominios.tab.llaves'],
    ['equipos_comunes',          'condominios.tab.equipos'],
    ['consumo_energia_areas',    'condominios.tab.consumo_energia'],
    ['medidores_unidad',         'condominios.tab.medidores_unidad'],
    ['mantenimiento_cisterna',   'condominios.tab.cisternas'],
    ['mantenimiento_jardineria', 'condominios.tab.jardineria'],
    ['control_piscina',          'condominios.tab.control_piscina'],
    ['incidencias_elevador',     'condominios.tab.elevadores'],
    ['control_generador',        'condominios.tab.generador'],
    ['control_sistema_incendio', 'condominios.tab.incendio'],
    ['control_camaras_seguridad','condominios.tab.camaras'],
    ['lecturas_medidor_gas',     'condominios.tab.gas'],
    -- SEGURIDAD
    ['visitantes',               'condominios.tab.visitantes'],
    ['visitas_frecuentes',       'condominios.tab.vis_frecuentes'],
    ['paquetes_recibidos',       'condominios.tab.paqueteria'],
    ['objetos_perdidos',         'condominios.tab.objetos'],
    ['incidentes_seguridad',     'condominios.tab.incidentes'],
    ['reclamos_condominio',      'condominios.tab.reclamos'],
    ['rondas_seguridad',         'condominios.tab.rutas_ronda'],
    ['bitacora_guardia',         'condominios.tab.bitacora_guardia'],
    ['novedades_seguridad',      'condominios.tab.libro_novedades'],
    ['libro_novedades',          'condominios.tab.libro_novedades'],
    ['presencia_personal',       'condominios.tab.presencia'],
    ['contactos_emergencia',     'condominios.tab.emergencias'],
    -- RESIDENTES
    ['accesos_residentes',       'condominios.tab.accesos_res'],
    ['historial_residentes',     'condominios.tab.directorio'],
    ['manual_residente_cond',    'condominios.tab.manual_residente'],
    ['mudanzas',                 'condominios.tab.solicitudes_mudanza'],
    ['onboarding_residentes',    'condominios.tab.onboarding'],
    ['solicitudes_residente',    'condominios.tab.solicitudes'],
    ['vehiculos_residentes',     'condominios.tab.vehiculos'],
    ['mascotas',                 'condominios.tab.mascotas'],
    ['entrega_unidades',         'condominios.tab.entrega_unidad'],
    ['contratos_arrendamiento',  'condominios.tab.arrendamientos'],
    -- COMUNIDAD
    ['actas_reunion',            'condominios.tab.actas'],
    ['anuncios_comunidad',       'condominios.tab.comunicados'],
    ['comunicados_condominio',   'condominios.tab.comunicados'],
    ['asambleas',                'condominios.tab.asambleas'],
    ['junta_directiva',          'condominios.tab.junta'],
    ['propuestas_inversion',     'condominios.tab.propuestas'],
    ['votos',                    'condominios.tab.votaciones'],
    ['votaciones',               'condominios.tab.votaciones'],
    ['eventos_comunidad',        'condominios.tab.eventos_comunidad'],
    ['programa_actividades',     'condominios.tab.programa_actividades'],
    ['registro_asistentes_evento','condominios.tab.eventos_comunidad'],
    ['infracciones_condominio',  'condominios.tab.infracciones'],
    ['sanciones_condominio',     'condominios.tab.sanciones'],
    ['seguimiento_acuerdos',     'condominios.tab.acuerdos'],
    ['agenda_operativa',         'condominios.tab.agenda'],
    ['eventos_calendario',       'condominios.tab.agenda'],
    -- SERVICIOS RESIDENTES
    ['encuestas',                'condominios.tab.encuestas'],
    ['respuestas_encuesta',      'condominios.tab.encuestas'],
    ['sugerencias_condominio',   'condominios.tab.buzon_sugerencias'],
    ['servicios_housekeeping',   'condominios.tab.housekeeping'],
    ['reservas_str',             'condominios.tab.str'],
    ['solicitudes_concierge',    'condominios.tab.concierge'],
    ['locales_comerciales',      'condominios.tab.locales'],
    -- ADMINISTRACIÓN
    ['documentos_condominio',    'condominios.tab.documentos'],
    ['correspondencia_condominio','condominios.tab.correspondencia'],
    ['notas_admin',              'condominios.tab.notas_admin'],
    ['reglamento_condominio',    'condominios.tab.reglamento'],
    ['firmas_digitales',         'condominios.tab.firmas'],
    ['polizas_seguro',           'condominios.tab.polizas'],
    ['inspecciones_normativas',  'condominios.tab.inspecciones'],
    ['vencimientos_extra',       'condominios.tab.vencimientos_criticos'],
    ['registro_autoridades',     'condominios.tab.reg_autoridades'],
    ['registros_residuos',       'condominios.tab.residuos'],
    ['memoria_labores',          'condominios.tab.memoria'],
    ['solicitudes_certificado',  'condominios.tab.certificados'],
    ['personal_condominio',      'condominios.tab.personal'],
    ['capacitacion_personal_cond','condominios.tab.capacitacion_personal'],
    ['configuracion_condominio', 'condominios.tab.configuracion_cond'],
    ['notificaciones_enviadas',  'condominios.tab.notificaciones_enviadas'],
    ['recordatorios_condominio', 'condominios.tab.recordatorios'],
    ['reglas_notificacion',      'condominios.tab.automatizaciones'],
    ['automatizaciones_cond',    'condominios.tab.automatizaciones'],
    ['plantillas_mensaje_cond',  'condominios.tab.plantillas_mensaje'],
    ['flujo_aprobacion_cond',    'condominios.tab.flujo_aprobacion'],
    ['alertas_condominio',       'condominios.tab.alertas'],
    ['bitacora_acciones',        'condominios.tab.bitacora_acciones']
  ];
  i int;
  tbl text;
  pkey text;
BEGIN
  FOR i IN 1..array_length(mapping, 1) LOOP
    tbl := mapping[i][1];
    pkey := mapping[i][2];
    -- Skip if table doesn't exist (defensive)
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
      RAISE NOTICE 'Skipping %, table does not exist', tbl;
      CONTINUE;
    END IF;
    PERFORM public.rbac_install_company_policies(tbl, pkey);
  END LOOP;
END $$;

-- ─── Special cases: tables without company_id (need parent join) ────────────

-- puntos_asamblea: company derived via asambleas.company_id
DROP POLICY IF EXISTS "puntos_asamblea_select" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_asamblea_insert" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_asamblea_update" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_asamblea_delete" ON public.puntos_asamblea;

CREATE POLICY "puntos_asamblea_select" ON public.puntos_asamblea
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.asambleas')
    )
  );

CREATE POLICY "puntos_asamblea_insert" ON public.puntos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.asambleas')
    )
  );

CREATE POLICY "puntos_asamblea_update" ON public.puntos_asamblea
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.asambleas')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.asambleas')
    )
  );

CREATE POLICY "puntos_asamblea_delete" ON public.puntos_asamblea
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );

-- votos_asamblea: company derived via puntos_asamblea -> asambleas
DROP POLICY IF EXISTS "votos_asamblea_select" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_asamblea_insert" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_asamblea_update" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_asamblea_delete" ON public.votos_asamblea;

CREATE POLICY "votos_asamblea_select" ON public.votos_asamblea
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.puntos_asamblea p
      JOIN public.asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.votaciones')
    )
  );

CREATE POLICY "votos_asamblea_insert" ON public.votos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.puntos_asamblea p
      JOIN public.asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.votaciones')
    )
  );

CREATE POLICY "votos_asamblea_update" ON public.votos_asamblea
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.puntos_asamblea p
      JOIN public.asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.votaciones')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.puntos_asamblea p
      JOIN public.asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.votaciones')
    )
  );

CREATE POLICY "votos_asamblea_delete" ON public.votos_asamblea
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.puntos_asamblea p
      JOIN public.asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );

-- huespedes_str: company derived via reservas_str
-- Also drop the legacy permissive "company_access" FOR ALL policy (20260514000002)
-- which was not regex-matched by the helper (no _select|insert|update|delete suffix).
DROP POLICY IF EXISTS "company_access"         ON public.huespedes_str;
DROP POLICY IF EXISTS "huespedes_str_select"   ON public.huespedes_str;
DROP POLICY IF EXISTS "huespedes_str_insert"   ON public.huespedes_str;
DROP POLICY IF EXISTS "huespedes_str_update"   ON public.huespedes_str;
DROP POLICY IF EXISTS "huespedes_str_delete"   ON public.huespedes_str;

CREATE POLICY "huespedes_str_select" ON public.huespedes_str
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.str')
    )
  );

CREATE POLICY "huespedes_str_insert" ON public.huespedes_str
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.str')
    )
  );

CREATE POLICY "huespedes_str_update" ON public.huespedes_str
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.str')
    )
  )
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.str')
    )
  );

CREATE POLICY "huespedes_str_delete" ON public.huespedes_str
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );
