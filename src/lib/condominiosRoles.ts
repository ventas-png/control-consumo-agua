import type { CondominiosRole } from '../types'

export interface CondominiosRoleDef {
  id: CondominiosRole
  label: string
  description: string
  color: string
}

export const CONDOMINIOS_ROLES: CondominiosRoleDef[] = [
  {
    id: 'administrador_general',
    label: 'Administrador General',
    description: 'Acceso completo a todas las secciones y tabs',
    color: '#1B3B36',
  },
  {
    id: 'junta_directiva',
    label: 'Junta Directiva',
    description: 'Panel estratégico, finanzas (lectura), gobernanza y documentos',
    color: '#B96A3F',
  },
  {
    id: 'finanzas',
    label: 'Finanzas / Contador',
    description: 'Sección Finanzas completa, KPIs financieros y configuración',
    color: '#10b981',
  },
  {
    id: 'operaciones',
    label: 'Operaciones / Mantenimiento',
    description: 'Operaciones e instalaciones completas, alertas y documentos técnicos',
    color: '#f59e0b',
  },
  {
    id: 'seguridad',
    label: 'Seguridad / Guardia',
    description: 'Sección Seguridad completa, directorio de residentes y accesos',
    color: '#ef4444',
  },
  {
    id: 'comunidad',
    label: 'Comunidad / Relaciones',
    description: 'Residentes y comunidad completos, comunicaciones y documentos',
    color: '#577B69',
  },
  {
    id: 'recepcion',
    label: 'Recepción / Conserje',
    description: 'Visitantes, paquetería, directorio, amenidades y estacionamiento',
    color: '#ec4899',
  },
  {
    id: 'visualizador',
    label: 'Solo Visualizador',
    description: 'Dashboards y reportes del panel únicamente, sin edición',
    color: '#7E9389',
  },
]

// ─── Tab access sets per role ────────────────────────────────────────────────
// null = full access (all tabs visible)

const PANEL_ESTRATEGICO = [
  'panel', 'panel_directivo', 'cuadro_mando', 'dashboard_ejecutivo', 'resumen_ejecutivo',
  'informe_ejecutivo', 'informe_mensual', 'indice_calidad', 'dashboard_sostenibilidad',
  'graficas_tendencias', 'metricas_servicio', 'reportes', 'kpis_financieros', 'reporte_consolidado',
]

const PANEL_OPERATIVO = [
  'panel', 'alertas', 'gestor_alertas', 'bitacora_actividad', 'bitacora_eventos', 'centro_notificaciones',
]

const PANEL_MINIMO = ['panel', 'alertas', 'centro_notificaciones']

const TODAS_FINANZAS = [
  'cuotas', 'generacion_cuotas', 'plantillas_cuota', 'recargos_mora', 'reglas_mora',
  'campanas_cobro', 'reporte_deudores', 'mapa_calor_cuotas', 'conciliacion_cobros',
  'estado_cuenta_residente', 'estadocuenta', 'convenios_cuota', 'plan_pago', 'avisos_cobro',
  'cobranza', 'cobranza_judicial', 'presupuesto', 'contabilidad', 'comparativo_presupuesto',
  'comparativo_anual', 'pronostico_financiero', 'simulador_cuotas', 'caja_chica',
  'gestion_fondo', 'fondo_reserva', 'tarifas', 'cargos_adicionales', 'recibos_digitales',
  'cierres', 'cierre_anual', 'historial_saldos', 'notificaciones_enviadas', 'proformas',
  'exportacion', 'centro_costos', 'analisis_cartera',
]

const TODAS_RESIDENTES = [
  'tablero_ocupacion', 'directorio_comunidad', 'directorio', 'arrendamientos', 'onboarding',
  'entrega_unidad', 'portal', 'mensajes_portal', 'resumen_residente', 'solicitudes', 'vehiculos', 'mascotas',
  'accesos_res', 'control_accesos_qr', 'certificados', 'manual_residente', 'mapa_unidades', 'scoring_unidades',
]

const TODAS_OPERACIONES = [
  'mantenimiento', 'kanban_tickets', 'gantt_mantenimiento', 'calendario_mantenimiento',
  'mant_preventivo', 'bitacora_manto', 'inventario', 'suministros', 'tareas_cond',
  'ordenes_compra', 'eval_proveedor', 'proveedores', 'obras', 'proyectos_cond',
  'permisos_obra', 'garantias', 'checklist_areas', 'prog_limpieza', 'control_plagas', 'prestamos',
]

