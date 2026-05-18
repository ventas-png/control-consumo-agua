-- ─── Seed 8 system roles for condominios ────────────────────────────────────
-- Mirrors CONDOMINIOS_TAB_ACCESS in src/lib/condominiosRoles.ts so existing
-- behavior is preserved.

-- 1. Insert system roles (idempotent via ON CONFLICT)
INSERT INTO public.roles (id, company_id, name, description, is_system, color) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Administrador General', 'Acceso completo a todas las secciones y tabs', true, '#0ea5e9'),
  ('00000000-0000-0000-0000-000000000002', NULL, 'Junta Directiva',       'Panel estratégico, finanzas (lectura), gobernanza y documentos', true, '#8b5cf6'),
  ('00000000-0000-0000-0000-000000000003', NULL, 'Finanzas / Contador',    'Sección Finanzas completa, KPIs financieros y configuración', true, '#10b981'),
  ('00000000-0000-0000-0000-000000000004', NULL, 'Operaciones / Mantenimiento', 'Operaciones e instalaciones completas, alertas y documentos técnicos', true, '#f59e0b'),
  ('00000000-0000-0000-0000-000000000005', NULL, 'Seguridad / Guardia',    'Sección Seguridad completa, directorio de residentes y accesos', true, '#ef4444'),
  ('00000000-0000-0000-0000-000000000006', NULL, 'Comunidad / Relaciones', 'Residentes y comunidad completos, comunicaciones y documentos', true, '#06b6d4'),
  ('00000000-0000-0000-0000-000000000007', NULL, 'Recepción / Conserje',   'Visitantes, paquetería, directorio, amenidades y estacionamiento', true, '#ec4899'),
  ('00000000-0000-0000-0000-000000000008', NULL, 'Solo Visualizador',      'Dashboards y reportes del panel únicamente, sin edición', true, '#64748b')
ON CONFLICT (company_id, name) DO NOTHING;

-- 2. Helper: bulk insert role_permissions from an array of tab IDs
--    Permission keys are 'condominios.tab.' || tab_id
DO $$
DECLARE
  rid_admin      uuid := '00000000-0000-0000-0000-000000000001';
  rid_junta      uuid := '00000000-0000-0000-0000-000000000002';
  rid_finanzas   uuid := '00000000-0000-0000-0000-000000000003';
  rid_operaciones uuid := '00000000-0000-0000-0000-000000000004';
  rid_seguridad  uuid := '00000000-0000-0000-0000-000000000005';
  rid_comunidad  uuid := '00000000-0000-0000-0000-000000000006';
  rid_recepcion  uuid := '00000000-0000-0000-0000-000000000007';
  rid_visualizador uuid := '00000000-0000-0000-0000-000000000008';
