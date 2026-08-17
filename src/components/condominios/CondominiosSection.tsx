import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import {
  fetchCondominiosPanelData,
  fetchCondominiosSectionData,
  fetchCondominiosRondasData,
  fetchVisitasControlRecent,
  fetchCondominiosTareasData,
  fetchTareasBloqueData,
  fetchCondominiosLimpiezaData,
  fetchCondominiosTurnosData,
  fetchClientesConCumple,
} from '../../domain/condominios/sectionData'
import { track } from '../../lib/analytics'
import { canViewCondominiosTabByPermission, canActInCondominiosTab } from '../../lib/permissions'
import { SECTIONS, sectionForTab } from './sections'
import { type CommandItem } from '../shared/CommandPalette'
import { registerCommands } from '../../lib/commandRegistry'
import { EmptyState } from '../shared/EmptyState'
import { AccessDenied } from '../shared/AccessDenied'
import { MediaScopeProvider } from '../shared/MediaScopeContext'
import { TabStrip } from '../shared/TabStrip'
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
  SolicitudResidente, SolicitudRentaUnidad, SolicitudMudanzaUnidad, MensajePortal, MiembroJunta, PrestamoEquipo, ComunicadoCondominio,
  ActaReunion, CierreMensual, ReglaNotificacion, MedidorUnidad,
  Votacion, SancionCondominio, PlanMantenimiento,
  CorrespondenciaCondominio, LibroNovedad, SeguimientoAcuerdo,
  VehiculoResidente, EventoComunidad, RegistroAsistenteEvento, CajaChica, MovimientoCaja, ObraMejora,
  PlanPagoCond, AccesoResidente, GarantiaEquipo, EntregaUnidad,
  AvisoCobro, BitacoraManto as BitacoraMantoType, EvaluacionProveedor, ReclamoCondominio,
  FondoReserva, PermisoObraUnidad, TarifaCondominio, IncidenteSeguridad,
  ChecklistArea, ProgramacionLimpieza, EjecucionLimpieza, ConsumoEnergiaArea, HistorialResidente,
  EstacionamientoVisita, BitacoraGuardia, EquipoComun, PresenciaPersonal,
  PlantillaHorario, AsignacionTurno, DiaNoLaborable, AusenciaPersonal,
  SuministroCondominio, MovimientoSuministro, TareaCondominio, GestionCobranza,
  SolicitudCertificado, VisitaFrecuente, ArticuloReglamento, ControlPlagas,
  CargoAdicionalUnidad, ProgramaActividad, RegistroAutoridad, NotaAdmin,
  ControlPiscina, MantenimientoJardineria, IncidenciaElevador, MantenimientoCisterna,
  ControlGenerador, ControlSistemaIncendio, ControlCamaraSeguridad, LecturaMedidorGas,
  RecordatorioCondominio, PlantillaCuota, BitacoraAccion,
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
// SECTIONS + helpers viven ahora en ./sections (fuente única compartida con el
// Sidebar global, que expone las 10 secciones bajo "Manejo Condominios").


