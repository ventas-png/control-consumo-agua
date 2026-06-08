import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  fetchCondominiosSectionData,
  fetchCondominiosRondasData,
  fetchVisitasControlRecent,
  fetchCondominiosTareasData,
  fetchTareasBloqueData,
  fetchClientesConCumple,
} from '../../domain/condominios/sectionData'
import { track } from '../../lib/analytics'
import { canViewCondominiosTabByPermission } from '../../lib/permissions'
import { type CommandItem } from '../shared/CommandPalette'
import { registerCommands } from '../../lib/commandRegistry'
import { EmptyState } from '../shared/EmptyState'
import { MediaScopeProvider } from '../shared/MediaScopeContext'
import { ActiveCondominioProvider, useActiveCondominio } from './ActiveCondominioContext'
import { CondominioContextBar } from './CondominioContextBar'
import type {
  UserSession, Proyecto, Unidad,
  OrdenCompra, AsambleaDigital, Proforma,
  CuotaCondominio, Visitante, Amenidad, ReservaAmenidad, BloqueoAmenidad, TicketMantenimiento, AnuncioComunidad,
  ParqueoCondominio, Mascota, PaqueteRecibido, InfraccionCondominio,
  RondaSeguridad, NovedadSeguridad, ContratoArrendamiento,
  AreaCondominio, RutaRonda, PuntoControlRuta, VisitaControl,
  PlantillaTareaCargo, BloqueTurno, TareaBloque, RevisionTarea,
  Asamblea, ContratoProveedor, ObjetoPerdido, AgendaItem,
  ItemInventario, PolizaSeguro, InspeccionNormativa, PersonalCondominio,
  ContactoEmergencia, DocumentoCondominio, RegistroResiduo,
  BodegaCondominio, OnboardingResidente, PropuestaInversion, MemoriaLabores,
  ReservaSTR, LocalComercial, ServicioHousekeeping,
  FirmaDigital, SolicitudConcierge, LlaveCondominio, Encuesta, RespuestaEncuesta,
  GastoCondominio, PresupuestoCondominio, AlertaCondominio,
  EventoCalendario, ConfiguracionCondominio,
  SolicitudResidente, SolicitudRentaUnidad, SolicitudMudanzaUnidad, MiembroJunta, PrestamoEquipo, ComunicadoCondominio,
  ActaReunion, CierreMensual, ReglaNotificacion, MedidorUnidad,
  Votacion, SancionCondominio, PlanMantenimiento,
  CorrespondenciaCondominio, LibroNovedad, SeguimientoAcuerdo,
  VehiculoResidente, EventoComunidad, RegistroAsistenteEvento, CajaChica, MovimientoCaja, ObraMejora,
  PlanPagoCond, AccesoResidente, GarantiaEquipo, EntregaUnidad,
  AvisoCobro, BitacoraManto as BitacoraMantoType, EvaluacionProveedor, ReclamoCondominio,
  FondoReserva, PermisoObraUnidad, TarifaCondominio, IncidenteSeguridad,
  ChecklistArea, ProgramacionLimpieza, ConsumoEnergiaArea, HistorialResidente,
  EstacionamientoVisita, BitacoraGuardia, EquipoComun, PresenciaPersonal,
  SuministroCondominio, MovimientoSuministro, TareaCondominio, GestionCobranza,
  SolicitudCertificado, VisitaFrecuente, ArticuloReglamento, ControlPlagas,
  CargoAdicionalUnidad, ProgramaActividad, RegistroAutoridad, NotaAdmin,
  ControlPiscina, MantenimientoJardineria, IncidenciaElevador, MantenimientoCisterna,
  ControlGenerador, ControlSistemaIncendio, ControlCamaraSeguridad, LecturaMedidorGas,
  ComentarioTicket, RecordatorioCondominio, PlantillaCuota, BitacoraAccion,
  RecargoMora, ConvenioCuotaCond, HistorialSaldoUnidad, NotificacionEnviada,
  ReglaMoraConfig, CampanaCobro, CierreAnual,
  CobranzaJudicial, ReciboDigital, InformeMensual, SugerenciaCondominio,
  VencimientoExtra, CapacitacionPersonal, ProyectoCondominio,
  ArticuloManual,
  AutomatizacionCond,
  PlantillaMensajeCond,
  FlujoAprobacionCond,
  ConciliacionCobrosLog,
  FondoReservaMovimiento,
  ConfigCondominio,
} from '../../types'
// cond:A1 — Registry de tabs. Los 191 lazy() + el switch de 180 ramas
// viven ahora en tabRegistry.tsx (declarativo, type-checked, agregar/
// quitar tab no toca este archivo).
import { useParams, useNavigate } from 'react-router-dom'
import { TAB_REGISTRY, TAB_BY_ID, tabToPath, pathParamToTab, type CondominioTab, type CondominiosTabContext } from './tabRegistry'
// Overlay: se renderiza encima del tab activo cuando hay un ticket seleccionado.
// No es un tab del registry porque no aparece en la nav; vive aquí.
const ComentariosTicketTab = lazy(() => import('./tabs/ComentariosTicketTab'))

// Shown while a lazily-loaded tab chunk is fetched. Each tab is code-split, so
// only the active tab's JS is downloaded instead of one ~2 MB bundle.
function TabFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--at-line)', borderTop: '3px solid var(--at-primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
  )
}


const TABS: { id: CondominioTab; label: string; icon: string }[] =
  TAB_REGISTRY.map(({ id, label, icon }) => ({ id, label, icon }))

// ── Secciones de navegación de 2 niveles ─────────────────────────────────────
type SectionKey = 'panel' | 'finanzas' | 'residentes' | 'operaciones' | 'instalaciones' | 'seguridad' | 'comunidad' | 'administracion' | 'especiales'

interface SectionDef { id: SectionKey; label: string; icon: string; tabs: string[] }