BEGIN
  -- Administrador General: all permissions
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_admin, p.key, 'allow'
  FROM public.permissions p
  WHERE p.key LIKE 'condominios.tab.%'
  ON CONFLICT DO NOTHING;

  -- Junta Directiva
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_junta, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    -- PANEL_ESTRATEGICO
    'panel','panel_directivo','cuadro_mando','dashboard_ejecutivo','resumen_ejecutivo',
    'informe_ejecutivo','informe_mensual','indice_calidad','dashboard_sostenibilidad',
    'graficas_tendencias','metricas_servicio','reportes','kpis_financieros','reporte_consolidado',
    -- Finanzas estratégica
    'presupuesto','contabilidad','comparativo_presupuesto','comparativo_anual',
    'pronostico_financiero','simulador_cuotas','gestion_fondo','fondo_reserva',
    'historial_saldos','exportacion','centro_costos','analisis_cartera',
    'reporte_deudores','estadocuenta','cuotas',
    -- Residentes vista general
    'tablero_ocupacion','directorio_comunidad','mapa_unidades','scoring_unidades',
    -- Comunidad gobernanza
    'asambleas','asamblea_digital','votaciones','junta','actas','acuerdos',
    'eventos_comunidad','agenda',
    -- Administración gobernanza
    'documentos','reglamento','propuestas','memoria','polizas',
    'vencimientos_criticos','reg_autoridades','inspecciones','multi_condominio','firmas'
  ]) AS tab
  ON CONFLICT DO NOTHING;

  -- Finanzas
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_finanzas, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    -- PANEL_ESTRATEGICO + bitacora_actividad
    'panel','panel_directivo','cuadro_mando','dashboard_ejecutivo','resumen_ejecutivo',
    'informe_ejecutivo','informe_mensual','indice_calidad','dashboard_sostenibilidad',
    'graficas_tendencias','metricas_servicio','reportes','kpis_financieros','reporte_consolidado',
    'bitacora_actividad',
    -- TODAS_FINANZAS
    'cuotas','generacion_cuotas','plantillas_cuota','recargos_mora','reglas_mora',
    'campanas_cobro','reporte_deudores','mapa_calor_cuotas','conciliacion_cobros',
    'estado_cuenta_residente','estadocuenta','convenios_cuota','plan_pago','avisos_cobro',
    'cobranza','cobranza_judicial','presupuesto','contabilidad','comparativo_presupuesto',
    'comparativo_anual','pronostico_financiero','simulador_cuotas','caja_chica',
    'gestion_fondo','fondo_reserva','tarifas','cargos_adicionales','recibos_digitales',
    'cierres','cierre_anual','historial_saldos','notificaciones_enviadas','proformas',
    'exportacion','centro_costos','analisis_cartera',
    -- Admin/docs financieros
    'documentos','correspondencia','bitacora_acciones','configuracion_cond','notificaciones',
    'comunicacion_condominios'
  ]) AS tab
  ON CONFLICT DO NOTHING;

  -- Operaciones / Mantenimiento
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_operaciones, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    -- PANEL_OPERATIVO
    'panel','alertas','gestor_alertas','bitacora_actividad','bitacora_eventos','centro_notificaciones',
    -- TODAS_OPERACIONES
    'mantenimiento','kanban_tickets','gantt_mantenimiento','calendario_mantenimiento',
    'mant_preventivo','bitacora_manto','inventario','suministros','tareas_cond',
    'ordenes_compra','eval_proveedor','proveedores','obras','proyectos_cond',
    'permisos_obra','garantias','checklist_areas','prog_limpieza','control_plagas','prestamos',
    -- TODAS_INSTALACIONES
    'amenidades','utilizacion_amenidades','parqueos','estac_visita','bodegas','llaves',
    'equipos','consumo_energia','medidores_unidad','control_piscina','jardineria',
    'elevadores','cisternas','generador','incendio','camaras','gas','integracion_agua',
    -- Admin técnico
    'documentos','bitacora_acciones','vencimientos_criticos','polizas',
    'inspecciones','automatizaciones','personal','capacitacion_personal',
    'comunicacion_condominios'
  ]) AS tab
  ON CONFLICT DO NOTHING;

  -- Seguridad / Guardia
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_seguridad, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    -- PANEL_OPERATIVO
    'panel','alertas','gestor_alertas','bitacora_actividad','bitacora_eventos','centro_notificaciones',
    -- TODAS_SEGURIDAD
    'visitantes','analisis_visitantes','vis_frecuentes','seguridad','rutas_ronda',
    'plantillas_cargo','tareas_personal','revision_tareas','desempeno_personal',
    'paqueteria','objetos','incidentes','reclamos','bitacora_guardia','presencia',
    'panel_turno','emergencias',
    -- Residentes acceso y directorio
    'directorio','directorio_comunidad','vehiculos','mascotas',
    'accesos_res','control_accesos_qr','solicitudes',
    -- Instalaciones seguridad física
    'parqueos','estac_visita','llaves','camaras','amenidades','bodegas',
    -- Admin
    'bitacora_acciones','libro_novedades'
  ]) AS tab
  ON CONFLICT DO NOTHING;

  -- Comunidad / Relaciones
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_comunidad, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    -- PANEL_MINIMO
    'panel','alertas','centro_notificaciones',
    -- TODAS_RESIDENTES
    'tablero_ocupacion','directorio_comunidad','directorio','arrendamientos','onboarding',
    'entrega_unidad','portal','resumen_residente','solicitudes','vehiculos','mascotas',
    'accesos_res','control_accesos_qr','certificados','manual_residente','mapa_unidades','scoring_unidades',
    -- TODA_COMUNIDAD
    'comunidad','infracciones','sanciones','gestion_conflictos','asambleas',
    'asamblea_digital','votaciones','junta','actas','acuerdos','eventos_comunidad',
    'agenda','cumpleanos','programa_actividades','buzon_sugerencias','encuestas',
    'encuesta_dashboard','comunicados','recordatorios','comunicacion_condominios',
    -- Admin comunicaciones
    'documentos','reglamento','correspondencia','libro_novedades',
    'plantillas_mensaje','envio_masivo','notificaciones','flujo_aprobacion'
  ]) AS tab
  ON CONFLICT DO NOTHING;

  -- Recepción / Conserje
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_recepcion, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    -- PANEL_MINIMO
    'panel','alertas','centro_notificaciones',
    -- Seguridad: visitantes y paquetería
    'visitantes','analisis_visitantes','vis_frecuentes','paqueteria','objetos',
    'incidentes','bitacora_guardia','panel_turno','emergencias','reclamos',
    -- Residentes: directorio y accesos
    'directorio','directorio_comunidad','vehiculos','mascotas','solicitudes',
    'accesos_res','control_accesos_qr','certificados','portal',
    -- Instalaciones: amenidades y parking
    'amenidades','utilizacion_amenidades','parqueos','estac_visita','llaves',
    -- Comunidad: comunicaciones
    'comunicados','recordatorios','agenda'
  ]) AS tab
  ON CONFLICT DO NOTHING;

  -- Solo Visualizador
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
  SELECT rid_visualizador, 'condominios.tab.' || tab, 'allow'
  FROM unnest(ARRAY[
    'panel','dashboard_ejecutivo','resumen_ejecutivo','graficas_tendencias',
    'reportes','kpis_financieros','reporte_consolidado','indice_calidad','metricas_servicio'
  ]) AS tab
  ON CONFLICT DO NOTHING;
END $$;