interface Props {
  proyectos: Proyecto[]
  unidades: Unidad[]
  currentUser: UserSession
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

function CondominiosSectionInner({ proyectos, unidades, currentUser }: Props) {
  // Permisos por tab (RBAC granular, migración 20260703000000): cada tab
  // resuelve condominios.tab.<tab>.<action>, con fallback al permiso legado de
  // módulo completo platform.condominios.<action>. Los tabs llaman con su
  // propio id (ctx.canCreate('cuotas')), no con 'condominios'.
  // 'cliente' (portal del residente) conserva el bypass que tenía en
  // usePermissions (EXEMPT_ROLES incluye cliente; isExemptPlatformRole no).
  const esCliente = currentUser.role === 'cliente'
  const canCreate = useCallback((tabId: string) => esCliente || canActInCondominiosTab(currentUser, tabId, 'create'), [currentUser, esCliente])
  const canEdit = useCallback((tabId: string) => esCliente || canActInCondominiosTab(currentUser, tabId, 'edit'), [currentUser, esCliente])
  const canChangeStatus = useCallback((tabId: string) => esCliente || canActInCondominiosTab(currentUser, tabId, 'change_status'), [currentUser, esCliente])
  const canApprove = useCallback((tabId: string) => esCliente || canActInCondominiosTab(currentUser, tabId, 'approve'), [currentUser, esCliente])
  const canDelete = useCallback((tabId: string) => esCliente || canActInCondominiosTab(currentUser, tabId, 'delete'), [currentUser, esCliente])

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
  // La sección activa se deriva del tab en la URL (fuente única). Cambiar de
  // sección = navegar a su primer tab; ya no hay state local ni riel interno
  // (las 10 secciones viven en el sidebar global).
  const activeSection = sectionForTab(activeTab)
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
  const [mensajesPortal, setMensajesPortal] = useState<MensajePortal[]>([])
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
  const [ejecLimpieza, setEjecLimpieza] = useState<EjecucionLimpieza[]>([])
  const [consumoEnergia, setConsumoEnergia] = useState<ConsumoEnergiaArea[]>([])
  const [historialRes, setHistorialRes] = useState<HistorialResidente[]>([])
  // Fase 20
  const [estacVisita, setEstacVisita] = useState<EstacionamientoVisita[]>([])
  const [bitacoraGuardia, setBitacoraGuardia] = useState<BitacoraGuardia[]>([])
  const [equiposComunes, setEquiposComunes] = useState<EquipoComun[]>([])
  const [presenciaPersonal, setPresenciaPersonal] = useState<PresenciaPersonal[]>([])
  const [plantillasHorario, setPlantillasHorario] = useState<PlantillaHorario[]>([])
  const [asignacionesTurno, setAsignacionesTurno] = useState<AsignacionTurno[]>([])
  const [diasNoLaborables, setDiasNoLaborables] = useState<DiaNoLaborable[]>([])
  const [ausenciasPersonal, setAusenciasPersonal] = useState<AusenciaPersonal[]>([])
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
  // Fase 36 — GeneracionCuotasLog loaded on demand inside GeneradorCuotasTab
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

  const restoCargadoRef = useRef(false)
  const runSeqRef = useRef(0)

  // P2 perf — carga por FASES: abrir Condominios dispara solo las 9 colecciones
  // del tab Panel (fetchCondominiosPanelData); el resto (~132 queries en 5
  // batches) se difiere al primer tab distinto de Panel. `restoCargadoRef` marca
  // si el batch grande ya corrió (se resetea al cambiar de proyecto/empresa);
  // `runSeqRef` descarta cargas viejas que resuelven tarde (cambio de proyecto o
  // panel→todo en vuelo) para que no pisen datos ni apaguen el spinner ajeno.
  const cargarDatos = useCallback(async (fase?: 'panel' | 'todo') => {
    if (!selectedProyectoId || !currentUser.company_id) return
    // Sin fase explícita (onRefresh de los tabs, que puede llegar con un event
    // como argumento): recargar lo ya cargado — 'todo' si el batch grande ya
    // corrió, 'panel' si seguimos en la fase inicial.
    const efectiva: 'panel' | 'todo' =
      fase === 'panel' || fase === 'todo' ? fase : (restoCargadoRef.current ? 'todo' : 'panel')
    const run = ++runSeqRef.current
    setLoading(true)

    const pid = selectedProyectoId
    const cid = currentUser.company_id

    const mapUnidad = <T extends object>(data: Record<string, unknown>[]): T[] =>
      data.map(r => ({ ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre } as T))

    if (efectiva === 'panel') {
      const [
        cuotasRes, visitantesRes, amenidadesRes, reservasRes, ticketsRes,
        paquetesRes, polizasRes, inspeccionesRes, gastosRes,
      ] = await fetchCondominiosPanelData(pid, cid)
      if (runSeqRef.current !== run) return // una carga más nueva ya corre
      // Mismos mapeos que el batch grande (mantener sincronizados).
      setCuotas(mapUnidad<CuotaCondominio>(cuotasRes.data ?? []))
      setVisitantes(mapUnidad<Visitante>(visitantesRes.data ?? []))
      setAmenidades((amenidadesRes.data ?? []) as Amenidad[])
      setReservas((reservasRes.data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        amenidad_nombre: (r.amenidades as { nombre: string } | null)?.nombre,
        unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
      } as ReservaAmenidad)))
      setTickets(mapUnidad<TicketMantenimiento>(ticketsRes.data ?? []))
      setPaquetes(mapUnidad<PaqueteRecibido>(paquetesRes.data ?? []))
      setPolizas((polizasRes.data ?? []) as PolizaSeguro[])
      setInspecciones((inspeccionesRes.data ?? []) as InspeccionNormativa[])
      setGastos((gastosRes.data ?? []) as GastoCondominio[])
      setLoading(false)
      return
    }

    // Optimista y SÍNCRONO (antes del primer await): dedupe del disparo por
    // cambio de tab mientras este batch está en vuelo.
    restoCargadoRef.current = true

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
      mensajesPortalRes,
    ] = await fetchCondominiosSectionData(pid, cid)
    if (runSeqRef.current !== run) return // una carga más nueva ya corre

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

