// cond:A1 — Registry de tabs de condominios.
// Reemplaza el switch gigante de CondominiosSection con un array declarativo.
// Cada entrada tiene `render(ctx)`, lo que mantiene el type-checking estático
// (no usamos `Record<string, unknown>`) y permite que CondominiosSection se
// quede sólo con el dueño del estado + el contenedor visual.
import { lazy, type ReactNode } from 'react'
import { FeatureGate } from '../../lib/featureFlags'
import { UpgradeCTA } from '../shared/UpgradeCTA'
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
import { ComunicacionSection } from '../comunicacion/ComunicacionSection'

// ── Identificador de cada tab (la unión completa) ───────────────────────────
export type CondominioTab =
  | 'panel' | 'cuotas' | 'visitantes' | 'amenidades' | 'mantenimiento' | 'comunidad'
  | 'parqueos' | 'mascotas' | 'paqueteria' | 'infracciones' | 'seguridad' | 'arrendamientos'
  | 'asambleas' | 'proveedores' | 'objetos' | 'agenda'
  | 'inventario' | 'polizas' | 'inspecciones' | 'personal'
  | 'emergencias' | 'documentos' | 'residuos'
  | 'bodegas' | 'onboarding' | 'propuestas' | 'memoria'
  | 'str' | 'locales' | 'sostenibilidad' | 'housekeeping'
  | 'firmas' | 'concierge' | 'llaves' | 'encuestas'
  | 'contabilidad' | 'presupuesto' | 'alertas' | 'reportes'
  | 'estadocuenta' | 'calendario' | 'directorio' | 'configuracion'
  | 'solicitudes' | 'solicitudes_renta' | 'solicitudes_mudanza' | 'junta' | 'prestamos' | 'comunicados'
  | 'actas' | 'cierres' | 'notificaciones' | 'medidores_unidad'
  | 'votaciones' | 'sanciones' | 'mant_preventivo' | 'portal'
  | 'correspondencia' | 'libro_novedades' | 'acuerdos' | 'dashboard_ejecutivo'
  | 'vehiculos' | 'eventos_comunidad' | 'caja_chica' | 'obras'
  | 'plan_pago' | 'accesos_res' | 'garantias' | 'entrega_unidad'
  | 'avisos_cobro' | 'bitacora_manto' | 'eval_proveedor' | 'reclamos'
  | 'fondo_reserva' | 'permisos_obra' | 'tarifas' | 'incidentes'
  | 'checklist_areas' | 'prog_limpieza' | 'consumo_energia' | 'historial_res'
  | 'estac_visita' | 'bitacora_guardia' | 'equipos' | 'presencia'
  | 'suministros' | 'tareas_cond' | 'cobranza'
  | 'certificados' | 'vis_frecuentes' | 'reglamento' | 'control_plagas'
  | 'cargos_adicionales' | 'programa_actividades' | 'reg_autoridades' | 'notas_admin'
  | 'control_piscina' | 'jardineria' | 'elevadores' | 'cisternas'
  | 'generador' | 'incendio' | 'camaras' | 'gas'
  | 'recordatorios' | 'plantillas_cuota' | 'bitacora_acciones'
  | 'recargos_mora' | 'convenios_cuota' | 'historial_saldos' | 'notificaciones_enviadas'
  | 'reglas_mora' | 'campanas_cobro' | 'cierre_anual' | 'kpis_financieros'
  | 'cobranza_judicial' | 'recibos_digitales' | 'informe_mensual' | 'buzon_sugerencias'
  | 'vencimientos_criticos' | 'capacitacion_personal' | 'proyectos_cond' | 'metricas_servicio'
  | 'analisis_cartera' | 'integracion_agua' | 'centro_costos' | 'manual_residente'
  | 'exportacion' | 'multi_condominio' | 'automatizaciones' | 'scoring_unidades'
  | 'panel_turno' | 'plantillas_mensaje' | 'flujo_aprobacion' | 'cuadro_mando'
  | 'generacion_cuotas' | 'mapa_unidades' | 'envio_masivo' | 'resumen_ejecutivo'
  | 'ordenes_compra' | 'graficas_tendencias' | 'control_accesos_qr' | 'asamblea_digital'
  | 'comparativo_presupuesto' | 'proformas' | 'bitacora_eventos' | 'indice_calidad'
  | 'kanban_tickets' | 'conciliacion_cobros' | 'estado_cuenta_residente' | 'pronostico_financiero'
  | 'simulador_cuotas' | 'calendario_mantenimiento' | 'reporte_deudores' | 'resumen_residente'
  | 'gestor_alertas' | 'utilizacion_amenidades' | 'comparativo_anual' | 'gantt_mantenimiento'
  | 'mapa_calor_cuotas' | 'encuesta_dashboard' | 'analisis_visitantes' | 'informe_ejecutivo'
  | 'tablero_ocupacion' | 'gestion_fondo' | 'dashboard_sostenibilidad' | 'configuracion_cond'
  | 'bitacora_actividad' | 'panel_directivo' | 'gestion_conflictos' | 'directorio_comunidad'
  | 'centro_notificaciones' | 'cumpleanos' | 'rutas_ronda'
  | 'plantillas_cargo' | 'tareas_personal' | 'revision_tareas'
  | 'desempeno_personal' | 'reporte_consolidado' | 'comunicacion_condominios'

// ── Contexto pasado a cada `render(ctx)` ─────────────────────────────────────
// Centraliza todo el estado y derivados que CondominiosSection tenía dispersos
// como props del switch. Tabs no leen useState directo; reciben datos por ctx.
export interface CondominiosTabContext {
  // Permisos y acciones
  canCreate: (section: string) => boolean
  canEdit: (section: string) => boolean
  onRefresh: () => void | Promise<void>
  // Contexto de proyecto / usuario
  proyectoId: string
  proyectoActual: Proyecto | undefined
  proyectosActivos: Proyecto[]
  unidadesProyecto: Unidad[]
  cid: string
  uid: string
  currentUser: UserSession
  moneda: string
  // Datos
  cuotas: CuotaCondominio[]
  visitantes: Visitante[]
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  bloqueosAmenidades: BloqueoAmenidad[]
  tickets: TicketMantenimiento[]
  anuncios: AnuncioComunidad[]
  parqueos: ParqueoCondominio[]
  mascotas: Mascota[]
  paquetes: PaqueteRecibido[]
  infracciones: InfraccionCondominio[]
  rondas: RondaSeguridad[]
  novedades: NovedadSeguridad[]
  areas: AreaCondominio[]
  rutas: RutaRonda[]
  puntosControl: PuntoControlRuta[]
  visitasControl: VisitaControl[]
  plantillasCargo: PlantillaTareaCargo[]
  bloquesTurno: BloqueTurno[]
  tareasBloque: TareaBloque[]
  revisionesTarea: RevisionTarea[]
  contratos: ContratoArrendamiento[]
  asambleas: Asamblea[]
  contratosProveedores: ContratoProveedor[]
  objetos: ObjetoPerdido[]
  agenda: AgendaItem[]
  inventario: ItemInventario[]
  polizas: PolizaSeguro[]
  inspecciones: InspeccionNormativa[]
  personal: PersonalCondominio[]
  clientesBirthday: { id: string; nombre: string; fecha_nacimiento: string; unidad_nombre?: string }[]
  contactosEmergencia: ContactoEmergencia[]
  documentos: DocumentoCondominio[]
  residuos: RegistroResiduo[]
  bodegas: BodegaCondominio[]
  onboardings: OnboardingResidente[]
  propuestas: PropuestaInversion[]
  memorias: MemoriaLabores[]
  reservasSTR: ReservaSTR[]
  locales: LocalComercial[]
  serviciosHK: ServicioHousekeeping[]
  firmas: FirmaDigital[]
  solicitudesConcierge: SolicitudConcierge[]
  llaves: LlaveCondominio[]
  encuestas: Encuesta[]
  respuestasEncuesta: RespuestaEncuesta[]
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  alertasCondominio: AlertaCondominio[]
  eventosCalendario: EventoCalendario[]
  configuracion: ConfiguracionCondominio[]
  solicitudes: SolicitudResidente[]
  solicitudesRenta: SolicitudRentaUnidad[]
  solicitudesMudanza: SolicitudMudanzaUnidad[]
  junta: MiembroJunta[]
  prestamos: PrestamoEquipo[]
  comunicados: ComunicadoCondominio[]
  actas: ActaReunion[]
  cierres: CierreMensual[]
  reglas: ReglaNotificacion[]
  medidores: MedidorUnidad[]
  votaciones: Votacion[]
  sanciones: SancionCondominio[]
  planesMantenimiento: PlanMantenimiento[]
  correspondencia: CorrespondenciaCondominio[]
  libroNovedades: LibroNovedad[]
  acuerdos: SeguimientoAcuerdo[]
  vehiculos: VehiculoResidente[]
  eventosComunidad: EventoComunidad[]
  asistentesEvento: RegistroAsistenteEvento[]
  cajasChicas: CajaChica[]
  movimientosCaja: MovimientoCaja[]
  obras: ObraMejora[]
  planesPage: PlanPagoCond[]
  accesosRes: AccesoResidente[]
  garantias: GarantiaEquipo[]
  entregas: EntregaUnidad[]
  avisosCobro: AvisoCobro[]
  bitacoraRegistros: BitacoraMantoType[]
  evaluacionesProv: EvaluacionProveedor[]
  reclamos: ReclamoCondominio[]
  fondoReserva: FondoReserva[]
  permisosObra: PermisoObraUnidad[]
  tarifas: TarifaCondominio[]
  incidentes: IncidenteSeguridad[]
  checklistAreas: ChecklistArea[]
  progLimpieza: ProgramacionLimpieza[]
  consumoEnergia: ConsumoEnergiaArea[]
  historialRes: HistorialResidente[]
  estacVisita: EstacionamientoVisita[]
  bitacoraGuardia: BitacoraGuardia[]
  equiposComunes: EquipoComun[]
  presenciaPersonal: PresenciaPersonal[]
  suministros: SuministroCondominio[]
  movimientosSuministro: MovimientoSuministro[]
  tareasCond: TareaCondominio[]
  cobranzas: GestionCobranza[]
  certificados: SolicitudCertificado[]
  visitasFrecuentes: VisitaFrecuente[]
  reglamento: ArticuloReglamento[]
  controlPlagas: ControlPlagas[]
  cargosAdicionales: CargoAdicionalUnidad[]
  programaActividades: ProgramaActividad[]
  registroAutoridades: RegistroAutoridad[]
  notasAdmin: NotaAdmin[]
  controlPiscina: ControlPiscina[]
  mantenimientoJardineria: MantenimientoJardineria[]
  incidenciasElevador: IncidenciaElevador[]
  mantenimientoCisterna: MantenimientoCisterna[]
  controlGenerador: ControlGenerador[]
  controlIncendio: ControlSistemaIncendio[]
  camarasSeguridad: ControlCamaraSeguridad[]
  lecturasGas: LecturaMedidorGas[]
  recordatorios: RecordatorioCondominio[]
  plantillasCuota: PlantillaCuota[]
  bitacoraAcciones: BitacoraAccion[]
  recargosMora: RecargoMora[]
  conveniosCuota: ConvenioCuotaCond[]
  historialSaldos: HistorialSaldoUnidad[]
  notificacionesEnviadas: NotificacionEnviada[]
  reglasMora: ReglaMoraConfig[]
  campanasCobro: CampanaCobro[]
  cierresAnuales: CierreAnual[]
  cobranzaJudicial: CobranzaJudicial[]
  recibosDigitales: ReciboDigital[]
  informesMensuales: InformeMensual[]
  sugerencias: SugerenciaCondominio[]
  vencimientosExtra: VencimientoExtra[]
  capacitaciones: CapacitacionPersonal[]
  proyectosCond: ProyectoCondominio[]
  articulosManual: ArticuloManual[]
  automatizaciones: AutomatizacionCond[]
  plantillasMensaje: PlantillaMensajeCond[]
  flujoAprobacion: FlujoAprobacionCond[]
  ordenesCompra: OrdenCompra[]
  asambleasDigital: AsambleaDigital[]
  proformas: Proforma[]
  conciliaciones: ConciliacionCobrosLog[]
  fondoReservaMovs: FondoReservaMovimiento[]
  configCondominio: ConfigCondominio | null
}