const TODAS_INSTALACIONES = [
  'amenidades', 'utilizacion_amenidades', 'parqueos', 'estac_visita', 'bodegas', 'llaves',
  'equipos', 'consumo_energia', 'medidores_unidad', 'control_piscina', 'jardineria',
  'elevadores', 'cisternas', 'generador', 'incendio', 'camaras', 'gas', 'integracion_agua',
]

const TODAS_SEGURIDAD = [
  'visitantes', 'analisis_visitantes', 'vis_frecuentes', 'seguridad', 'rutas_ronda',
  'plantillas_cargo', 'tareas_personal', 'revision_tareas', 'desempeno_personal',
  'turnos', 'ausencias', 'horas_extra',
  'paqueteria', 'objetos', 'incidentes', 'reclamos', 'bitacora_guardia', 'presencia', 'panel_turno', 'emergencias',
]

const TODA_COMUNIDAD = [
  'comunidad', 'infracciones', 'sanciones', 'gestion_conflictos', 'asambleas',
  'asamblea_digital', 'votaciones', 'junta', 'actas', 'acuerdos', 'eventos_comunidad',
  'agenda', 'cumpleanos', 'programa_actividades', 'buzon_sugerencias', 'encuestas',
  'encuesta_dashboard', 'comunicados', 'recordatorios', 'comunicacion_condominios',
]

// Sección "Comunicación" (espejo de SECTIONS en components/condominios/sections.ts).
// SOLO agrupación del editor de roles: el acceso efectivo por rol
// (CONDOMINIOS_TAB_ACCESS) no cambia — los Sets de cada rol quedan intactos.
const COMUNICACION_TABS = [
  'centro_notificaciones', 'comunicados', 'comunidad', 'recordatorios',
  'mensajes_portal', 'comunicacion_condominios', 'buzon_sugerencias',
  'reclamos', 'encuestas', 'encuesta_dashboard', 'mantenimiento',
  'plantillas_mensaje', 'envio_masivo',
]
const COMUNICACION_SET = new Set(COMUNICACION_TABS)
const sinComunicacion = (tabs: string[]) => tabs.filter(t => !COMUNICACION_SET.has(t))

export const CONDOMINIOS_TAB_ACCESS: Record<CondominiosRole, Set<string> | null> = {
  administrador_general: null, // all tabs

  junta_directiva: new Set([
    ...PANEL_ESTRATEGICO,
    // Finanzas: visión estratégica
    'presupuesto', 'contabilidad', 'comparativo_presupuesto', 'comparativo_anual',
    'pronostico_financiero', 'simulador_cuotas', 'gestion_fondo', 'fondo_reserva',
    'historial_saldos', 'exportacion', 'centro_costos', 'analisis_cartera',
    'reporte_deudores', 'estadocuenta', 'cuotas',
    // Residentes: visión general
    'tablero_ocupacion', 'directorio_comunidad', 'mapa_unidades', 'scoring_unidades',
    // Comunidad: gobernanza
    'asambleas', 'asamblea_digital', 'votaciones', 'junta', 'actas', 'acuerdos',
    'eventos_comunidad', 'agenda',
    // Administración: gobernanza
    'documentos', 'reglamento', 'propuestas', 'memoria', 'polizas',
    'vencimientos_criticos', 'reg_autoridades', 'inspecciones', 'multi_condominio', 'firmas',
  ]),

  finanzas: new Set([
    ...PANEL_ESTRATEGICO, 'bitacora_actividad',
    ...TODAS_FINANZAS,
    // Administración: documentos y config financiera
    'documentos', 'correspondencia', 'bitacora_acciones', 'configuracion_cond', 'notificaciones',
    'comunicacion_condominios',
  ]),

  operaciones: new Set([
    ...PANEL_OPERATIVO,
    ...TODAS_OPERACIONES,
    ...TODAS_INSTALACIONES,
    // Administración: técnica
    'documentos', 'bitacora_acciones', 'vencimientos_criticos', 'polizas',
    'inspecciones', 'automatizaciones', 'personal', 'capacitacion_personal',
    'comunicacion_condominios',
  ]),

  seguridad: new Set([
    ...PANEL_OPERATIVO,
    ...TODAS_SEGURIDAD,
    // Residentes: acceso y directorio
    'directorio', 'directorio_comunidad', 'vehiculos', 'mascotas',
    'accesos_res', 'control_accesos_qr', 'solicitudes',
    // Instalaciones: seguridad física
    'parqueos', 'estac_visita', 'llaves', 'camaras', 'amenidades', 'bodegas',
    // Administración
    'bitacora_acciones', 'libro_novedades',
  ]),

  comunidad: new Set([
    ...PANEL_MINIMO,
    ...TODAS_RESIDENTES,
    ...TODA_COMUNIDAD,
    // Administración: comunicaciones
    'documentos', 'reglamento', 'correspondencia', 'libro_novedades',
    'plantillas_mensaje', 'envio_masivo', 'notificaciones', 'flujo_aprobacion',
  ]),

  recepcion: new Set([
    ...PANEL_MINIMO,
    // Seguridad: visitantes y paquetería
    'visitantes', 'analisis_visitantes', 'vis_frecuentes', 'paqueteria', 'objetos',
    'incidentes', 'bitacora_guardia', 'panel_turno', 'emergencias', 'reclamos',
    // Residentes: directorio y accesos
    'directorio', 'directorio_comunidad', 'vehiculos', 'mascotas', 'solicitudes',
    'accesos_res', 'control_accesos_qr', 'certificados', 'portal', 'mensajes_portal',
    // Instalaciones: amenidades y parking
    'amenidades', 'utilizacion_amenidades', 'parqueos', 'estac_visita', 'llaves',
    // Comunidad: comunicaciones
    'comunicados', 'recordatorios', 'agenda',
  ]),

  visualizador: new Set([
    'panel', 'dashboard_ejecutivo', 'resumen_ejecutivo', 'graficas_tendencias',
    'reportes', 'kpis_financieros', 'reporte_consolidado', 'indice_calidad', 'metricas_servicio',
  ]),
}