    // Control de asignación de turnos (20260820000000 / 000100). Aparte del
    // Promise.all grande por el mismo motivo que las rutas de limpieza: las
    // tablas son nuevas y, si un entorno todavía no tiene la migración
    // aplicada, el fallo se queda aquí (listas vacías) y no tumba el panel.
    const [plantillasHorarioRes, asignacionesTurnoRes, diasNoLabRes, ausenciasRes] =
      await fetchCondominiosTurnosData(pid, cid)
    setPlantillasHorario((plantillasHorarioRes.data ?? []) as PlantillaHorario[])
    setAsignacionesTurno(
      (asignacionesTurnoRes.data ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        // Las columnas jsonb llegan como Json; el shape lo fija AsignacionTurno.
        dias_semana: (a.dias_semana as number[] | null) ?? [],
        fechas_especificas: (a.fechas_especificas as string[] | null) ?? [],
        personal_nombre: (a.personal_condominio as { nombre: string; cargo: string } | null)?.nombre,
        personal_cargo:  (a.personal_condominio as { nombre: string; cargo: string } | null)?.cargo,
        plantilla_nombre: (a.plantillas_horario as { nombre: string } | null)?.nombre,
      })) as AsignacionTurno[]
    )
    setDiasNoLaborables((diasNoLabRes.data ?? []) as DiaNoLaborable[])
    setAusenciasPersonal(
      (ausenciasRes.data ?? []).map((a: Record<string, unknown>) => ({
        ...a,
        personal_nombre: (a.personal_condominio as { nombre: string; cargo: string } | null)?.nombre,
        personal_cargo:  (a.personal_condominio as { nombre: string; cargo: string } | null)?.cargo,
      })) as AusenciaPersonal[]
    )

    // Rutas de limpieza (20260807130000). Va aparte del Promise.all grande
    // porque la tabla es nueva: si el entorno todavía no tiene la migración
    // aplicada, el error se queda aquí (lista vacía) en vez de tumbar la carga
    // de las otras ~140 colecciones del panel.
    const ejecLimpiezaRes = await fetchCondominiosLimpiezaData(pid, cid)
    setEjecLimpieza(
      (ejecLimpiezaRes.data ?? []).map((e: Record<string, unknown>) => ({
        ...e,
        foto_urls: (e.foto_urls as string[] | null) ?? [],
      })) as EjecucionLimpieza[]
    )

    if (runSeqRef.current !== run) return

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
    setMensajesPortal(mapUnidad<MensajePortal>(mensajesPortalRes.data ?? []))
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

    if (runSeqRef.current === run) setLoading(false)
  }, [selectedProyectoId, currentUser.company_id])

  // Espejo de activeTab en un ref para que el efecto de carga inicial (que solo
  // depende de cargarDatos) decida la fase sin re-dispararse en cada cambio de tab.
  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  // Carga inicial / cambio de proyecto-empresa: resetea la fase y carga según el
  // tab actual (deep-link a un tab ≠ Panel necesita el batch completo).
  useEffect(() => {
    restoCargadoRef.current = false
    void cargarDatos(activeTabRef.current === 'panel' ? 'panel' : 'todo')
  }, [cargarDatos])

  // Primer tab distinto de Panel → carga diferida del batch grande. El set
  // optimista de restoCargadoRef dentro de cargarDatos deduplica disparos.
  useEffect(() => {
    if (activeTab !== 'panel' && !restoCargadoRef.current) void cargarDatos('todo')
  }, [activeTab, cargarDatos])

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
    canCreate, canEdit, canChangeStatus, canApprove, canDelete, onRefresh: cargarDatos,
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
    solicitudesMudanza, mensajesPortal, junta, prestamos, comunicados, actas, cierres, reglas,
    medidores, votaciones, sanciones, planesMantenimiento, correspondencia,
    libroNovedades, acuerdos, vehiculos, eventosComunidad, asistentesEvento,
    cajasChicas, movimientosCaja, obras, planesPage, accesosRes, garantias,
    entregas, avisosCobro, bitacoraRegistros, evaluacionesProv, reclamos,
    fondoReserva, permisosObra, tarifas, incidentes, checklistAreas,
    progLimpieza, ejecLimpieza, consumoEnergia, historialRes, estacVisita, bitacoraGuardia,
    equiposComunes, presenciaPersonal, suministros, movimientosSuministro,
    plantillasHorario, asignacionesTurno, diasNoLaborables, ausenciasPersonal,
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
    canCreate, canEdit, canChangeStatus, canApprove, canDelete, cargarDatos,
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
    solicitudesMudanza, mensajesPortal, junta, prestamos, comunicados, actas, cierres, reglas,
    medidores, votaciones, sanciones, planesMantenimiento, correspondencia,
    libroNovedades, acuerdos, vehiculos, eventosComunidad, asistentesEvento,
    cajasChicas, movimientosCaja, obras, planesPage, accesosRes, garantias,
    entregas, avisosCobro, bitacoraRegistros, evaluacionesProv, reclamos,
    fondoReserva, permisosObra, tarifas, incidentes, checklistAreas,
    progLimpieza, ejecLimpieza, consumoEnergia, historialRes, estacVisita, bitacoraGuardia,
    equiposComunes, presenciaPersonal, suministros, movimientosSuministro,
    plantillasHorario, asignacionesTurno, diasNoLaborables, ausenciasPersonal,
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

  // Early return DESPUÉS de todos los hooks: las Rules of Hooks exigen que el
  // número y orden de hooks sea idéntico en cada render. Cuando este return
  // estaba antes de los hooks de arriba (commandItems / registerCommands), pasar
  // de "sin proyectos" a "con proyectos" cambiaba la cantidad de hooks → React
  // error #310 ("Rendered more hooks than during the previous render").
  if (proyectosActivos.length === 0) {
    return (
      <EmptyState
        icon="🏢"
        title="No hay proyectos activos"
        description='Crea un proyecto en "Mis Proyectos" para comenzar a usar el módulo Condominios.'
      />
    )
  }

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

        {/* Barra de pestañas de la sección activa (nivel 2) — scroll horizontal.
            El visual vive en <TabStrip>, compartido con el resto de módulos. */}
        <div style={{ marginTop: 8 }}>
          <TabStrip
            ariaLabel="Pestañas de la sección activa"
            value={activeTab}
            onChange={(id) => setActiveTab(id as CondominioTab)}
            items={(visibleSections.find(s => s.id === activeSection)?.tabs ?? [])
              .map(tid => TABS.find(t => t.id === tid))
              .filter((t): t is NonNullable<typeof t> => Boolean(t))
              .map(t => ({ id: t.id as CondominioTab, label: t.label, icon: t.icon }))}
          />
        </div>

      </div>

      {/* Body: contenido a todo el ancho. Las 10 secciones viven en el sidebar
          global; arriba quedan las pestañas de la sección activa. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* infra:I14 — provides the active project_id to condominios-media uploaders. */}
        <MediaScopeProvider projectId={selectedProyectoId}>
        <Suspense fallback={<TabFallback />}>
        {/* Gate de vista también en el render: la nav y el command palette ya
            filtran por permiso, pero un deep-link (/condominios/:tab) llega
            directo aquí sin pasar por ellos. */}
        {TAB_BY_ID[activeTab] && !canViewCondominiosTabByPermission(currentUser, activeTab)
          ? <AccessDenied />
          : TAB_BY_ID[activeTab]?.render(tabCtx)}
        </Suspense>
        </MediaScopeProvider>
      </div>
    </div>
  )
}