export interface TabDef {
  id: CondominioTab
  label: string
  icon: string
  render: (ctx: CondominiosTabContext) => ReactNode
}

// ── Lazy imports — cada tab queda en su propio chunk ────────────────────────
const PanelGeneralTab = lazy(() => import('./tabs/PanelGeneralTab').then(m => ({ default: m.PanelGeneralTab })))
const CuotasTab = lazy(() => import('./tabs/CuotasTab').then(m => ({ default: m.CuotasTab })))
const VisitantesTab = lazy(() => import('./tabs/VisitantesTab').then(m => ({ default: m.VisitantesTab })))
const AmenidadesTab = lazy(() => import('./tabs/AmenidadesTab').then(m => ({ default: m.AmenidadesTab })))
const MantenimientoTab = lazy(() => import('./tabs/MantenimientoTab').then(m => ({ default: m.MantenimientoTab })))
const ComunidadTab = lazy(() => import('./tabs/ComunidadTab').then(m => ({ default: m.ComunidadTab })))
const ParqueosTab = lazy(() => import('./tabs/ParqueosTab').then(m => ({ default: m.ParqueosTab })))
const MascotasTab = lazy(() => import('./tabs/MascotasTab').then(m => ({ default: m.MascotasTab })))
const PaqueteriaTab = lazy(() => import('./tabs/PaqueteriaTab').then(m => ({ default: m.PaqueteriaTab })))
const InfraccionesTab = lazy(() => import('./tabs/InfraccionesTab').then(m => ({ default: m.InfraccionesTab })))
const SeguridadTab = lazy(() => import('./tabs/SeguridadTab').then(m => ({ default: m.SeguridadTab })))
const RutasRondaTab = lazy(() => import('./tabs/RutasRondaTab').then(m => ({ default: m.RutasRondaTab })))
const PlantillasCargoTab = lazy(() => import('./tabs/PlantillasCargoTab').then(m => ({ default: m.PlantillasCargoTab })))
const TareasPersonalTab = lazy(() => import('./tabs/TareasPersonalTab').then(m => ({ default: m.TareasPersonalTab })))
const RevisionTareasTab = lazy(() => import('./tabs/RevisionTareasTab').then(m => ({ default: m.RevisionTareasTab })))
const DesempenoPersonalTab = lazy(() => import('./tabs/DesempenoPersonalTab').then(m => ({ default: m.DesempenoPersonalTab })))
const ReporteConsolidadoTab = lazy(() => import('./tabs/ReporteConsolidadoTab').then(m => ({ default: m.ReporteConsolidadoTab })))
const ArrendamientosTab = lazy(() => import('./tabs/ArrendamientosTab').then(m => ({ default: m.ArrendamientosTab })))
const AsambleasTab = lazy(() => import('./tabs/AsambleasTab').then(m => ({ default: m.AsambleasTab })))
const ProveedoresTab = lazy(() => import('./tabs/ProveedoresTab').then(m => ({ default: m.ProveedoresTab })))
const ObjetosTab = lazy(() => import('./tabs/ObjetosTab').then(m => ({ default: m.ObjetosTab })))
const AgendaTab = lazy(() => import('./tabs/AgendaTab').then(m => ({ default: m.AgendaTab })))
const InventarioTab = lazy(() => import('./tabs/InventarioTab').then(m => ({ default: m.InventarioTab })))
const PolizasTab = lazy(() => import('./tabs/PolizasTab').then(m => ({ default: m.PolizasTab })))
const InspeccionesTab = lazy(() => import('./tabs/InspeccionesTab').then(m => ({ default: m.InspeccionesTab })))
const PersonalTab = lazy(() => import('./tabs/PersonalTab').then(m => ({ default: m.PersonalTab })))
const EmergenciasTab = lazy(() => import('./tabs/EmergenciasTab').then(m => ({ default: m.EmergenciasTab })))
const DocumentosTab = lazy(() => import('./tabs/DocumentosTab').then(m => ({ default: m.DocumentosTab })))
const ResiduosTab = lazy(() => import('./tabs/ResiduosTab').then(m => ({ default: m.ResiduosTab })))
const BodegasTab = lazy(() => import('./tabs/BodegasTab').then(m => ({ default: m.BodegasTab })))
const OnboardingTab = lazy(() => import('./tabs/OnboardingTab').then(m => ({ default: m.OnboardingTab })))
const PropuestasTab = lazy(() => import('./tabs/PropuestasTab').then(m => ({ default: m.PropuestasTab })))
const MemoriaTab = lazy(() => import('./tabs/MemoriaTab').then(m => ({ default: m.MemoriaTab })))
const STRTab = lazy(() => import('./tabs/STRTab').then(m => ({ default: m.STRTab })))
const LocalesTab = lazy(() => import('./tabs/LocalesTab').then(m => ({ default: m.LocalesTab })))
const SostenibilidadTab = lazy(() => import('./tabs/SostenibilidadTab').then(m => ({ default: m.SostenibilidadTab })))
const HousekeepingTab = lazy(() => import('./tabs/HousekeepingTab').then(m => ({ default: m.HousekeepingTab })))
const FirmaDigitalTab = lazy(() => import('./tabs/FirmaDigitalTab').then(m => ({ default: m.FirmaDigitalTab })))
const ConciergeTab = lazy(() => import('./tabs/ConciergeTab').then(m => ({ default: m.ConciergeTab })))
const LlavesTab = lazy(() => import('./tabs/LlavesTab').then(m => ({ default: m.LlavesTab })))
const EncuestasTab = lazy(() => import('./tabs/EncuestasTab').then(m => ({ default: m.EncuestasTab })))
const ContabilidadTab = lazy(() => import('./tabs/ContabilidadTab').then(m => ({ default: m.ContabilidadTab })))
const PresupuestoTab = lazy(() => import('./tabs/PresupuestoTab').then(m => ({ default: m.PresupuestoTab })))
const AlertasTab = lazy(() => import('./tabs/AlertasTab').then(m => ({ default: m.AlertasTab })))
const ReportesTab = lazy(() => import('./tabs/ReportesTab').then(m => ({ default: m.ReportesTab })))
const EstadoCuentaTab = lazy(() => import('./tabs/EstadoCuentaTab').then(m => ({ default: m.EstadoCuentaTab })))
const CalendarioTab = lazy(() => import('./tabs/CalendarioTab').then(m => ({ default: m.CalendarioTab })))
const CumpleanosTab = lazy(() => import('./tabs/CumpleanosTab').then(m => ({ default: m.CumpleanosTab })))
const DirectorioTab = lazy(() => import('./tabs/DirectorioTab').then(m => ({ default: m.DirectorioTab })))
const ConfiguracionTab = lazy(() => import('./tabs/ConfiguracionTab').then(m => ({ default: m.ConfiguracionTab })))
const SolicitudesTab = lazy(() => import('./tabs/SolicitudesTab').then(m => ({ default: m.SolicitudesTab })))
const SolicitudesRentaTab = lazy(() => import('./tabs/SolicitudesRentaTab').then(m => ({ default: m.SolicitudesRentaTab })))
const SolicitudesMudanzaTab = lazy(() => import('./tabs/SolicitudesMudanzaTab').then(m => ({ default: m.SolicitudesMudanzaTab })))
const JuntaTab = lazy(() => import('./tabs/JuntaTab').then(m => ({ default: m.JuntaTab })))
const PrestamoEquiposTab = lazy(() => import('./tabs/PrestamoEquiposTab').then(m => ({ default: m.PrestamoEquiposTab })))
const ComunicadosTab = lazy(() => import('./tabs/ComunicadosTab').then(m => ({ default: m.ComunicadosTab })))
const ActasTab = lazy(() => import('./tabs/ActasTab').then(m => ({ default: m.ActasTab })))
const CierresMensualesTab = lazy(() => import('./tabs/CierresMensualesTab').then(m => ({ default: m.CierresMensualesTab })))
const NotificacionesTab = lazy(() => import('./tabs/NotificacionesTab').then(m => ({ default: m.NotificacionesTab })))
const MedidoresUnidadTab = lazy(() => import('./tabs/MedidoresUnidadTab').then(m => ({ default: m.MedidoresUnidadTab })))
const VotacionesTab = lazy(() => import('./tabs/VotacionesTab').then(m => ({ default: m.VotacionesTab })))
const SancionesTab = lazy(() => import('./tabs/SancionesTab').then(m => ({ default: m.SancionesTab })))
const MantenimientoPrevTab = lazy(() => import('./tabs/MantenimientoPrevTab').then(m => ({ default: m.MantenimientoPrevTab })))
const PortalResidenteTab = lazy(() => import('./tabs/PortalResidenteTab').then(m => ({ default: m.PortalResidenteTab })))
const CorrespondenciaCondTab = lazy(() => import('./tabs/CorrespondenciaCondTab').then(m => ({ default: m.CorrespondenciaCondTab })))
const LibroNovedadesTab = lazy(() => import('./tabs/LibroNovedadesTab').then(m => ({ default: m.LibroNovedadesTab })))
const SeguimientoAcuerdosTab = lazy(() => import('./tabs/SeguimientoAcuerdosTab').then(m => ({ default: m.SeguimientoAcuerdosTab })))
const DashboardEjecutivoTab = lazy(() => import('./tabs/DashboardEjecutivoTab').then(m => ({ default: m.DashboardEjecutivoTab })))
const VehiculosTab = lazy(() => import('./tabs/VehiculosTab').then(m => ({ default: m.VehiculosTab })))
const EventosComunidadTab = lazy(() => import('./tabs/EventosComunidadTab').then(m => ({ default: m.EventosComunidadTab })))
const CajaChicaTab = lazy(() => import('./tabs/CajaChicaTab').then(m => ({ default: m.CajaChicaTab })))
const ObrasTab = lazy(() => import('./tabs/ObrasTab').then(m => ({ default: m.ObrasTab })))
const PlanPagoCondTab = lazy(() => import('./tabs/PlanPagoCondTab').then(m => ({ default: m.PlanPagoCondTab })))
const AccesosResTab = lazy(() => import('./tabs/AccesosResTab').then(m => ({ default: m.AccesosResTab })))
const GarantiasEquipoTab = lazy(() => import('./tabs/GarantiasEquipoTab').then(m => ({ default: m.GarantiasEquipoTab })))
const EntregaUnidadTab = lazy(() => import('./tabs/EntregaUnidadTab').then(m => ({ default: m.EntregaUnidadTab })))
const AvisosCobroTab = lazy(() => import('./tabs/AvisosCobroTab').then(m => ({ default: m.AvisosCobroTab })))
const BitacoraMantoTab = lazy(() => import('./tabs/BitacoraManto').then(m => ({ default: m.BitacoraManto })))
const EvaluacionProveedorTab = lazy(() => import('./tabs/EvaluacionProveedorTab').then(m => ({ default: m.EvaluacionProveedorTab })))
const ReclamosTab = lazy(() => import('./tabs/ReclamosTab').then(m => ({ default: m.ReclamosTab })))
const FondoReservaTab = lazy(() => import('./tabs/FondoReservaTab').then(m => ({ default: m.FondoReservaTab })))
const PermisosObraTab = lazy(() => import('./tabs/PermisosObraTab').then(m => ({ default: m.PermisosObraTab })))
const TarifasTab = lazy(() => import('./tabs/TarifasTab').then(m => ({ default: m.TarifasTab })))
const IncidentesTab = lazy(() => import('./tabs/IncidentesTab').then(m => ({ default: m.IncidentesTab })))
const ChecklistAreasTab = lazy(() => import('./tabs/ChecklistAreasTab').then(m => ({ default: m.ChecklistAreasTab })))
const ProgramacionLimpiezaTab = lazy(() => import('./tabs/ProgramacionLimpiezaTab').then(m => ({ default: m.ProgramacionLimpiezaTab })))
const ConsumoEnergiaAreasTab = lazy(() => import('./tabs/ConsumoEnergiaAreasTab').then(m => ({ default: m.ConsumoEnergiaAreasTab })))
const HistorialResidentesTab = lazy(() => import('./tabs/HistorialResidentesTab').then(m => ({ default: m.HistorialResidentesTab })))
const EstacionamientoVisitaTab = lazy(() => import('./tabs/EstacionamientoVisitaTab'))
const BitacoraGuardiaTab = lazy(() => import('./tabs/BitacoraGuardiaTab'))
const EquiposComunesTab = lazy(() => import('./tabs/EquiposComunesTab'))
const PresenciaPersonalTab = lazy(() => import('./tabs/PresenciaPersonalTab'))
const SuministrosTab = lazy(() => import('./tabs/SuministrosTab'))
const TareasCondominioTab = lazy(() => import('./tabs/TareasCondominioTab'))
const GestionCobranzaTab = lazy(() => import('./tabs/GestionCobranzaTab'))
const SolicitudCertificadoTab = lazy(() => import('./tabs/SolicitudCertificadoTab'))
const VisitasFrecuentesTab = lazy(() => import('./tabs/VisitasFrecuentesTab'))
const ReglamentoTab = lazy(() => import('./tabs/ReglamentoTab'))
const ControlPlagasTab = lazy(() => import('./tabs/ControlPlagasTab'))
const CargosAdicionalesTab = lazy(() => import('./tabs/CargosAdicionalesTab'))
const ProgramaActividadesTab = lazy(() => import('./tabs/ProgramaActividadesTab'))
const RegistroAutoridadesTab = lazy(() => import('./tabs/RegistroAutoridadesTab'))
const NotasAdminTab = lazy(() => import('./tabs/NotasAdminTab'))
const ControlPiscinaTab = lazy(() => import('./tabs/ControlPiscinaTab'))
const MantenimientoJardineriaTab = lazy(() => import('./tabs/MantenimientoJardineriaTab'))
const IncidenciasElevadorTab = lazy(() => import('./tabs/IncidenciasElevadorTab'))
const MantenimientoCisternaTab = lazy(() => import('./tabs/MantenimientoCisternaTab'))
const ControlGeneradorTab = lazy(() => import('./tabs/ControlGeneradorTab'))
const ControlSistemaIncendioTab = lazy(() => import('./tabs/ControlSistemaIncendioTab'))
const ControlCamarasTab = lazy(() => import('./tabs/ControlCamarasTab'))
const LecturasMedidorGasTab = lazy(() => import('./tabs/LecturasMedidorGasTab'))
const RecordatoriosTab = lazy(() => import('./tabs/RecordatoriosTab'))
const PlantillasCuotaTab = lazy(() => import('./tabs/PlantillasCuotaTab'))
const BitacoraAccionesTab = lazy(() => import('./tabs/BitacoraAccionesTab'))
const RecargosTab = lazy(() => import('./tabs/RecargosTab'))
const ConveniosCuotaTab = lazy(() => import('./tabs/ConveniosCuotaTab'))
const HistorialSaldosTab = lazy(() => import('./tabs/HistorialSaldosTab'))
const NotificacionesEnviadasTab = lazy(() => import('./tabs/NotificacionesEnviadasTab'))
const ReglasMoraTab = lazy(() => import('./tabs/ReglasMoraTab'))
const CampanasCobroTab = lazy(() => import('./tabs/CampanasCobroTab'))
const CierreAnualTab = lazy(() => import('./tabs/CierreAnualTab'))
const KpisFinancierosTab = lazy(() => import('./tabs/KpisFinancierosTab'))
const CobranzaJudicialTab = lazy(() => import('./tabs/CobranzaJudicialTab'))
const RecibosDigitalesTab = lazy(() => import('./tabs/RecibosDigitalesTab'))
const InformeMensualTab = lazy(() => import('./tabs/InformeMensualTab'))
const BuzonSugerenciasTab = lazy(() => import('./tabs/BuzonSugerenciasTab'))
const VencimientosCriticosTab = lazy(() => import('./tabs/VencimientosCriticosTab'))
const CapacitacionPersonalTab = lazy(() => import('./tabs/CapacitacionPersonalTab'))
const ProyectosCondominioTab = lazy(() => import('./tabs/ProyectosCondominioTab'))
const MetricasServicioTab = lazy(() => import('./tabs/MetricasServicioTab'))
const AnalisisCarteraTab = lazy(() => import('./tabs/AnalisisCarteraTab'))
const IntegracionAguaTab = lazy(() => import('./tabs/IntegracionAguaTab'))
const CentroCostosTab = lazy(() => import('./tabs/CentroCostosTab'))
const ManualResidenteTab = lazy(() => import('./tabs/ManualResidenteTab'))
const ExportacionTab = lazy(() => import('./tabs/ExportacionTab'))
const MultiCondominioTab = lazy(() => import('./tabs/MultiCondominioTab'))
const AutomatizacionesTab = lazy(() => import('./tabs/AutomatizacionesTab'))
const ScoringUnidadesTab = lazy(() => import('./tabs/ScoringUnidadesTab'))
const PanelTurnoTab = lazy(() => import('./tabs/PanelTurnoTab'))
const PlantillasMensajeTab = lazy(() => import('./tabs/PlantillasMensajeTab'))
const FlujoAprobacionTab = lazy(() => import('./tabs/FlujoAprobacionTab'))
const CuadroMandoTab = lazy(() => import('./tabs/CuadroMandoTab'))
const GeneradorCuotasTab = lazy(() => import('./tabs/GeneradorCuotasTab'))
const MapaUnidadesTab = lazy(() => import('./tabs/MapaUnidadesTab'))
const EnvioMasivoTab = lazy(() => import('./tabs/EnvioMasivoTab'))
const ResumenEjecutivoTab = lazy(() => import('./tabs/ResumenEjecutivoTab'))
const OrdenesCompraTab = lazy(() => import('./tabs/OrdenesCompraTab'))
const GraficasTendenciasTab = lazy(() => import('./tabs/GraficasTendenciasTab'))
const ControlAccesosQRTab = lazy(() => import('./tabs/ControlAccesosQRTab'))
const CentroNotificacionesTab = lazy(() => import('./tabs/CentroNotificacionesTab'))
const AsambleaDigitalTab = lazy(() => import('./tabs/AsambleaDigitalTab'))
const ComparativoPresupuestoTab = lazy(() => import('./tabs/ComparativoPresupuestoTab'))
const ProformasTab = lazy(() => import('./tabs/ProformasTab'))
const BitacoraEventosTab = lazy(() => import('./tabs/BitacoraEventosTab'))
const IndiceCalidadTab = lazy(() => import('./tabs/IndiceCalidadTab'))
const KanbanTicketsTab = lazy(() => import('./tabs/KanbanTicketsTab'))
const ConciliacionCobrosTab = lazy(() => import('./tabs/ConciliacionCobrosTab'))
const EstadoCuentaResidenteTab = lazy(() => import('./tabs/EstadoCuentaResidenteTab'))
const PronosticoFinancieroTab = lazy(() => import('./tabs/PronosticoFinancieroTab'))
const SimuladorCuotasTab = lazy(() => import('./tabs/SimuladorCuotasTab'))
const CalendarioMantenimientoTab = lazy(() => import('./tabs/CalendarioMantenimientoTab'))
const ReporteDeudoresTab = lazy(() => import('./tabs/ReporteDeudoresTab'))
const ResumenResidenteTab = lazy(() => import('./tabs/ResumenResidenteTab'))
const GestorAlertasTab = lazy(() => import('./tabs/GestorAlertasTab'))
const UtilizacionAmenidadesTab = lazy(() => import('./tabs/UtilizacionAmenidadesTab'))
const ComparativoAnualTab = lazy(() => import('./tabs/ComparativoAnualTab'))
const GanttMantenimientoTab = lazy(() => import('./tabs/GanttMantenimientoTab'))
const MapaCalorCuotasTab = lazy(() => import('./tabs/MapaCalorCuotasTab'))
const EncuestaDashboardTab = lazy(() => import('./tabs/EncuestaDashboardTab'))
const AnalisisVisitantesTab = lazy(() => import('./tabs/AnalisisVisitantesTab'))
const InformeEjecutivoTab = lazy(() => import('./tabs/InformeEjecutivoTab'))
const TableroOcupacionTab = lazy(() => import('./tabs/TableroOcupacionTab'))
const GestionFondoReservaTab = lazy(() => import('./tabs/GestionFondoReservaTab'))
const DashboardSostenibilidadTab = lazy(() => import('./tabs/DashboardSostenibilidadTab'))
const ConfiguracionCondominioTab = lazy(() => import('./tabs/ConfiguracionCondominioTab'))
const BitacoraActividadTab = lazy(() => import('./tabs/BitacoraActividadTab'))
const PanelDirectivoTab = lazy(() => import('./tabs/PanelDirectivoTab'))
const GestionConflictosTab = lazy(() => import('./tabs/GestionConflictosTab'))
const DirectorioComunidadTab = lazy(() => import('./tabs/DirectorioComunidadTab'))