/**
 * Returns true if the given tab should be visible for the given condominios role.
 * Pass null/undefined role to allow all tabs (admin/super_admin/company_owner).
 */
export function canViewCondominiosTab(tabId: string, role: CondominiosRole | undefined | null): boolean {
  if (!role) return true
  const allowed = CONDOMINIOS_TAB_ACCESS[role]
  if (allowed === null) return true
  return allowed.has(tabId)
}

// ─── Multi-role support ───────────────────────────────────────────────────────

export interface SectionGroup {
  key: string
  label: string
  tabs: string[]
}

export const CONDOMINIOS_SECTION_GROUPS: SectionGroup[] = [
  {
    key: 'panel',
    label: 'Panel / Dashboard',
    tabs: sinComunicacion([...new Set([...PANEL_ESTRATEGICO, ...PANEL_OPERATIVO, ...PANEL_MINIMO])]),
  },
  { key: 'comunicacion',  label: 'Comunicación',   tabs: COMUNICACION_TABS },
  { key: 'finanzas',      label: 'Finanzas',       tabs: TODAS_FINANZAS },
  { key: 'residentes',    label: 'Residentes',     tabs: sinComunicacion(TODAS_RESIDENTES) },
  { key: 'operaciones',   label: 'Operaciones',    tabs: sinComunicacion(TODAS_OPERACIONES) },
  { key: 'instalaciones', label: 'Instalaciones',  tabs: TODAS_INSTALACIONES },
  { key: 'seguridad',     label: 'Seguridad',      tabs: sinComunicacion(TODAS_SEGURIDAD) },
  { key: 'comunidad',     label: 'Comunidad',      tabs: sinComunicacion(TODA_COMUNIDAD) },
]

/**
 * Returns the union of tab sets for an array of roles.
 * Returns null if the user has full access (administrador_general or exempt).
 * Returns an empty Set if roles is empty.
 */
export function getEffectiveTabAccess(roles: CondominiosRole[]): Set<string> | null {
  if (roles.length === 0) return new Set()
  if (roles.includes('administrador_general')) return null
  const union = new Set<string>()
  for (const role of roles) {
    const access = CONDOMINIOS_TAB_ACCESS[role]
    if (access === null) return null
    for (const tab of access) union.add(tab)
  }
  return union
}

/**
 * Multi-role version of canViewCondominiosTab.
 * Pass null for roles to indicate an exempt user (sees everything).
 */
export function canViewCondominiosTabMulti(tabId: string, roles: CondominiosRole[] | null): boolean {
  if (roles === null) return true
  const access = getEffectiveTabAccess(roles)
  if (access === null) return true
  return access.has(tabId)
}
