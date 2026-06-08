// Secciones de navegación de 2 niveles del Módulo Completo de Condominios.
// Fuente única compartida por CondominiosSection (cuerpo del módulo) y el
// Sidebar global (que ahora expone las 9 secciones bajo "Manejo Condominios").
// IMPORTANTE: mantener este módulo libre de dependencias pesadas (no importar
// tabRegistry) para no inflar el bundle inicial del sidebar.

export type SectionKey =
  | 'panel' | 'finanzas' | 'residentes' | 'operaciones' | 'instalaciones'
  | 'seguridad' | 'comunidad' | 'administracion' | 'especiales'

export interface SectionDef { id: SectionKey; label: string; icon: string; tabs: string[] }

export const SECTIONS: SectionDef[] = [
  { id: 'panel', label: 'Panel', icon: '📊', tabs: [
    'panel', 'panel_directivo', 'cuadro_mando', 'dashboard_ejecutivo', 'resumen_ejecutivo',
    'informe_ejecutivo', 'informe_mensual', 'indice_calidad', 'dashboard_sostenibilidad',
    'bitacora_actividad', 'gestor_alertas', 'alertas', 'centro_notificaciones', 'graficas_tendencias', 'metricas_servicio',
    'bitacora_eventos', 'reportes', 'kpis_financieros', 'reporte_consolidado',
  ]},
  { id: 'finanzas', label: 'Finanzas', icon: '💰', tabs: [
    'cuotas', 'generacion_cuotas', 'plantillas_cuota', 'recargos_mora', 'reglas_mora',
    'campanas_cobro', 'reporte_deudores', 'mapa_calor_cuotas', 'conciliacion_cobros',
    'estado_cuenta_residente', 'estadocuenta', 'convenios_cuota', 'plan_pago', 'avisos_cobro',
    'cobranza', 'cobranza_judicial', 'presupuesto', 'contabilidad', 'comparativo_presupuesto',
    'comparativo_anual', 'pronostico_financiero', 'simulador_cuotas', 'caja_chica',
    'gestion_fondo', 'fondo_reserva', 'tarifas', 'cargos_adicionales', 'recibos_digitales',
    'cierres', 'cierre_anual', 'historial_saldos', 'notificaciones_enviadas', 'proformas',
    'exportacion', 'centro_costos', 'analisis_cartera',
  ]},
  { id: 'residentes', label: 'Residentes', icon: '🏠', tabs: [
    'tablero_ocupacion', 'directorio_comunidad', 'directorio', 'arrendamientos', 'onboarding',
    'entrega_unidad', 'portal', 'resumen_residente', 'solicitudes', 'solicitudes_renta', 'solicitudes_mudanza', 'vehiculos', 'mascotas',
    'accesos_res', 'control_accesos_qr', 'certificados', 'manual_residente', 'mapa_unidades',
    'scoring_unidades',
  ]},
  { id: 'operaciones', label: 'Operaciones', icon: '🔧', tabs: [
    'mantenimiento', 'kanban_tickets', 'gantt_mantenimiento', 'calendario_mantenimiento',
    'mant_preventivo', 'bitacora_manto', 'inventario', 'suministros', 'tareas_cond',
    'ordenes_compra', 'eval_proveedor', 'proveedores', 'obras', 'proyectos_cond',
    'permisos_obra', 'garantias', 'checklist_areas', 'prog_limpieza', 'control_plagas',
    'prestamos',
  ]},
  { id: 'instalaciones', label: 'Instalaciones', icon: '🏗️', tabs: [
    'amenidades', 'utilizacion_amenidades', 'parqueos', 'estac_visita', 'bodegas', 'llaves',
    'equipos', 'consumo_energia', 'medidores_unidad', 'control_piscina', 'jardineria',
    'elevadores', 'cisternas', 'generador', 'incendio', 'camaras', 'gas', 'integracion_agua',
  ]},
  { id: 'seguridad', label: 'Seguridad', icon: '🛡️', tabs: [
    'visitantes', 'analisis_visitantes', 'vis_frecuentes', 'seguridad', 'rutas_ronda',
    'plantillas_cargo', 'tareas_personal', 'revision_tareas', 'desempeno_personal',
    'paqueteria', 'objetos', 'incidentes', 'reclamos', 'bitacora_guardia', 'presencia',
    'panel_turno', 'emergencias',
  ]},
  { id: 'comunidad', label: 'Comunidad', icon: '🏘️', tabs: [
    'comunidad', 'infracciones', 'sanciones', 'gestion_conflictos', 'asambleas',
    'asamblea_digital', 'votaciones', 'junta', 'actas', 'acuerdos', 'eventos_comunidad',
    'agenda', 'cumpleanos', 'programa_actividades', 'buzon_sugerencias', 'encuestas', 'encuesta_dashboard',
    'comunicados', 'recordatorios', 'comunicacion_condominios',
  ]},
  { id: 'administracion', label: 'Administración', icon: '📋', tabs: [
    'documentos', 'reglamento', 'firmas', 'personal', 'capacitacion_personal',
    'correspondencia', 'libro_novedades', 'notas_admin', 'reg_autoridades', 'bitacora_acciones',
    'vencimientos_criticos', 'polizas', 'inspecciones', 'propuestas', 'memoria',
    'automatizaciones', 'plantillas_mensaje', 'flujo_aprobacion', 'envio_masivo',
    'notificaciones', 'configuracion_cond', 'configuracion', 'multi_condominio',
  ]},
  { id: 'especiales', label: 'Especiales', icon: '⭐', tabs: [
    'str', 'locales', 'housekeeping', 'concierge', 'residuos', 'sostenibilidad',
  ]},
]

const SECTION_BY_TAB: Record<string, SectionKey> = (() => {
  const map: Record<string, SectionKey> = {}
  for (const sec of SECTIONS) for (const tid of sec.tabs) map[tid] = sec.id
  return map
})()

// Sección que contiene un tab. Tabs desconocidos / undefined caen en 'panel'.
export function sectionForTab(tabId: string | undefined): SectionKey {
  if (!tabId) return 'panel'
  return SECTION_BY_TAB[tabId] ?? 'panel'
}

// Ruta del tab dentro del Módulo Completo. Espejo de tabToPath() en tabRegistry;
// duplicado mínimo e intencional para mantener el sidebar sin deps pesadas.
export function condoTabPath(tabId: string): string {
  return tabId === 'panel' ? '/condominios' : `/condominios/${tabId}`
}

// Sección activa derivada del pathname. `/condominios/panel` es el dashboard
// independiente (no es una sección del módulo) → null. Cualquier otra ruta del
// módulo se mapea a la sección que contiene su tab.
export function sectionForPath(pathname: string): SectionKey | null {
  const p = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (p === '/condominios') return 'panel'
  if (p === '/condominios/panel') return null
  if (p.startsWith('/condominios/')) {
    const seg = p.slice('/condominios/'.length).split('/')[0]
    return sectionForTab(seg)
  }
  return null
}