// ── Registry: orden = orden de aparición en la UI ───────────────────────────
// Cada `render(ctx)` reproduce exactamente el JSX que vivía en el switch.
// Tipo `TabDef` garantiza coherencia; agregar/quitar tab no toca el monolito.
export const TAB_REGISTRY: TabDef[] = [
  { id: 'panel', label: 'Panel', icon: '📊', render: (ctx) =>
    <PanelGeneralTab cuotas={ctx.cuotas} tickets={ctx.tickets} visitantes={ctx.visitantes} amenidades={ctx.amenidades} reservas={ctx.reservas} polizas={ctx.polizas} inspecciones={ctx.inspecciones} gastos={ctx.gastos} paquetes={ctx.paquetes} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'cuotas', label: 'Cuotas', icon: '💳', render: (ctx) =>
    <CuotasTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} proyectos={ctx.proyectosActivos} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'visitantes', label: 'Visitantes', icon: '🚪', render: (ctx) =>
    <VisitantesTab visitantes={ctx.visitantes} unidades={ctx.unidadesProyecto} reservasSTR={ctx.reservasSTR} solicitudesMudanza={ctx.solicitudesMudanza} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} proyectoNombre={ctx.proyectoActual?.nombre} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'amenidades', label: 'Amenidades', icon: '🏊', render: (ctx) =>
    <AmenidadesTab amenidades={ctx.amenidades} reservas={ctx.reservas} bloqueos={ctx.bloqueosAmenidades} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'mantenimiento', label: 'Mantenimiento', icon: '🔧', render: (ctx) =>
    <MantenimientoTab tickets={ctx.tickets} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} proyectoNombre={ctx.proyectoActual?.nombre} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'comunidad', label: 'Comunidad', icon: '📢', render: (ctx) =>
    <ComunidadTab anuncios={ctx.anuncios} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'parqueos', label: 'Parqueos', icon: '🅿️', render: (ctx) =>
    <ParqueosTab parqueos={ctx.parqueos} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'mascotas', label: 'Mascotas', icon: '🐾', render: (ctx) =>
    <MascotasTab mascotas={ctx.mascotas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'paqueteria', label: 'Paquetería', icon: '📦', render: (ctx) =>
    <PaqueteriaTab paquetes={ctx.paquetes} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'infracciones', label: 'Infracciones', icon: '⚖️', render: (ctx) =>
    <InfraccionesTab infracciones={ctx.infracciones} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'seguridad', label: 'Seguridad', icon: '🛡️', render: (ctx) =>
    <SeguridadTab rondas={ctx.rondas} novedades={ctx.novedades} rutas={ctx.rutas} puntosControl={ctx.puntosControl} visitasControl={ctx.visitasControl} visitantes={ctx.visitantes} unidades={ctx.unidadesProyecto} reservasSTR={ctx.reservasSTR} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'rutas_ronda', label: 'Rutas Ronda', icon: '🗺️', render: (ctx) =>
    <RutasRondaTab areas={ctx.areas} rutas={ctx.rutas} puntosControl={ctx.puntosControl} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'plantillas_cargo', label: 'Plantillas', icon: '📋', render: (ctx) =>
    <PlantillasCargoTab plantillas={ctx.plantillasCargo} areas={ctx.areas} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'tareas_personal', label: 'Turnos/Tareas', icon: '⚙️', render: (ctx) =>
    <TareasPersonalTab bloques={ctx.bloquesTurno} tareas={ctx.tareasBloque} plantillas={ctx.plantillasCargo} personal={ctx.personal} areas={ctx.areas} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'revision_tareas', label: 'Revisión Admin', icon: '🔍', render: (ctx) =>
    <RevisionTareasTab bloques={ctx.bloquesTurno} tareas={ctx.tareasBloque} revisiones={ctx.revisionesTarea} personal={ctx.personal} userId={ctx.uid} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'desempeno_personal', label: 'Desempeño', icon: '🏆', render: (ctx) =>
    <DesempenoPersonalTab bloques={ctx.bloquesTurno} tareas={ctx.tareasBloque} revisiones={ctx.revisionesTarea} rondas={ctx.rondas} visitasControl={ctx.visitasControl} personal={ctx.personal} /> },
  { id: 'reporte_consolidado', label: 'Rpt. Consolidado', icon: '📋', render: (ctx) =>
    <ReporteConsolidadoTab cuotas={ctx.cuotas} gastos={ctx.gastos} tickets={ctx.tickets} presupuestos={ctx.presupuestos} visitantes={ctx.visitantes} novedades={ctx.novedades} rondas={ctx.rondas} anuncios={ctx.anuncios} reservas={ctx.reservas} bloques={ctx.bloquesTurno} tareas={ctx.tareasBloque} unidades={ctx.unidadesProyecto} paquetes={ctx.paquetes} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'arrendamientos', label: 'Arrendamientos', icon: '📄', render: (ctx) =>
    <ArrendamientosTab contratos={ctx.contratos} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'asambleas', label: 'Asambleas', icon: '🗳️', render: (ctx) =>
    <AsambleasTab asambleas={ctx.asambleas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'proveedores', label: 'Proveedores', icon: '🤝', render: (ctx) =>
    <ProveedoresTab contratos={ctx.contratosProveedores} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'objetos', label: 'Obj. Perdidos', icon: '🔍', render: (ctx) =>
    <ObjetosTab objetos={ctx.objetos} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'agenda', label: 'Agenda', icon: '📅', render: (ctx) =>
    <AgendaTab agenda={ctx.agenda} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cumpleanos', label: 'Cumpleaños', icon: '🎂', render: (ctx) =>
    <CumpleanosTab personal={ctx.personal} clientesBirthday={ctx.clientesBirthday} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'inventario', label: 'Inventario', icon: '🗃️', render: (ctx) =>
    <InventarioTab inventario={ctx.inventario} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  // Etiqueta "Seguros": el id/tab gestiona pólizas de SEGURO; el nombre "Pólizas"
  // ahora pertenece a los asientos del módulo Contabilidad (partida doble).
  { id: 'polizas', label: 'Seguros', icon: '🛡️', render: (ctx) =>
    <PolizasTab polizas={ctx.polizas} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'inspecciones', label: 'Inspecciones', icon: '🏛️', render: (ctx) =>
    <InspeccionesTab inspecciones={ctx.inspecciones} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'personal', label: 'Personal', icon: '👥', render: (ctx) =>
    <PersonalTab personal={ctx.personal} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'emergencias', label: 'Emergencias', icon: '🆘', render: (ctx) =>
    <EmergenciasTab contactos={ctx.contactosEmergencia} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'documentos', label: 'Documentos', icon: '📁', render: (ctx) =>
    <DocumentosTab documentos={ctx.documentos} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'residuos', label: 'Residuos', icon: '♻️', render: (ctx) =>
    <ResiduosTab residuos={ctx.residuos} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'bodegas', label: 'Bodegas', icon: '🗄️', render: (ctx) =>
    <BodegasTab bodegas={ctx.bodegas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'onboarding', label: 'Onboarding', icon: '🎯', render: (ctx) =>
    <OnboardingTab onboardings={ctx.onboardings} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'propuestas', label: 'Propuestas', icon: '💡', render: (ctx) =>
    <PropuestasTab propuestas={ctx.propuestas} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'memoria', label: 'Memoria', icon: '📋', render: (ctx) =>
    <MemoriaTab memorias={ctx.memorias} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'str', label: 'STR', icon: '🏨', render: (ctx) =>
    <STRTab reservasSTR={ctx.reservasSTR} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'locales', label: 'Locales', icon: '🏪', render: (ctx) =>
    <LocalesTab locales={ctx.locales} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'sostenibilidad', label: 'Sostenibilidad', icon: '🌱', render: (ctx) =>
    <SostenibilidadTab residuos={ctx.residuos} proyectoId={ctx.proyectoId} companyId={ctx.cid} /> },
  { id: 'housekeeping', label: 'Housekeeping', icon: '🧹', render: (ctx) =>
    <HousekeepingTab servicios={ctx.serviciosHK} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'firmas', label: 'Firmas', icon: '✍️', render: (ctx) =>
    <FirmaDigitalTab firmas={ctx.firmas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'concierge', label: 'Concierge', icon: '🛎️', render: (ctx) =>
    <ConciergeTab solicitudes={ctx.solicitudesConcierge} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'llaves', label: 'Llaves', icon: '🔑', render: (ctx) =>
    <LlavesTab llaves={ctx.llaves} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'encuestas', label: 'Encuestas', icon: '📊', render: (ctx) =>
    <EncuestasTab encuestas={ctx.encuestas} respuestas={ctx.respuestasEncuesta} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  // Etiqueta "Gastos": el tab es CRUD de gastos_condominio; "Contabilidad" es
  // ahora la sección de partida doble a nivel plataforma.
  { id: 'contabilidad', label: 'Gastos', icon: '🧾', render: (ctx) =>
    <ContabilidadTab gastos={ctx.gastos} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'presupuesto', label: 'Presupuesto', icon: '📋', render: (ctx) =>
    <PresupuestoTab presupuestos={ctx.presupuestos} gastos={ctx.gastos} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'alertas', label: 'Alertas', icon: '🔔', render: (ctx) =>
    <AlertasTab alertas={ctx.alertasCondominio} polizas={ctx.polizas} contratos={ctx.contratosProveedores} inspecciones={ctx.inspecciones} llaves={ctx.llaves} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'centro_notificaciones', label: 'Centro notif.', icon: '📬', render: (ctx) =>
    <CentroNotificacionesTab cuotas={ctx.cuotas} tickets={ctx.tickets} reservas={ctx.reservas} polizas={ctx.polizas} sugerencias={ctx.sugerencias} vencimientosExtra={ctx.vencimientosExtra} inspecciones={ctx.inspecciones} contratos={ctx.contratos} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'reportes', label: 'Reportes', icon: '📑', render: (ctx) =>
    <ReportesTab cuotas={ctx.cuotas} tickets={ctx.tickets} visitantes={ctx.visitantes} contratos={ctx.contratosProveedores} gastos={ctx.gastos} presupuestos={ctx.presupuestos} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'estadocuenta', label: 'Estado Cuenta', icon: '🧾', render: (ctx) =>
    <EstadoCuentaTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} proyectoId={ctx.proyectoId} companyId={ctx.cid} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'calendario', label: 'Calendario', icon: '📅', render: (ctx) =>
    <CalendarioTab eventos={ctx.eventosCalendario} asambleas={ctx.asambleas} agenda={ctx.agenda} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'directorio', label: 'Directorio', icon: '📒', render: (ctx) =>
    <DirectorioTab personal={ctx.personal} contactosEmergencia={ctx.contactosEmergencia} proyectoId={ctx.proyectoId} companyId={ctx.cid} /> },
  { id: 'configuracion', label: 'Configuración', icon: '⚙️', render: (ctx) =>
    <ConfiguracionTab configuracion={ctx.configuracion} proyectoId={ctx.proyectoId} companyId={ctx.cid} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'solicitudes', label: 'Solicitudes', icon: '📥', render: (ctx) =>
    <SolicitudesTab solicitudes={ctx.solicitudes} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'solicitudes_renta', label: 'Autorizac. Renta', icon: '🔑', render: (ctx) =>
    <SolicitudesRentaTab solicitudes={ctx.solicitudesRenta} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} autorNombre={ctx.currentUser.name ?? ''} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'solicitudes_mudanza', label: 'Autorizac. Mudanza', icon: '🚛', render: (ctx) =>
    <SolicitudesMudanzaTab solicitudes={ctx.solicitudesMudanza} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'junta', label: 'Junta Directiva', icon: '👑', render: (ctx) =>
    <JuntaTab junta={ctx.junta} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'prestamos', label: 'Préstamo Equip.', icon: '🪑', render: (ctx) =>
    <PrestamoEquiposTab prestamos={ctx.prestamos} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'comunicados', label: 'Comunicados', icon: '✉️', render: (ctx) =>
    <ComunicadosTab comunicados={ctx.comunicados} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'comunicacion_condominios', label: 'Comunicación', icon: '💬', render: (ctx) =>
    <ComunicacionSection currentUser={ctx.currentUser} clientes={[]} proyectos={ctx.proyectosActivos} unidades={ctx.unidadesProyecto} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} serviceType="condominios" /> },
  { id: 'actas', label: 'Actas', icon: '📝', render: (ctx) =>
    <ActasTab actas={ctx.actas} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cierres', label: 'Cierres', icon: '🔒', render: (ctx) =>
    <CierresMensualesTab cierres={ctx.cierres} cuotas={ctx.cuotas} gastos={ctx.gastos} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'notificaciones', label: 'Notificaciones', icon: '🔔', render: (ctx) =>
    <NotificacionesTab reglas={ctx.reglas} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'medidores_unidad', label: 'Medidores', icon: '💧', render: (ctx) =>
    <MedidoresUnidadTab medidores={ctx.medidores} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'votaciones', label: 'Votaciones', icon: '🗳️', render: (ctx) =>
    <VotacionesTab votaciones={ctx.votaciones} unidades={ctx.unidadesProyecto} asambleas={ctx.asambleas} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'sanciones', label: 'Sanciones', icon: '⚖️', render: (ctx) =>
    <SancionesTab sanciones={ctx.sanciones} unidades={ctx.unidadesProyecto} infracciones={ctx.infracciones} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'mant_preventivo', label: 'Mant. Prev.', icon: '🔩', render: (ctx) =>
    <MantenimientoPrevTab planes={ctx.planesMantenimiento} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'portal', label: 'Portal Resid.', icon: '👤', render: (ctx) =>
    <PortalResidenteTab unidades={ctx.unidadesProyecto} cuotas={ctx.cuotas} tickets={ctx.tickets} amenidades={ctx.amenidades} reservas={ctx.reservas} bloqueosAmenidades={ctx.bloqueosAmenidades} visitantes={ctx.visitantes} anuncios={ctx.anuncios} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'correspondencia', label: 'Correspondencia', icon: '📬', render: (ctx) =>
    <CorrespondenciaCondTab correspondencia={ctx.correspondencia} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'libro_novedades', label: 'Libro Novedades', icon: '📖', render: (ctx) =>
    <LibroNovedadesTab novedades={ctx.libroNovedades} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'acuerdos', label: 'Acuerdos', icon: '✅', render: (ctx) =>
    <SeguimientoAcuerdosTab acuerdos={ctx.acuerdos} actas={ctx.actas} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'dashboard_ejecutivo', label: 'Dashboard Ejec.', icon: '📈', render: (ctx) =>
    <DashboardEjecutivoTab cuotas={ctx.cuotas} tickets={ctx.tickets} visitantes={ctx.visitantes} gastos={ctx.gastos} presupuestos={ctx.presupuestos} sanciones={ctx.sanciones} planesMantenimiento={ctx.planesMantenimiento} infracciones={ctx.infracciones} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'vehiculos', label: 'Vehículos', icon: '🚗', render: (ctx) =>
    <VehiculosTab vehiculos={ctx.vehiculos} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'eventos_comunidad', label: 'Eventos', icon: '🎉', render: (ctx) =>
    <EventosComunidadTab eventos={ctx.eventosComunidad} asistentes={ctx.asistentesEvento} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'caja_chica', label: 'Caja Chica', icon: '💵', render: (ctx) =>
    <CajaChicaTab cajas={ctx.cajasChicas} movimientos={ctx.movimientosCaja} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'obras', label: 'Obras', icon: '🏗️', render: (ctx) =>
    <ObrasTab obras={ctx.obras} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'plan_pago', label: 'Planes Pago', icon: '📆', render: (ctx) =>
    <PlanPagoCondTab planes={ctx.planesPage} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'accesos_res', label: 'Accesos', icon: '🔐', render: (ctx) =>
    <AccesosResTab accesos={ctx.accesosRes} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'garantias', label: 'Garantías', icon: '🛡️', render: (ctx) =>
    <GarantiasEquipoTab garantias={ctx.garantias} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'entrega_unidad', label: 'Entregas', icon: '🔑', render: (ctx) =>
    <EntregaUnidadTab entregas={ctx.entregas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'avisos_cobro', label: 'Avisos Cobro', icon: '📬', render: (ctx) =>
    <AvisosCobroTab avisos={ctx.avisosCobro} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'bitacora_manto', label: 'Bitácora Manto', icon: '🛠️', render: (ctx) =>
    <BitacoraMantoTab registros={ctx.bitacoraRegistros} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'eval_proveedor', label: 'Eval. Proveedor', icon: '⭐', render: (ctx) =>
    <EvaluacionProveedorTab evaluaciones={ctx.evaluacionesProv} proveedores={ctx.contratosProveedores} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'reclamos', label: 'Reclamos', icon: '📝', render: (ctx) =>
    <ReclamosTab reclamos={ctx.reclamos} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'fondo_reserva', label: 'Fondo Reserva', icon: '🏦', render: (ctx) =>
    <FondoReservaTab movimientos={ctx.fondoReserva} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'permisos_obra', label: 'Permisos Obra', icon: '🔨', render: (ctx) =>
    <PermisosObraTab permisos={ctx.permisosObra} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'tarifas', label: 'Tarifas', icon: '💰', render: (ctx) =>
    <TarifasTab tarifas={ctx.tarifas} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'incidentes', label: 'Incidentes', icon: '🚨', render: (ctx) =>
    <IncidentesTab incidentes={ctx.incidentes} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'checklist_areas', label: 'Checklist', icon: '🗒️', render: (ctx) =>
    <ChecklistAreasTab checklists={ctx.checklistAreas} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'prog_limpieza', label: 'Limpieza', icon: '🧹', render: (ctx) =>
    <ProgramacionLimpiezaTab programaciones={ctx.progLimpieza} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'consumo_energia', label: 'Consumo Energía', icon: '⚡', render: (ctx) =>
    <ConsumoEnergiaAreasTab consumos={ctx.consumoEnergia} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'historial_res', label: 'Historial Res.', icon: '👥', render: (ctx) =>
    <HistorialResidentesTab historial={ctx.historialRes} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'estac_visita', label: 'Estac. Visita', icon: '🅿️', render: (ctx) =>
    <EstacionamientoVisitaTab registros={ctx.estacVisita} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'bitacora_guardia', label: 'Bitácora Guardia', icon: '👮', render: (ctx) =>
    <BitacoraGuardiaTab registros={ctx.bitacoraGuardia} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'equipos', label: 'Equipos', icon: '⚙️', render: (ctx) =>
    <EquiposComunesTab equipos={ctx.equiposComunes} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'presencia', label: 'Presencia', icon: '📋', render: (ctx) =>
    <PresenciaPersonalTab registros={ctx.presenciaPersonal} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'suministros', label: 'Suministros', icon: '🗃️', render: (ctx) =>
    <SuministrosTab suministros={ctx.suministros} movimientos={ctx.movimientosSuministro} proveedores={ctx.contratosProveedores} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'tareas_cond', label: 'Tareas', icon: '✅', render: (ctx) =>
    <TareasCondominioTab tareas={ctx.tareasCond} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cobranza', label: 'Cobranza', icon: '💰', render: (ctx) =>
    <GestionCobranzaTab cobranzas={ctx.cobranzas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'certificados', label: 'Certificados', icon: '📜', render: (ctx) =>
    <SolicitudCertificadoTab solicitudes={ctx.certificados} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'vis_frecuentes', label: 'Vis. Frecuentes', icon: '👨‍👩‍👧', render: (ctx) =>
    <VisitasFrecuentesTab visitas={ctx.visitasFrecuentes} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'reglamento', label: 'Reglamento', icon: '📖', render: (ctx) =>
    <ReglamentoTab articulos={ctx.reglamento} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'control_plagas', label: 'Control Plagas', icon: '🧪', render: (ctx) =>
    <ControlPlagasTab registros={ctx.controlPlagas} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cargos_adicionales', label: 'Cargos Adic.', icon: '💸', render: (ctx) =>
    <CargosAdicionalesTab cargos={ctx.cargosAdicionales} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'programa_actividades', label: 'Actividades', icon: '🎽', render: (ctx) =>
    <ProgramaActividadesTab actividades={ctx.programaActividades} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'reg_autoridades', label: 'Autoridades', icon: '🏛️', render: (ctx) =>
    <RegistroAutoridadesTab registros={ctx.registroAutoridades} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'notas_admin', label: 'Notas Admin', icon: '🗒️', render: (ctx) =>
    <NotasAdminTab notas={ctx.notasAdmin} proyectoId={ctx.proyectoId} companyId={ctx.cid} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'control_piscina', label: 'Piscina', icon: '🏊', render: (ctx) =>
    <ControlPiscinaTab registros={ctx.controlPiscina} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'jardineria', label: 'Jardinería', icon: '🌿', render: (ctx) =>
    <MantenimientoJardineriaTab registros={ctx.mantenimientoJardineria} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'elevadores', label: 'Elevadores', icon: '🛗', render: (ctx) =>
    <IncidenciasElevadorTab registros={ctx.incidenciasElevador} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cisternas', label: 'Cisternas', icon: '🏗️', render: (ctx) =>
    <MantenimientoCisternaTab registros={ctx.mantenimientoCisterna} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'generador', label: 'Generador', icon: '⚡', render: (ctx) =>
    <ControlGeneradorTab registros={ctx.controlGenerador} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'incendio', label: 'Contra incendio', icon: '🧯', render: (ctx) =>
    <ControlSistemaIncendioTab registros={ctx.controlIncendio} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'camaras', label: 'Cámaras', icon: '📷', render: (ctx) =>
    <ControlCamarasTab camaras={ctx.camarasSeguridad} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'gas', label: 'Medidores gas', icon: '🔥', render: (ctx) =>
    <LecturasMedidorGasTab lecturas={ctx.lecturasGas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'recordatorios', label: 'Recordatorios', icon: '⏰', render: (ctx) =>
    <RecordatoriosTab recordatorios={ctx.recordatorios} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'plantillas_cuota', label: 'Plantillas cuota', icon: '📋', render: (ctx) =>
    <PlantillasCuotaTab plantillas={ctx.plantillasCuota} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'bitacora_acciones', label: 'Bitácora', icon: '🔎', render: (ctx) =>
    <BitacoraAccionesTab bitacora={ctx.bitacoraAcciones} /> },
  { id: 'recargos_mora', label: 'Recargos mora', icon: '📈', render: (ctx) =>
    <RecargosTab recargos={ctx.recargosMora} cuotas={ctx.cuotas} reglas={ctx.reglasMora} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'convenios_cuota', label: 'Convenios pago', icon: '🤝', render: (ctx) =>
    <ConveniosCuotaTab convenios={ctx.conveniosCuota} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'historial_saldos', label: 'Historial saldos', icon: '💹', render: (ctx) =>
    <HistorialSaldosTab historial={ctx.historialSaldos} cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'notificaciones_enviadas', label: 'Notif. enviadas', icon: '📨', render: (ctx) =>
    <NotificacionesEnviadasTab notificaciones={ctx.notificacionesEnviadas} unidades={ctx.unidadesProyecto} /> },
  { id: 'reglas_mora', label: 'Reglas mora', icon: '📏', render: (ctx) =>
    <ReglasMoraTab reglas={ctx.reglasMora} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'campanas_cobro', label: 'Campañas cobro', icon: '📣', render: (ctx) =>
    <CampanasCobroTab campanas={ctx.campanasCobro} cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cierre_anual', label: 'Cierre anual', icon: '📆', render: (ctx) =>
    <CierreAnualTab cierres={ctx.cierresAnuales} cuotas={ctx.cuotas} gastos={ctx.gastos} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'kpis_financieros', label: 'KPIs financieros', icon: '📉', render: (ctx) =>
    <KpisFinancierosTab cuotas={ctx.cuotas} gastos={ctx.gastos} historialSaldos={ctx.historialSaldos} recargosMora={ctx.recargosMora} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'cobranza_judicial', label: 'Cobr. judicial', icon: '⚖️', render: (ctx) =>
    <FeatureGate
      feature="cobranza_judicial"
      fallback={<UpgradeCTA feature="Cobranza Judicial" description="Gestiona procesos de cobranza judicial con seguimiento de etapas, abogados asignados y costos legales." requiredPlan="Solo Agua, Solo Condominios o Bundle" />}
    >
      <CobranzaJudicialTab cobranzas={ctx.cobranzaJudicial} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} />
    </FeatureGate>
  },
  { id: 'recibos_digitales', label: 'Recibos', icon: '🧾', render: (ctx) =>
    <RecibosDigitalesTab recibos={ctx.recibosDigitales} cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} proyectoNombre={ctx.proyectoActual?.nombre} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'informe_mensual', label: 'Informe mensual', icon: '📄', render: (ctx) =>
    <InformeMensualTab informes={ctx.informesMensuales} cuotas={ctx.cuotas} gastos={ctx.gastos} tickets={ctx.tickets} visitantes={ctx.visitantes} incidentes={ctx.incidentes} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'buzon_sugerencias', label: 'Sugerencias', icon: '💬', render: (ctx) =>
    <BuzonSugerenciasTab sugerencias={ctx.sugerencias} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'vencimientos_criticos', label: 'Vencimientos', icon: '⏳', render: (ctx) =>
    <VencimientosCriticosTab vencimientosExtra={ctx.vencimientosExtra} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} inspecciones={ctx.inspecciones} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'capacitacion_personal', label: 'Capacitación', icon: '🎓', render: (ctx) =>
    <CapacitacionPersonalTab capacitaciones={ctx.capacitaciones} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'proyectos_cond', label: 'Proyectos', icon: '🏗️', render: (ctx) =>
    <ProyectosCondominioTab proyectos={ctx.proyectosCond} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'metricas_servicio', label: 'Métricas servicio', icon: '📊', render: (ctx) =>
    <MetricasServicioTab tickets={ctx.tickets} sugerencias={ctx.sugerencias} visitantes={ctx.visitantes} cuotas={ctx.cuotas} moneda={ctx.moneda} /> },
  { id: 'analisis_cartera', label: 'Cartera', icon: '📉', render: (ctx) =>
    <FeatureGate
      feature="analisis_cartera"
      fallback={<UpgradeCTA feature="Análisis de Cartera" description="Analytics avanzados de mora por antigüedad, predicción de cobro y segmentación de unidades morosas." requiredPlan="Solo Agua o Bundle" />}
    >
      <AnalisisCarteraTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} />
    </FeatureGate>
  },
  { id: 'integracion_agua', label: 'Integración agua', icon: '💧', render: (ctx) =>
    <IntegracionAguaTab unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'centro_costos', label: 'Centro costos', icon: '💰', render: (ctx) =>
    <CentroCostosTab gastos={ctx.gastos} cuotas={ctx.cuotas} moneda={ctx.moneda} /> },
  { id: 'manual_residente', label: 'Manual residente', icon: '📚', render: (ctx) =>
    <ManualResidenteTab articulos={ctx.articulosManual} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'exportacion', label: 'Exportar', icon: '📥', render: (ctx) =>
    <FeatureGate
      feature="exportacion_avanzada"
      fallback={<UpgradeCTA feature="Exportación Avanzada" description="Exporta cuotas, gastos, tickets y visitantes en PDF/XLSX/CSV con plantillas personalizables." requiredPlan="cualquier plan activo" />}
    >
      <ExportacionTab cuotas={ctx.cuotas} gastos={ctx.gastos} tickets={ctx.tickets} visitantes={ctx.visitantes} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} />
    </FeatureGate>
  },
  { id: 'multi_condominio', label: 'Multi-condominio', icon: '🏘️', render: (ctx) =>
    <FeatureGate
      feature="multi_proyecto"
      fallback={<UpgradeCTA feature="Multi-Condominio" description="Administra múltiples proyectos desde un solo dashboard. Compara métricas, consolida reportes y gestiona usuarios entre condominios." requiredPlan="Bundle Completo" />}
    >
      <MultiCondominioTab proyectos={ctx.proyectosActivos} companyId={ctx.cid} moneda={ctx.moneda} />
    </FeatureGate>
  },
  { id: 'automatizaciones', label: 'Automatizaciones', icon: '⚙️', render: (ctx) =>
    <FeatureGate
      feature="automation"
      fallback={<UpgradeCTA feature="Automatizaciones" description="Workflows automáticos para generación de cuotas, notificaciones, recordatorios de mora y escalamientos por SLA." requiredPlan="Próximamente — contacta a ventas" />}
    >
      <AutomatizacionesTab automatizaciones={ctx.automatizaciones} cuotas={ctx.cuotas} tickets={ctx.tickets} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} />
    </FeatureGate>
  },
  { id: 'scoring_unidades', label: 'Scoring', icon: '🎯', render: (ctx) =>
    <ScoringUnidadesTab cuotas={ctx.cuotas} infracciones={ctx.infracciones} sanciones={ctx.sanciones} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'panel_turno', label: 'Panel turno', icon: '🟢', render: (ctx) =>
    <PanelTurnoTab visitantes={ctx.visitantes} tickets={ctx.tickets} tareasCond={ctx.tareasCond} reservas={ctx.reservas} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} inspecciones={ctx.inspecciones} vencimientosExtra={ctx.vencimientosExtra} cuotas={ctx.cuotas} /> },
  { id: 'plantillas_mensaje', label: 'Plantillas msg.', icon: '📨', render: (ctx) =>
    <PlantillasMensajeTab plantillas={ctx.plantillasMensaje} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'flujo_aprobacion', label: 'Aprobaciones', icon: '✅', render: (ctx) =>
    <FlujoAprobacionTab flujos={ctx.flujoAprobacion} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} autorNombre={ctx.currentUser.name ?? ''} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'cuadro_mando', label: 'Cuadro de mando', icon: '📈', render: (ctx) =>
    <CuadroMandoTab cuotas={ctx.cuotas} tickets={ctx.tickets} visitantes={ctx.visitantes} gastos={ctx.gastos} presupuestos={ctx.presupuestos} incidentes={ctx.incidentes} sugerencias={ctx.sugerencias} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} inspecciones={ctx.inspecciones} vencimientosExtra={ctx.vencimientosExtra} encuestas={ctx.encuestas} moneda={ctx.moneda} /> },
  { id: 'generacion_cuotas', label: 'Generar cuotas', icon: '🏭', render: (ctx) =>
    <GeneradorCuotasTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'mapa_unidades', label: 'Mapa unidades', icon: '🗺️', render: (ctx) =>
    <MapaUnidadesTab unidades={ctx.unidadesProyecto} cuotas={ctx.cuotas} contratos={ctx.contratos} moneda={ctx.moneda} /> },
  { id: 'envio_masivo', label: 'Envío masivo', icon: '📤', render: (ctx) =>
    <EnvioMasivoTab plantillas={ctx.plantillasMensaje} cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} reservas={ctx.reservas} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} onRefresh={ctx.onRefresh} /> },
  { id: 'resumen_ejecutivo', label: 'Resumen ejecutivo', icon: '📋', render: (ctx) =>
    <ResumenEjecutivoTab cuotas={ctx.cuotas} tickets={ctx.tickets} gastos={ctx.gastos} presupuestos={ctx.presupuestos} unidades={ctx.unidadesProyecto} incidentes={ctx.incidentes} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} inspecciones={ctx.inspecciones} vencimientosExtra={ctx.vencimientosExtra} sugerencias={ctx.sugerencias} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'ordenes_compra', label: 'Órdenes compra', icon: '🛒', render: (ctx) =>
    <OrdenesCompraTab ordenes={ctx.ordenesCompra} proveedores={ctx.contratosProveedores} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'graficas_tendencias', label: 'Tendencias', icon: '📊', render: (ctx) =>
    <GraficasTendenciasTab cuotas={ctx.cuotas} tickets={ctx.tickets} gastos={ctx.gastos} incidentes={ctx.incidentes} moneda={ctx.moneda} /> },
  { id: 'control_accesos_qr', label: 'Accesos QR', icon: '📱', render: (ctx) =>
    <ControlAccesosQRTab visitantes={ctx.visitantes} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'asamblea_digital', label: 'Asamblea digital', icon: '🖥️', render: (ctx) =>
    <AsambleaDigitalTab asambleas={ctx.asambleasDigital} unidades={ctx.unidadesProyecto} proyectoId={ctx.proyectoId} companyId={ctx.cid} userId={ctx.uid} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'comparativo_presupuesto', label: 'Ppto. vs Real', icon: '📋', render: (ctx) =>
    <ComparativoPresupuestoTab gastos={ctx.gastos} presupuestos={ctx.presupuestos} moneda={ctx.moneda} /> },
  { id: 'proformas', label: 'Proformas', icon: '📑', render: (ctx) =>
    <ProformasTab proformas={ctx.proformas} proveedores={ctx.contratosProveedores} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'bitacora_eventos', label: 'Bitácora eventos', icon: '📰', render: (ctx) =>
    <BitacoraEventosTab visitantes={ctx.visitantes} tickets={ctx.tickets} incidentes={ctx.incidentes} anuncios={ctx.anuncios} ordenesCompra={ctx.ordenesCompra} asambleas={ctx.asambleasDigital} gastos={ctx.gastos} cuotas={ctx.cuotas} moneda={ctx.moneda} /> },
  { id: 'indice_calidad', label: 'Índice calidad', icon: '🏆', render: (ctx) =>
    <IndiceCalidadTab cuotas={ctx.cuotas} tickets={ctx.tickets} incidentes={ctx.incidentes} encuestas={ctx.encuestas} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} planesMantenimiento={ctx.planesMantenimiento} sugerencias={ctx.sugerencias} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'kanban_tickets', label: 'Kanban tickets', icon: '🗂️', render: (ctx) =>
    <KanbanTicketsTab tickets={ctx.tickets} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'conciliacion_cobros', label: 'Conciliación', icon: '🔄', render: (ctx) =>
    <ConciliacionCobrosTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} conciliaciones={ctx.conciliaciones} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'estado_cuenta_residente', label: 'Edo. cuenta', icon: '📃', render: (ctx) =>
    <EstadoCuentaResidenteTab cuotas={ctx.cuotas} recargosMora={ctx.recargosMora} conveniosCuota={ctx.conveniosCuota} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'pronostico_financiero', label: 'Pronóstico', icon: '🔮', render: (ctx) =>
    <PronosticoFinancieroTab cuotas={ctx.cuotas} gastos={ctx.gastos} moneda={ctx.moneda} /> },
  { id: 'simulador_cuotas', label: 'Simulador', icon: '🧮', render: (ctx) =>
    <SimuladorCuotasTab cuotas={ctx.cuotas} gastos={ctx.gastos} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'calendario_mantenimiento', label: 'Calendario', icon: '📆', render: (ctx) =>
    <CalendarioMantenimientoTab tickets={ctx.tickets} reservas={ctx.reservas} planesMantenimiento={ctx.planesMantenimiento} inspecciones={ctx.inspecciones} vencimientosExtra={ctx.vencimientosExtra} /> },
  { id: 'reporte_deudores', label: 'Deudores', icon: '📋', render: (ctx) =>
    <ReporteDeudoresTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'resumen_residente', label: 'Vista residente', icon: '🏠', render: (ctx) =>
    <ResumenResidenteTab cuotas={ctx.cuotas} recargosMora={ctx.recargosMora} reservas={ctx.reservas} anuncios={ctx.anuncios} tickets={ctx.tickets} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'gestor_alertas', label: 'Alertas', icon: '🚨', render: (ctx) =>
    <GestorAlertasTab cuotas={ctx.cuotas} tickets={ctx.tickets} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} inspecciones={ctx.inspecciones} vencimientosExtra={ctx.vencimientosExtra} sugerencias={ctx.sugerencias} moneda={ctx.moneda} /> },
  { id: 'utilizacion_amenidades', label: 'Uso amenidades', icon: '📊', render: (ctx) =>
    <UtilizacionAmenidadesTab amenidades={ctx.amenidades} reservas={ctx.reservas} moneda={ctx.moneda} /> },
  { id: 'comparativo_anual', label: 'Comp. anual', icon: '📅', render: (ctx) =>
    <ComparativoAnualTab cuotas={ctx.cuotas} gastos={ctx.gastos} moneda={ctx.moneda} /> },
  { id: 'gantt_mantenimiento', label: 'Gantt tickets', icon: '📐', render: (ctx) =>
    <GanttMantenimientoTab tickets={ctx.tickets} moneda={ctx.moneda} /> },
  { id: 'mapa_calor_cuotas', label: 'Mapa de calor', icon: '🌡️', render: (ctx) =>
    <MapaCalorCuotasTab cuotas={ctx.cuotas} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'encuesta_dashboard', label: 'Encuestas', icon: '📝', render: (ctx) =>
    <EncuestaDashboardTab encuestas={ctx.encuestas} respuestas={ctx.respuestasEncuesta} /> },
  { id: 'analisis_visitantes', label: 'Visitantes', icon: '👥', render: (ctx) =>
    <AnalisisVisitantesTab visitantes={ctx.visitantes} unidades={ctx.unidadesProyecto} /> },
  { id: 'informe_ejecutivo', label: 'Informe ejecutivo', icon: '📰', render: (ctx) =>
    <InformeEjecutivoTab cuotas={ctx.cuotas} gastos={ctx.gastos} tickets={ctx.tickets} visitantes={ctx.visitantes} unidades={ctx.unidadesProyecto} polizas={ctx.polizas} contratosProveedores={ctx.contratosProveedores} inspecciones={ctx.inspecciones} sugerencias={ctx.sugerencias} moneda={ctx.moneda} proyectoNombre={ctx.proyectoActual?.nombre} /> },
  { id: 'tablero_ocupacion', label: 'Tablero ocupación', icon: '🏗️', render: (ctx) =>
    <TableroOcupacionTab unidades={ctx.unidadesProyecto} contratos={ctx.contratos} cuotas={ctx.cuotas} moneda={ctx.moneda} /> },
  { id: 'gestion_fondo', label: 'Fondo de reserva', icon: '🏦', render: (ctx) =>
    <GestionFondoReservaTab movimientos={ctx.fondoReservaMovs} proyectoId={ctx.proyectoId} companyId={ctx.cid} moneda={ctx.moneda} canCreate={ctx.canCreate('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'dashboard_sostenibilidad', label: 'Sostenibilidad', icon: '🌿', render: (ctx) =>
    <DashboardSostenibilidadTab gastos={ctx.gastos} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'configuracion_cond', label: 'Config. condominio', icon: '⚙️', render: (ctx) =>
    <ConfiguracionCondominioTab config={ctx.configCondominio} proyectoId={ctx.proyectoId} companyId={ctx.cid} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'bitacora_actividad', label: 'Bitácora actividad', icon: '📋', render: (ctx) =>
    <BitacoraActividadTab cuotas={ctx.cuotas} visitantes={ctx.visitantes} tickets={ctx.tickets} reservas={ctx.reservas} anuncios={ctx.anuncios} conciliaciones={ctx.conciliaciones} fondoReservaMovs={ctx.fondoReservaMovs} infracciones={ctx.infracciones} sugerencias={ctx.sugerencias} unidades={ctx.unidadesProyecto} moneda={ctx.moneda} /> },
  { id: 'panel_directivo', label: 'Panel directivo', icon: '🏛️', render: (ctx) =>
    <PanelDirectivoTab cuotas={ctx.cuotas} gastos={ctx.gastos} presupuestos={ctx.presupuestos} tickets={ctx.tickets} polizas={ctx.polizas} inspecciones={ctx.inspecciones} contratos={ctx.contratos} infracciones={ctx.infracciones} sugerencias={ctx.sugerencias} unidades={ctx.unidadesProyecto} recargosMora={ctx.recargosMora} fondoReservaMovs={ctx.fondoReservaMovs} moneda={ctx.moneda} /> },
  { id: 'gestion_conflictos', label: 'Conflictos', icon: '⚖️', render: (ctx) =>
    <GestionConflictosTab infracciones={ctx.infracciones} sugerencias={ctx.sugerencias} unidades={ctx.unidadesProyecto} canEdit={ctx.canEdit('condominios')} onRefresh={ctx.onRefresh} /> },
  { id: 'directorio_comunidad', label: 'Directorio', icon: '📒', render: (ctx) =>
    <DirectorioComunidadTab unidades={ctx.unidadesProyecto} contratos={ctx.contratos} mascotas={ctx.mascotas} vehiculos={ctx.vehiculos} /> },
]

// Lookup O(1) por id — el switch antiguo era O(n) lineal en cada render.
export const TAB_BY_ID: Record<CondominioTab, TabDef> = Object.fromEntries(
  TAB_REGISTRY.map(def => [def.id, def])
) as Record<CondominioTab, TabDef>

// ── URL <-> tab helpers (cond:A1 sub-rutas) ─────────────────────────────────
// `panel` vive en `/condominios` (sin segmento) porque `/condominios/panel`
// está reservado para `CondominiosDashboard` (selector de proyecto). El resto
// de los tabs viaja como `/condominios/<id>`.
export function tabToPath(tab: CondominioTab): string {
  if (tab === 'panel') return '/condominios'
  return `/condominios/${tab}`
}

// Convierte el param de URL en un tab válido. Tabs desconocidos caen en 'panel'.
export function pathParamToTab(tab: string | undefined): CondominioTab {
  if (!tab) return 'panel'
  return TAB_BY_ID[tab as CondominioTab] ? (tab as CondominioTab) : 'panel'
}