const SECTIONS: SectionDef[] = [
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


interface Props {
  proyectos: Proyecto[]
  unidades: Unidad[]
  currentUser: UserSession
  canCreate: (section: string) => boolean
  canEdit: (section: string) => boolean
}

/**
 * cond:B5/B6 — Shell de la sección: monta el provider del condominio activo
 * (estado global + persistencia + filtrado por rol) alrededor del cuerpo real.
 * Se monta aquí (no en App.tsx, que es de T7) porque el contexto solo lo
 * consume la sección de condominios. La lista `proyectos` ya viene filtrada por
 * rol desde App.tsx; el provider la acota a los activos y resuelve el activo.
 */
export function CondominiosSection(props: Props) {
  return (
    <ActiveCondominioProvider proyectos={props.proyectos} companyId={props.currentUser.company_id ?? ''}>
      <CondominiosSectionInner {...props} />
    </ActiveCondominioProvider>
  )
}

function CondominiosSectionInner({ proyectos, unidades, currentUser, canCreate, canEdit }: Props) {
  const visibleSections = useMemo(() =>
    SECTIONS
      .map(sec => ({
        ...sec,
        tabs: sec.tabs.filter(tid => canViewCondominiosTabByPermission(currentUser, tid)),
      }))
      .filter(sec => sec.tabs.length > 0),
    [currentUser]
  )

  // cond:A1 sub-rutas: el tab activo vive en la URL, no en useState. Refresh
  // mantiene el tab, deep-link a `/condominios/cuotas` funciona, atrás del
  // navegador navega entre tabs. La sección (grouping de la nav 2 niveles)
  // sí queda como state visual local.
  const { tab: tabParam } = useParams<{ tab?: string }>()
  const activeTab: CondominioTab = pathParamToTab(tabParam)
  const navigate = useNavigate()
  const setActiveTab = useCallback((next: CondominioTab) => navigate(tabToPath(next)), [navigate])
  const [activeSection, setActiveSection] = useState<SectionKey>('panel')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  )
  // cond:B5/B6 — El condominio activo vive ahora en ActiveCondominioContext
  // (estado global persistido + filtrado por rol). `selectedProyectoId` se
  // mantiene como alias local para no tocar las ~190 referencias aguas abajo
  // (cargarDatos, unidadesProyecto, tabCtx, MediaScopeProvider). Cambiar de
  // condominio en el switcher actualiza el contexto → `cargarDatos` depende de
  // este id y refetchea solo, sin recarga de página.
  const { activeProjectId: selectedProyectoId, proyectosActivos } = useActiveCondominio()
  const [loading, setLoading] = useState(false)

  // Fase 1
  const [cuotas, setCuotas] = useState<CuotaCondominio[]>([])
  const [visitantes, setVisitantes] = useState<Visitante[]>([])
  const [amenidades, setAmenidades] = useState<Amenidad[]>([])
  const [reservas, setReservas] = useState<ReservaAmenidad[]>([])
  const [bloqueosAmenidades, setBloqueosAmenidades] = useState<BloqueoAmenidad[]>([])
  const [tickets, setTickets] = useState<TicketMantenimiento[]>([])
  const [anuncios, setAnuncios] = useState<AnuncioComunidad[]>([])
  // Fase 2
  const [parqueos, setParqueos] = useState<ParqueoCondominio[]>([])
  const [mascotas, setMascotas] = useState<Mascota[]>([])
  const [paquetes, setPaquetes] = useState<PaqueteRecibido[]>([])
  const [infracciones, setInfracciones] = useState<InfraccionCondominio[]>([])
  const [rondas, setRondas] = useState<RondaSeguridad[]>([])
  const [novedades, setNovedades] = useState<NovedadSeguridad[]>([])
  const [areas, setAreas] = useState<AreaCondominio[]>([])
  const [rutas, setRutas] = useState<RutaRonda[]>([])
  const [puntosControl, setPuntosControl] = useState<PuntoControlRuta[]>([])
  const [visitasControl, setVisitasControl] = useState<VisitaControl[]>([])
  const [plantillasCargo, setPlantillasCargo] = useState<PlantillaTareaCargo[]>([])
  const [bloquesTurno, setBloquesTurno] = useState<BloqueTurno[]>([])
  const [tareasBloque, setTareasBloque] = useState<TareaBloque[]>([])
  const [revisionesTarea, setRevisionesTarea] = useState<RevisionTarea[]>([])
  const [contratos, setContratos] = useState<ContratoArrendamiento[]>([])
  // Fase 3
  const [asambleas, setAsambleas] = useState<Asamblea[]>([])
  const [contratosProveedores, setContratosProveedores] = useState<ContratoProveedor[]>([])
  const [objetos, setObjetos] = useState<ObjetoPerdido[]>([])
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  // Fase 4
  const [inventario, setInventario] = useState<ItemInventario[]>([])
  const [polizas, setPolizas] = useState<PolizaSeguro[]>([])
  const [inspecciones, setInspecciones] = useState<InspeccionNormativa[]>([])
  const [personal, setPersonal] = useState<PersonalCondominio[]>([])
  const [clientesBirthday, setClientesBirthday] = useState<{ id: string; nombre: string; fecha_nacimiento: string; unidad_nombre?: string }[]>([])
  // Fase 5
  const [contactosEmergencia, setContactosEmergencia] = useState<ContactoEmergencia[]>([])
  const [documentos, setDocumentos] = useState<DocumentoCondominio[]>([])
  const [residuos, setResiduos] = useState<RegistroResiduo[]>([])
  // Fase 6
  const [bodegas, setBodegas] = useState<BodegaCondominio[]>([])
  const [onboardings, setOnboardings] = useState<OnboardingResidente[]>([])
  const [propuestas, setPropuestas] = useState<PropuestaInversion[]>([])
  const [memorias, setMemorias] = useState<MemoriaLabores[]>([])
  // Fase 7
  const [reservasSTR, setReservasSTR] = useState<ReservaSTR[]>([])
  const [locales, setLocales] = useState<LocalComercial[]>([])
  const [serviciosHK, setServiciosHK] = useState<ServicioHousekeeping[]>([])
  // Fase 8
  const [firmas, setFirmas] = useState<FirmaDigital[]>([])
  const [solicitudesConcierge, setSolicitudesConcierge] = useState<SolicitudConcierge[]>([])
  const [llaves, setLlaves] = useState<LlaveCondominio[]>([])
  const [encuestas, setEncuestas] = useState<Encuesta[]>([])
  const [respuestasEncuesta, setRespuestasEncuesta] = useState<RespuestaEncuesta[]>([])
  // Fase 9
  const [gastos, setGastos] = useState<GastoCondominio[]>([])
  const [presupuestos, setPresupuestos] = useState<PresupuestoCondominio[]>([])
  const [alertasCondominio, setAlertasCondominio] = useState<AlertaCondominio[]>([])
  // Fase 10
  const [eventosCalendario, setEventosCalendario] = useState<EventoCalendario[]>([])
  const [configuracion, setConfiguracion] = useState<ConfiguracionCondominio[]>([])
  // Fase 11
  const [solicitudes, setSolicitudes] = useState<SolicitudResidente[]>([])
  const [solicitudesRenta, setSolicitudesRenta] = useState<SolicitudRentaUnidad[]>([])
  const [solicitudesMudanza, setSolicitudesMudanza] = useState<SolicitudMudanzaUnidad[]>([])
  const [junta, setJunta] = useState<MiembroJunta[]>([])
  const [prestamos, setPrestamos] = useState<PrestamoEquipo[]>([])
  const [comunicados, setComunicados] = useState<ComunicadoCondominio[]>([])
  // Fase 12
  const [actas, setActas] = useState<ActaReunion[]>([])
  const [cierres, setCierres] = useState<CierreMensual[]>([])
  const [reglas, setReglas] = useState<ReglaNotificacion[]>([])
  const [medidores, setMedidores] = useState<MedidorUnidad[]>([])
  // Fase 13
  const [votaciones, setVotaciones] = useState<Votacion[]>([])
  const [sanciones, setSanciones] = useState<SancionCondominio[]>([])
  const [planesMantenimiento, setPlanesMantenimiento] = useState<PlanMantenimiento[]>([])
  // Fase 14
  const [correspondencia, setCorrespondencia] = useState<CorrespondenciaCondominio[]>([])
  const [libroNovedades, setLibroNovedades] = useState<LibroNovedad[]>([])
  const [acuerdos, setAcuerdos] = useState<SeguimientoAcuerdo[]>([])
  // Fase 15
  const [vehiculos, setVehiculos] = useState<VehiculoResidente[]>([])
  const [eventosComunidad, setEventosComunidad] = useState<EventoComunidad[]>([])
  const [asistentesEvento, setAsistentesEvento] = useState<RegistroAsistenteEvento[]>([])
  const [cajasChicas, setCajasChicas] = useState<CajaChica[]>([])
  const [movimientosCaja, setMovimientosCaja] = useState<MovimientoCaja[]>([])
  const [obras, setObras] = useState<ObraMejora[]>([])
  // Fase 16
  const [planesPage, setPlanesPage] = useState<PlanPagoCond[]>([])
  const [accesosRes, setAccesosRes] = useState<AccesoResidente[]>([])
  const [garantias, setGarantias] = useState<GarantiaEquipo[]>([])
  const [entregas, setEntregas] = useState<EntregaUnidad[]>([])
  // Fase 17
  const [avisosCobro, setAvisosCobro] = useState<AvisoCobro[]>([])
  const [bitacoraRegistros, setBitacoraRegistros] = useState<BitacoraMantoType[]>([])
  const [evaluacionesProv, setEvaluacionesProv] = useState<EvaluacionProveedor[]>([])
  const [reclamos, setReclamos] = useState<ReclamoCondominio[]>([])
  // Fase 18
  const [fondoReserva, setFondoReserva] = useState<FondoReserva[]>([])
  const [permisosObra, setPermisosObra] = useState<PermisoObraUnidad[]>([])
  const [tarifas, setTarifas] = useState<TarifaCondominio[]>([])
  const [incidentes, setIncidentes] = useState<IncidenteSeguridad[]>([])
  // Fase 19
  const [checklistAreas, setChecklistAreas] = useState<ChecklistArea[]>([])
  const [progLimpieza, setProgLimpieza] = useState<ProgramacionLimpieza[]>([])
  const [consumoEnergia, setConsumoEnergia] = useState<ConsumoEnergiaArea[]>([])
  const [historialRes, setHistorialRes] = useState<HistorialResidente[]>([])
  // Fase 20
  const [estacVisita, setEstacVisita] = useState<EstacionamientoVisita[]>([])
  const [bitacoraGuardia, setBitacoraGuardia] = useState<BitacoraGuardia[]>([])
  const [equiposComunes, setEquiposComunes] = useState<EquipoComun[]>([])
  const [presenciaPersonal, setPresenciaPersonal] = useState<PresenciaPersonal[]>([])
  // Fase 21
  const [suministros, setSuministros] = useState<SuministroCondominio[]>([])
  const [movimientosSuministro, setMovimientosSuministro] = useState<MovimientoSuministro[]>([])
  const [tareasCond, setTareasCond] = useState<TareaCondominio[]>([])
  const [cobranzas, setCobranzas] = useState<GestionCobranza[]>([])
  // Fase 22
  const [certificados, setCertificados] = useState<SolicitudCertificado[]>([])
  const [visitasFrecuentes, setVisitasFrecuentes] = useState<VisitaFrecuente[]>([])
  const [reglamento, setReglamento] = useState<ArticuloReglamento[]>([])
  const [controlPlagas, setControlPlagas] = useState<ControlPlagas[]>([])
  // Fase 23
  const [cargosAdicionales, setCargosAdicionales] = useState<CargoAdicionalUnidad[]>([])
  const [programaActividades, setProgramaActividades] = useState<ProgramaActividad[]>([])
  const [registroAutoridades, setRegistroAutoridades] = useState<RegistroAutoridad[]>([])
  const [notasAdmin, setNotasAdmin] = useState<NotaAdmin[]>([])
  // Fase 24
  const [controlPiscina, setControlPiscina] = useState<ControlPiscina[]>([])
  const [mantenimientoJardineria, setMantenimientoJardineria] = useState<MantenimientoJardineria[]>([])
  const [incidenciasElevador, setIncidenciasElevador] = useState<IncidenciaElevador[]>([])
  const [mantenimientoCisterna, setMantenimientoCisterna] = useState<MantenimientoCisterna[]>([])
  // Fase 25
  const [controlGenerador, setControlGenerador] = useState<ControlGenerador[]>([])
  const [controlIncendio, setControlIncendio] = useState<ControlSistemaIncendio[]>([])
  const [camarasSeguridad, setCamarasSeguridad] = useState<ControlCamaraSeguridad[]>([])
  const [lecturasGas, setLecturasGas] = useState<LecturaMedidorGas[]>([])
  // Fase 28
  const [recordatorios, setRecordatorios] = useState<RecordatorioCondominio[]>([])
  const [plantillasCuota, setPlantillasCuota] = useState<PlantillaCuota[]>([])
  const [bitacoraAcciones, setBitacoraAcciones] = useState<BitacoraAccion[]>([])
  const [comentariosTicket] = useState<ComentarioTicket[]>([])
  const [ticketSeleccionado, setTicketSeleccionado] = useState<import('../../types').TicketMantenimiento | null>(null)
  // Fase 29
  const [recargosMora, setRecargosMora] = useState<RecargoMora[]>([])
  const [conveniosCuota, setConveniosCuota] = useState<ConvenioCuotaCond[]>([])
  const [historialSaldos, setHistorialSaldos] = useState<HistorialSaldoUnidad[]>([])
  const [notificacionesEnviadas, setNotificacionesEnviadas] = useState<NotificacionEnviada[]>([])
  // Fase 30
  const [reglasMora, setReglasMora] = useState<ReglaMoraConfig[]>([])
  const [campanasCobro, setCampanasCobro] = useState<CampanaCobro[]>([])
  const [cierresAnuales, setCierresAnuales] = useState<CierreAnual[]>([])
  // Fase 31
  const [cobranzaJudicial, setCobranzaJudicial] = useState<CobranzaJudicial[]>([])
  const [recibosDigitales, setRecibosDigitales] = useState<ReciboDigital[]>([])
  const [informesMensuales, setInformesMensuales] = useState<InformeMensual[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciaCondominio[]>([])
  // Fase 32
  const [vencimientosExtra, setVencimientosExtra] = useState<VencimientoExtra[]>([])
  const [capacitaciones, setCapacitaciones] = useState<CapacitacionPersonal[]>([])
  const [proyectosCond, setProyectosCond] = useState<ProyectoCondominio[]>([])
  // Fase 33
  const [articulosManual, setArticulosManual] = useState<ArticuloManual[]>([])
  // Fase 34
  const [automatizaciones, setAutomatizaciones] = useState<AutomatizacionCond[]>([])
  // Fase 35
  const [plantillasMensaje, setPlantillasMensaje] = useState<PlantillaMensajeCond[]>([])
  const [flujoAprobacion, setFlujoAprobacion] = useState<FlujoAprobacionCond[]>([])
  // Fase 36 — GeneracionCuotasLog loaded on demand inside GeneracionCuotasTab
  // Fase 37
  const [ordenesCompra, setOrdenesCompra] = useState<OrdenCompra[]>([])
  const [asambleasDigital, setAsambleasDigital] = useState<AsambleaDigital[]>([])
  // Fase 38
  const [proformas, setProformas] = useState<Proforma[]>([])
  const [conciliaciones, setConciliaciones] = useState<ConciliacionCobrosLog[]>([])
  // Fase 43
  const [fondoReservaMovs, setFondoReservaMovs] = useState<FondoReservaMovimiento[]>([])
  const [configCondominio, setConfigCondominio] = useState<ConfigCondominio | null>(null)

  // `proyectosActivos` y el id activo (con su default/persistencia) los provee
  // ActiveCondominioContext; ya no se derivan ni se inicializan aquí.

  const cargarDatos = useCallback(async () => {
    if (!selectedProyectoId || !currentUser.company_id) return
    setLoading(true)

    const pid = selectedProyectoId
    const cid = currentUser.company_id

    const [
      cuotasRes, visitantesRes, amenidadesRes, reservasRes, ticketsRes, anunciosRes,
      parqueosRes, mascotasRes, paquetesRes, infraccionesRes, rondasRes, novedadesRes, contratosRes,
      asambleasRes, contratosProvRes, objetosRes, agendaRes,
      inventarioRes, polizasRes, inspeccionesRes, personalRes,
      contactosEmergRes, documentosRes, residuosRes,
      bodegasRes, onboardingsRes, propuestasRes, memoriasRes,
      strRes, localesRes, hkRes,
      firmasRes, conciergeRes, llavesRes, encuestasRes, respuestasRes,
      gastosRes, presupuestosRes, alertasRes,
      eventosCalRes, configuracionRes,
      solicitudesRes, juntaRes, prestamosRes, comunicadosRes,
      actasRes, cierresRes, reglasRes, medidoresRes,
      votacionesRes, sancionesRes, planesRes,
      correspondenciaRes, libroRes, acuerdosRes,
      vehiculosRes, eventosComRes, asistentesRes, cajasRes, movimientosRes, obrasRes,
      planesPagoRes, cuotasPlanRes, accesosResRes, garantiasRes, entregasRes,
      avisosCobroRes, bitacoraMantoRes, evalProvRes, reclamosCondRes,
      fondoReservaRes, permisosObraRes, tarifasRes, incidentesRes,
      checklistAreasRes, progLimpiezaRes, consumoEnergiaRes, historialResRes,
      estacVisitaRes, bitacoraGuardiaRes, equiposComunesRes, presenciaPersonalRes,
      suministrosRes, movsumRes, tareasCondRes, cobranzasRes,
      certificadosRes, visFrecRes, reglamentoRes, plagasRes,
      cargosAdRes, progActRes, regAutoRes, notasAdminRes,
      piscinaRes, jardineriaRes, elevadorRes, cisternaRes,
      generadorRes, incendioRes, camarasRes, gasRes,
      recordatoriosRes, plantillasRes, bitacoraRes,
      recargosRes, conveniosRes, histSaldosRes, notifEnviadasRes,
      reglasMoraRes, campanasRes, cierresAnualesRes,
      cobranzaJudicialRes, recibosDigitalesRes, informesMensualesRes, sugerenciasRes,
      vencimientosExtraRes, capacitacionesRes, proyectosCondRes,
      articulosManualRes,
      automatizacionesRes,
      plantillasMensajeRes,
      flujoAprobacionRes,
      ordenesCompraRes,
      asambleasDigitalRes,
      proformasRes,
      conciliacionesRes,
      fondoReservaMovsRes,
      configCondominioRes,
      solicitudesRentaRes,
      solicitudesMudanzaRes,
    ] = await fetchCondominiosSectionData(pid, cid)

    // Fase 57 — Rutas de ronda (separate to avoid giant Promise.all size limit)
    const [areasRes, rutasRes, puntosControlRes, bloqueosAmenRes] = await fetchCondominiosRondasData(pid, cid)
    setBloqueosAmenidades(
      (bloqueosAmenRes.data ?? []).map((b: Record<string, unknown>) => ({
        ...b,
        amenidad_nombre: (b.amenidades as { nombre: string } | null)?.nombre,
      })) as BloqueoAmenidad[]
    )
    setAreas((areasRes.data ?? []) as AreaCondominio[])
    setRutas((rutasRes.data ?? []) as RutaRonda[])
    setPuntosControl(
      (puntosControlRes.data ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        area_nombre: (p.areas_condominio as { nombre: string; icono: string } | null)?.nombre,
        area_icono:  (p.areas_condominio as { nombre: string; icono: string } | null)?.icono,
      })) as PuntoControlRuta[]
    )

    // Fetch visitas_control only for rondas of this project (recent 30 days)
    const { data: visitasData } = await fetchVisitasControlRecent()
    setVisitasControl(
      (visitasData ?? []).map((v: Record<string, unknown>) => {
        const punto = v.puntos_control_ruta as { orden: number; instrucciones: string | null; areas_condominio: { nombre: string; icono: string } | null } | null
        return {
          ...v,
          punto_orden:  punto?.orden,
          instrucciones: punto?.instrucciones,
          area_nombre:  punto?.areas_condominio?.nombre,
          area_icono:   punto?.areas_condominio?.icono,
        } as VisitaControl
      })
    )

    // Fase 58 — Tareas operativas
    const [plantillasCargoRes, bloquesTurnoRes] = await fetchCondominiosTareasData(pid, cid)
    setPlantillasCargo(
      (plantillasCargoRes.data ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        area_nombre: (p.areas_condominio as { nombre: string } | null)?.nombre,
      })) as PlantillaTareaCargo[]
    )
    const bloqueIds = (bloquesTurnoRes.data ?? []).map((b: Record<string, unknown>) => b.id as string)
    setBloquesTurno(
      (bloquesTurnoRes.data ?? []).map((b: Record<string, unknown>) => ({
        ...b,
        personal_nombre: (b.personal_condominio as { nombre: string; cargo: string } | null)?.nombre,
        personal_cargo:  (b.personal_condominio as { nombre: string; cargo: string } | null)?.cargo,
      })) as BloqueTurno[]
    )
    if (bloqueIds.length > 0) {
      const [tareasRes, revisionesRes] = await fetchTareasBloqueData(bloqueIds)
      setTareasBloque(
        (tareasRes.data ?? []).map((t: Record<string, unknown>) => ({
          ...t,
          foto_urls: (t.foto_urls as string[] | null) ?? [],
          area_nombre: (t.areas_condominio as { nombre: string; icono: string } | null)?.nombre,
          area_icono:  (t.areas_condominio as { nombre: string; icono: string } | null)?.icono,
        })) as TareaBloque[]
      )
      setRevisionesTarea((revisionesRes.data ?? []) as RevisionTarea[])
    } else {
      setTareasBloque([]); setRevisionesTarea([])
    }

    const mapUnidad = <T extends object>(data: Record<string, unknown>[]): T[] =>
      data.map(r => ({ ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre } as T))

    setCuotas(mapUnidad<CuotaCondominio>(cuotasRes.data ?? []))
    setVisitantes(mapUnidad<Visitante>(visitantesRes.data ?? []))
    setAmenidades((amenidadesRes.data ?? []) as Amenidad[])
    setReservas((reservasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      amenidad_nombre: (r.amenidades as { nombre: string } | null)?.nombre,
      unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as ReservaAmenidad)))
    setTickets(mapUnidad<TicketMantenimiento>(ticketsRes.data ?? []))
    setAnuncios((anunciosRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      publicado_por_nombre: (r.app_users as { full_name: string } | null)?.full_name,
    } as AnuncioComunidad)))
    setParqueos(mapUnidad<ParqueoCondominio>(parqueosRes.data ?? []))
    setMascotas(mapUnidad<Mascota>(mascotasRes.data ?? []))
    setPaquetes(mapUnidad<PaqueteRecibido>(paquetesRes.data ?? []))
    setInfracciones(mapUnidad<InfraccionCondominio>(infraccionesRes.data ?? []))
    setRondas((rondasRes.data ?? []) as RondaSeguridad[])
    setNovedades((novedadesRes.data ?? []) as NovedadSeguridad[])
    setContratos(mapUnidad<ContratoArrendamiento>(contratosRes.data ?? []))
    setAsambleas((asambleasRes.data ?? []) as Asamblea[])
    setContratosProveedores((contratosProvRes.data ?? []) as ContratoProveedor[])
    setObjetos((objetosRes.data ?? []) as ObjetoPerdido[])
    setAgenda((agendaRes.data ?? []) as AgendaItem[])
    setInventario((inventarioRes.data ?? []) as ItemInventario[])
    setPolizas((polizasRes.data ?? []) as PolizaSeguro[])
    setInspecciones((inspeccionesRes.data ?? []) as InspeccionNormativa[])
    setPersonal((personalRes.data ?? []) as PersonalCondominio[])
    // Fetch clients linked to project units (for birthday calendar)
    const clienteIds = unidades.filter(u => u.project_id === pid && u.cliente_id).map(u => u.cliente_id as string)
    if (clienteIds.length > 0) {
      const { data: cliData } = await fetchClientesConCumple(clienteIds)
      const unidadesPid = unidades.filter(u => u.project_id === pid)
      setClientesBirthday((cliData ?? []).map(c => ({
        id: c.id, nombre: c.nombre, fecha_nacimiento: c.fecha_nacimiento!,
        unidad_nombre: unidadesPid.find(u => u.cliente_id === c.id)?.nombre,
      })))
    } else {
      setClientesBirthday([])
    }
    setContactosEmergencia((contactosEmergRes.data ?? []) as ContactoEmergencia[])
    setDocumentos((documentosRes.data ?? []) as DocumentoCondominio[])
    setResiduos((residuosRes.data ?? []) as RegistroResiduo[])
    setBodegas(mapUnidad<BodegaCondominio>(bodegasRes.data ?? []))
    setOnboardings(mapUnidad<OnboardingResidente>(onboardingsRes.data ?? []))
    setPropuestas((propuestasRes.data ?? []) as PropuestaInversion[])
    setMemorias((memoriasRes.data ?? []) as MemoriaLabores[])
    setReservasSTR(mapUnidad<ReservaSTR>(strRes.data ?? []))
    setLocales((localesRes.data ?? []) as LocalComercial[])
    setServiciosHK(mapUnidad<ServicioHousekeeping>(hkRes.data ?? []))
    setFirmas(mapUnidad<FirmaDigital>(firmasRes.data ?? []))
    setSolicitudesConcierge(mapUnidad<SolicitudConcierge>(conciergeRes.data ?? []))
    setLlaves(mapUnidad<LlaveCondominio>(llavesRes.data ?? []))
    setEncuestas((encuestasRes.data ?? []) as Encuesta[])
    setRespuestasEncuesta(mapUnidad<RespuestaEncuesta>(respuestasRes.data ?? []))
    setGastos((gastosRes.data ?? []) as GastoCondominio[])
    setPresupuestos((presupuestosRes.data ?? []) as PresupuestoCondominio[])
    setAlertasCondominio((alertasRes.data ?? []) as AlertaCondominio[])
    setEventosCalendario((eventosCalRes.data ?? []) as EventoCalendario[])
    setConfiguracion((configuracionRes.data ?? []) as ConfiguracionCondominio[])
    setSolicitudes(mapUnidad<SolicitudResidente>(solicitudesRes.data ?? []))
    setSolicitudesRenta((solicitudesRentaRes.data ?? []) as SolicitudRentaUnidad[])
    setSolicitudesMudanza(mapUnidad<SolicitudMudanzaUnidad>(solicitudesMudanzaRes.data ?? []))
    setJunta(mapUnidad<MiembroJunta>(juntaRes.data ?? []))
    setPrestamos(mapUnidad<PrestamoEquipo>(prestamosRes.data ?? []))
    setComunicados(mapUnidad<ComunicadoCondominio>(comunicadosRes.data ?? []))
    setActas((actasRes.data ?? []) as ActaReunion[])
    setCierres((cierresRes.data ?? []) as CierreMensual[])
    setReglas((reglasRes.data ?? []) as ReglaNotificacion[])
    setMedidores(mapUnidad<MedidorUnidad>(medidoresRes.data ?? []))
    setVotaciones((votacionesRes.data ?? []) as Votacion[])
    setSanciones(mapUnidad<SancionCondominio>(sancionesRes.data ?? []))
    setPlanesMantenimiento((planesRes.data ?? []) as PlanMantenimiento[])
    setCorrespondencia(mapUnidad<CorrespondenciaCondominio>(correspondenciaRes.data ?? []))
    setLibroNovedades((libroRes.data ?? []) as LibroNovedad[])
    setAcuerdos((acuerdosRes.data ?? []) as SeguimientoAcuerdo[])
    setVehiculos((vehiculosRes.data ?? []) as VehiculoResidente[])
    setEventosComunidad((eventosComRes.data ?? []) as EventoComunidad[])
    setAsistentesEvento((asistentesRes.data ?? []) as RegistroAsistenteEvento[])
    setCajasChicas((cajasRes.data ?? []) as CajaChica[])
    setMovimientosCaja((movimientosRes.data ?? []) as MovimientoCaja[])
    setObras((obrasRes.data ?? []) as ObraMejora[])
    setPlanesPage((planesPagoRes.data ?? []) as PlanPagoCond[])
    void cuotasPlanRes // fetched per-plan inside PlanPagoCondTab
    setAccesosRes((accesosResRes.data ?? []) as AccesoResidente[])
    setGarantias((garantiasRes.data ?? []) as GarantiaEquipo[])
    setEntregas((entregasRes.data ?? []) as EntregaUnidad[])
    setAvisosCobro((avisosCobroRes.data ?? []) as AvisoCobro[])
    setBitacoraRegistros((bitacoraMantoRes.data ?? []) as BitacoraMantoType[])
    setEvaluacionesProv((evalProvRes.data ?? []) as EvaluacionProveedor[])
    setReclamos((reclamosCondRes.data ?? []) as ReclamoCondominio[])
    setFondoReserva((fondoReservaRes.data ?? []) as FondoReserva[])
    setPermisosObra((permisosObraRes.data ?? []) as PermisoObraUnidad[])
    setTarifas((tarifasRes.data ?? []) as TarifaCondominio[])
    setIncidentes((incidentesRes.data ?? []) as IncidenteSeguridad[])
    setChecklistAreas((checklistAreasRes.data ?? []) as ChecklistArea[])
    setProgLimpieza((progLimpiezaRes.data ?? []) as ProgramacionLimpieza[])
    setConsumoEnergia((consumoEnergiaRes.data ?? []) as ConsumoEnergiaArea[])
    setHistorialRes((historialResRes.data ?? []) as HistorialResidente[])
    setEstacVisita((estacVisitaRes.data ?? []) as EstacionamientoVisita[])
    setBitacoraGuardia((bitacoraGuardiaRes.data ?? []) as BitacoraGuardia[])
    setEquiposComunes((equiposComunesRes.data ?? []) as EquipoComun[])
    setPresenciaPersonal((presenciaPersonalRes.data ?? []) as PresenciaPersonal[])
    setSuministros((suministrosRes.data ?? []) as SuministroCondominio[])
    setMovimientosSuministro((movsumRes.data ?? []) as MovimientoSuministro[])
    setTareasCond((tareasCondRes.data ?? []) as TareaCondominio[])
    setCobranzas((cobranzasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as GestionCobranza)))
    setCertificados((certificadosRes.data ?? []) as SolicitudCertificado[])
    setVisitasFrecuentes((visFrecRes.data ?? []) as VisitaFrecuente[])
    setReglamento((reglamentoRes.data ?? []) as ArticuloReglamento[])
    setControlPlagas((plagasRes.data ?? []) as ControlPlagas[])
    setCargosAdicionales((cargosAdRes.data ?? []) as CargoAdicionalUnidad[])
    setProgramaActividades((progActRes.data ?? []) as ProgramaActividad[])
    setRegistroAutoridades((regAutoRes.data ?? []) as RegistroAutoridad[])
    setNotasAdmin((notasAdminRes.data ?? []) as NotaAdmin[])
    setControlPiscina((piscinaRes.data ?? []) as ControlPiscina[])
    setMantenimientoJardineria((jardineriaRes.data ?? []) as MantenimientoJardineria[])
    setIncidenciasElevador((elevadorRes.data ?? []) as IncidenciaElevador[])
    setMantenimientoCisterna((cisternaRes.data ?? []) as MantenimientoCisterna[])
    setControlGenerador((generadorRes.data ?? []) as ControlGenerador[])
    setControlIncendio((incendioRes.data ?? []) as ControlSistemaIncendio[])
    setCamarasSeguridad((camarasRes.data ?? []) as ControlCamaraSeguridad[])
    setLecturasGas(mapUnidad<LecturaMedidorGas>(gasRes.data ?? []))
    setRecordatorios((recordatoriosRes.data ?? []) as RecordatorioCondominio[])
    setPlantillasCuota((plantillasRes.data ?? []) as PlantillaCuota[])
    setBitacoraAcciones((bitacoraRes.data ?? []) as BitacoraAccion[])
    setRecargosMora(mapUnidad<RecargoMora>(recargosRes.data ?? []))
    setConveniosCuota(mapUnidad<ConvenioCuotaCond>(conveniosRes.data ?? []))
    setHistorialSaldos((histSaldosRes.data ?? []) as HistorialSaldoUnidad[])
    setNotificacionesEnviadas((notifEnviadasRes.data ?? []) as NotificacionEnviada[])
    setReglasMora((reglasMoraRes.data ?? []) as ReglaMoraConfig[])
    setCampanasCobro((campanasRes.data ?? []) as CampanaCobro[])
    setCierresAnuales((cierresAnualesRes.data ?? []) as CierreAnual[])
    setCobranzaJudicial(mapUnidad<CobranzaJudicial>(cobranzaJudicialRes.data ?? []))
    setRecibosDigitales(mapUnidad<ReciboDigital>(recibosDigitalesRes.data ?? []))
    setInformesMensuales((informesMensualesRes.data ?? []) as InformeMensual[])
    setSugerencias(mapUnidad<SugerenciaCondominio>(sugerenciasRes.data ?? []))
    setVencimientosExtra((vencimientosExtraRes.data ?? []) as VencimientoExtra[])
    setCapacitaciones((capacitacionesRes.data ?? []) as CapacitacionPersonal[])
    setProyectosCond((proyectosCondRes.data ?? []) as ProyectoCondominio[])
    setArticulosManual((articulosManualRes.data ?? []) as ArticuloManual[])
    setAutomatizaciones((automatizacionesRes.data ?? []) as AutomatizacionCond[])
    setPlantillasMensaje((plantillasMensajeRes.data ?? []) as PlantillaMensajeCond[])
    setFlujoAprobacion((flujoAprobacionRes.data ?? []) as FlujoAprobacionCond[])
    setOrdenesCompra((ordenesCompraRes.data ?? []) as OrdenCompra[])
    setAsambleasDigital((asambleasDigitalRes.data ?? []) as AsambleaDigital[])
    setProformas((proformasRes.data ?? []) as Proforma[])
    setConciliaciones((conciliacionesRes.data ?? []) as ConciliacionCobrosLog[])
    setFondoReservaMovs((fondoReservaMovsRes.data ?? []) as FondoReservaMovimiento[])
    setConfigCondominio((configCondominioRes.data ?? null) as ConfigCondominio | null)

    setLoading(false)
  }, [selectedProyectoId, currentUser.company_id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Feature-usage analytics: which of the condominios tabs are actually used.
  useEffect(() => {
    track('condominios_tab_viewed', { tab: activeTab, section: activeSection })
  }, [activeTab, activeSection])

  const unidadesProyecto = unidades.filter(u => u.project_id === selectedProyectoId)
  const proyectoActual = proyectos.find(p => p.id === selectedProyectoId)
  const moneda = proyectoActual?.moneda_condominios ?? proyectoActual?.moneda ?? 'Q'
  const cid = currentUser.company_id ?? ''
  const uid = currentUser.user_id

  // cond:A1 — Contexto único que cada TabDef.render(ctx) consume.
  // Antes vivía como 100+ props dispersos en el switch; ahora es declarativo.
  // useMemo: estabiliza la referencia entre renders mientras los inputs no
  // cambien (tabs reciben el mismo objeto, pueden memorizar si lo necesitan).
  const tabCtx: CondominiosTabContext = useMemo(() => ({
    canCreate, canEdit, onRefresh: cargarDatos,
    proyectoId: selectedProyectoId, proyectoActual, proyectosActivos,
    unidadesProyecto, cid, uid, currentUser, moneda,
    cuotas, visitantes, amenidades, reservas, bloqueosAmenidades, tickets, anuncios,
    parqueos, mascotas, paquetes, infracciones, rondas, novedades, areas, rutas,
    puntosControl, visitasControl, plantillasCargo, bloquesTurno, tareasBloque,
    revisionesTarea, contratos, asambleas, contratosProveedores, objetos, agenda,
    inventario, polizas, inspecciones, personal, clientesBirthday,
    contactosEmergencia, documentos, residuos, bodegas, onboardings, propuestas,
    memorias, reservasSTR, locales, serviciosHK, firmas, solicitudesConcierge,
    llaves, encuestas, respuestasEncuesta, gastos, presupuestos, alertasCondominio,
    eventosCalendario, configuracion, solicitudes, solicitudesRenta,
    solicitudesMudanza, junta, prestamos, comunicados, actas, cierres, reglas,
    medidores, votaciones, sanciones, planesMantenimiento, correspondencia,
    libroNovedades, acuerdos, vehiculos, eventosComunidad, asistentesEvento,
    cajasChicas, movimientosCaja, obras, planesPage, accesosRes, garantias,
    entregas, avisosCobro, bitacoraRegistros, evaluacionesProv, reclamos,
    fondoReserva, permisosObra, tarifas, incidentes, checklistAreas,
    progLimpieza, consumoEnergia, historialRes, estacVisita, bitacoraGuardia,
    equiposComunes, presenciaPersonal, suministros, movimientosSuministro,
    tareasCond, cobranzas, certificados, visitasFrecuentes, reglamento,
    controlPlagas, cargosAdicionales, programaActividades, registroAutoridades,
    notasAdmin, controlPiscina, mantenimientoJardineria, incidenciasElevador,
    mantenimientoCisterna, controlGenerador, controlIncendio, camarasSeguridad,
    lecturasGas, recordatorios, plantillasCuota, bitacoraAcciones, recargosMora,
    conveniosCuota, historialSaldos, notificacionesEnviadas, reglasMora,
    campanasCobro, cierresAnuales, cobranzaJudicial, recibosDigitales,
    informesMensuales, sugerencias, vencimientosExtra, capacitaciones,
    proyectosCond, articulosManual, automatizaciones, plantillasMensaje,
    flujoAprobacion, ordenesCompra, asambleasDigital, proformas, conciliaciones,
    fondoReservaMovs, configCondominio,
  }), [
    canCreate, canEdit, cargarDatos,
    selectedProyectoId, proyectoActual, proyectosActivos,
    unidadesProyecto, cid, uid, currentUser, moneda,
    cuotas, visitantes, amenidades, reservas, bloqueosAmenidades, tickets, anuncios,
    parqueos, mascotas, paquetes, infracciones, rondas, novedades, areas, rutas,
    puntosControl, visitasControl, plantillasCargo, bloquesTurno, tareasBloque,
    revisionesTarea, contratos, asambleas, contratosProveedores, objetos, agenda,
    inventario, polizas, inspecciones, personal, clientesBirthday,
    contactosEmergencia, documentos, residuos, bodegas, onboardings, propuestas,
    memorias, reservasSTR, locales, serviciosHK, firmas, solicitudesConcierge,
    llaves, encuestas, respuestasEncuesta, gastos, presupuestos, alertasCondominio,
    eventosCalendario, configuracion, solicitudes, solicitudesRenta,
    solicitudesMudanza, junta, prestamos, comunicados, actas, cierres, reglas,
    medidores, votaciones, sanciones, planesMantenimiento, correspondencia,
    libroNovedades, acuerdos, vehiculos, eventosComunidad, asistentesEvento,
    cajasChicas, movimientosCaja, obras, planesPage, accesosRes, garantias,
    entregas, avisosCobro, bitacoraRegistros, evaluacionesProv, reclamos,
    fondoReserva, permisosObra, tarifas, incidentes, checklistAreas,
    progLimpieza, consumoEnergia, historialRes, estacVisita, bitacoraGuardia,
    equiposComunes, presenciaPersonal, suministros, movimientosSuministro,
    tareasCond, cobranzas, certificados, visitasFrecuentes, reglamento,
    controlPlagas, cargosAdicionales, programaActividades, registroAutoridades,
    notasAdmin, controlPiscina, mantenimientoJardineria, incidenciasElevador,
    mantenimientoCisterna, controlGenerador, controlIncendio, camarasSeguridad,
    lecturasGas, recordatorios, plantillasCuota, bitacoraAcciones, recargosMora,
    conveniosCuota, historialSaldos, notificacionesEnviadas, reglasMora,
    campanasCobro, cierresAnuales, cobranzaJudicial, recibosDigitales,
    informesMensuales, sugerencias, vencimientosExtra, capacitaciones,
    proyectosCond, articulosManual, automatizaciones, plantillasMensaje,
    flujoAprobacion, ordenesCompra, asambleasDigital, proformas, conciliaciones,
    fondoReservaMovs, configCondominio,
  ])


  if (proyectosActivos.length === 0) {
    return (
      <EmptyState
        icon="🏢"
        title="No hay proyectos activos"
        description='Crea un proyecto en "Mis Proyectos" para comenzar a usar el módulo Condominios.'
      />
    )
  }

  // F3.14: Command palette items — solo tabs visibles para el usuario.
  // Permite búsqueda y salto rápido a cualquiera de los 191 tabs via Cmd+K.
  const commandItems: CommandItem[] = useMemo(() => {
    return SECTIONS.flatMap(sec => {
      return sec.tabs
        .map(tid => TABS.find(t => t.id === tid))
        .filter((t): t is { id: CondominioTab; label: string; icon: string } =>
          Boolean(t) && canViewCondominiosTabByPermission(currentUser, t!.id)
        )
        .map(t => ({
          id: t.id,
          label: t.label,
          icon: t.icon,
          group: sec.label,
          onSelect: () => {
            setActiveSection(sec.id)
            setActiveTab(t.id)
          },
        }))
    })
  }, [currentUser])

  // Registra los tabs de Condominios en el palette global (App.tsx). El
  // CommandPalette en App.tsx renderiza todos los items registrados + las
  // secciones top-level. Al desmontar, los tabs se desregistran.
  useEffect(() => {
    return registerCommands(commandItems)
  }, [commandItems])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid var(--at-line)', background: 'var(--at-surface)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🏢</span>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)' }}>Condominios</h1>
          </div>
          {/* cond:B5/B6 — banner de contexto activo + switcher (sin recarga) */}
          <CondominioContextBar loading={loading} />
        </div>

        {/* Barra de pestañas de la sección activa (nivel 2) — scroll horizontal */}
        <div className="tab-strip-scrollable" style={{ display: 'flex', gap: 1, overflowX: 'auto', marginTop: 8, borderBottom: '2px solid var(--at-line)' }} role="tablist" aria-label="Pestañas de la sección activa">
          {visibleSections.find(s => s.id === activeSection)?.tabs
            .map(tid => TABS.find(t => t.id === tid))
            .filter(Boolean)
            .map(tab => {
              if (!tab) return null
              const activa = activeTab === tab.id
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as CondominioTab)}
                  type="button" role="tab" aria-selected={activa} aria-current={activa ? 'page' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 13px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                    fontSize: 12, fontWeight: activa ? 700 : 500,
                    background: activa ? 'var(--at-ink)' : 'var(--at-chip)',
                    color: activa ? 'white' : 'var(--at-ink-3)',
                    borderRadius: '6px 6px 0 0',
                    borderBottom: activa ? '2px solid var(--at-ink)' : '2px solid transparent',
                    marginBottom: -2,
                  }}>
                  <span aria-hidden="true">{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              )
            })}
        </div>

      </div>

      {/* Body: sidebar + content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Sidebar de sub-tabs */}
        <aside style={{
          width: sidebarCollapsed ? 0 : 200,
          minWidth: sidebarCollapsed ? 0 : 200,
          overflowY: 'auto',
          overflowX: 'hidden',
          background: 'var(--at-surface-2)',
          borderRight: '1px solid var(--at-line)',
          transition: 'width 0.18s ease, min-width 0.18s ease',
          flexShrink: 0,
        }}>
          {!sidebarCollapsed && (
            <nav style={{ padding: '6px 0' }} aria-label="Secciones del módulo condominios">
              <div style={{ padding: '6px 14px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', color: 'var(--at-ink-3)', textTransform: 'uppercase' }}>
                Secciones
              </div>
              {visibleSections.map(sec => {
                const activa = activeSection === sec.id
                return (
                  <button
                    key={sec.id}
                    type="button"
                    aria-current={activa ? 'page' : undefined}
                    onClick={() => {
                      setActiveSection(sec.id)
                      if (!sec.tabs.includes(activeTab)) {
                        const primero = sec.tabs.find(tid => TABS.some(t => t.id === tid))
                        if (primero) setActiveTab(primero as CondominioTab)
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      width: '100%', padding: '8px 14px', border: 'none',
                      background: activa ? 'var(--at-primary-soft)' : 'transparent',
                      color: activa ? 'var(--at-primary-hover)' : 'var(--at-ink-2)',
                      borderLeft: `3px solid ${activa ? 'var(--at-primary)' : 'transparent'}`,
                      cursor: 'pointer', fontSize: '13px',
                      fontWeight: activa ? 700 : 500,
                      textAlign: 'left',
                    }}>
                    <span aria-hidden="true">{sec.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sec.label}
                    </span>
                  </button>
                )
              })}
            </nav>
          )}
        </aside>

        {/* Toggle collapse */}
        <button onClick={() => setSidebarCollapsed(p => !p)}
          title={sidebarCollapsed ? 'Expandir menú' : 'Colapsar menú'}
          style={{
            flexShrink: 0, width: '18px',
            background: 'var(--at-chip)', border: 'none', borderRight: '1px solid var(--at-line)',
            cursor: 'pointer', color: 'var(--at-ink-3)', fontSize: '10px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          {sidebarCollapsed ? '›' : '‹'}
        </button>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
        {/* infra:I14 — provides the active project_id to condominios-media uploaders. */}
        <MediaScopeProvider projectId={selectedProyectoId}>
        <Suspense fallback={<TabFallback />}>
        {TAB_BY_ID[activeTab]?.render(tabCtx)}
        {ticketSeleccionado && (
          <ComentariosTicketTab
            ticket={ticketSeleccionado}
            comentarios={comentariosTicket}
            companyId={cid}
            autorNombre={currentUser.name ?? ''}
            canCreate={canCreate('condominios')}
            onRefresh={cargarDatos}
            onClose={() => setTicketSeleccionado(null)}
          />
        )}
        </Suspense>
        </MediaScopeProvider>
        </div>
      </div>
    </div>
  )
}
