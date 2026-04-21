import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  UserSession, Proyecto, Unidad,
  CuotaCondominio, Visitante, Amenidad, ReservaAmenidad, TicketMantenimiento, AnuncioComunidad,
  ParqueoCondominio, Mascota, PaqueteRecibido, InfraccionCondominio,
  RondaSeguridad, NovedadSeguridad, ContratoArrendamiento,
  Asamblea, ContratoProveedor, ObjetoPerdido, AgendaItem,
  ItemInventario, PolizaSeguro, InspeccionNormativa, PersonalCondominio,
  ContactoEmergencia, Mudanza, DocumentoCondominio, RegistroResiduo,
  BodegaCondominio, OnboardingResidente, PropuestaInversion, MemoriaLabores,
  ReservaSTR, LocalComercial, ServicioHousekeeping,
  FirmaDigital, SolicitudConcierge, LlaveCondominio, Encuesta, RespuestaEncuesta,
  GastoCondominio, PresupuestoCondominio, AlertaCondominio,
  EventoCalendario, ConfiguracionCondominio,
  SolicitudResidente, MiembroJunta, PrestamoEquipo, ComunicadoCondominio,
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
} from '../../types'
import { PanelGeneralTab } from './tabs/PanelGeneralTab'
import { CuotasTab } from './tabs/CuotasTab'
import { VisitantesTab } from './tabs/VisitantesTab'
import { AmenidadesTab } from './tabs/AmenidadesTab'
import { MantenimientoTab } from './tabs/MantenimientoTab'
import { ComunidadTab } from './tabs/ComunidadTab'
import { ParqueosTab } from './tabs/ParqueosTab'
import { MascotasTab } from './tabs/MascotasTab'
import { PaqueteriaTab } from './tabs/PaqueteriaTab'
import { InfraccionesTab } from './tabs/InfraccionesTab'
import { SeguridadTab } from './tabs/SeguridadTab'
import { ArrendamientosTab } from './tabs/ArrendamientosTab'
import { AsambleasTab } from './tabs/AsambleasTab'
import { ProveedoresTab } from './tabs/ProveedoresTab'
import { ObjetosTab } from './tabs/ObjetosTab'
import { AgendaTab } from './tabs/AgendaTab'
import { InventarioTab } from './tabs/InventarioTab'
import { PolizasTab } from './tabs/PolizasTab'
import { InspeccionesTab } from './tabs/InspeccionesTab'
import { PersonalTab } from './tabs/PersonalTab'
import { EmergenciasTab } from './tabs/EmergenciasTab'
import { MudanzasTab } from './tabs/MudanzasTab'
import { DocumentosTab } from './tabs/DocumentosTab'
import { ResiduosTab } from './tabs/ResiduosTab'
import { BodegasTab } from './tabs/BodegasTab'
import { OnboardingTab } from './tabs/OnboardingTab'
import { PropuestasTab } from './tabs/PropuestasTab'
import { MemoriaTab } from './tabs/MemoriaTab'
import { STRTab } from './tabs/STRTab'
import { LocalesTab } from './tabs/LocalesTab'
import { SostenibilidadTab } from './tabs/SostenibilidadTab'
import { HousekeepingTab } from './tabs/HousekeepingTab'
import { FirmaDigitalTab } from './tabs/FirmaDigitalTab'
import { ConciergeTab } from './tabs/ConciergeTab'
import { LlavesTab } from './tabs/LlavesTab'
import { EncuestasTab } from './tabs/EncuestasTab'
import { ContabilidadTab } from './tabs/ContabilidadTab'
import { PresupuestoTab } from './tabs/PresupuestoTab'
import { AlertasTab } from './tabs/AlertasTab'
import { ReportesTab } from './tabs/ReportesTab'
import { EstadoCuentaTab } from './tabs/EstadoCuentaTab'
import { CalendarioTab } from './tabs/CalendarioTab'
import { DirectorioTab } from './tabs/DirectorioTab'
import { ConfiguracionTab } from './tabs/ConfiguracionTab'
import { SolicitudesTab } from './tabs/SolicitudesTab'
import { JuntaTab } from './tabs/JuntaTab'
import { PrestamoEquiposTab } from './tabs/PrestamoEquiposTab'
import { ComunicadosTab } from './tabs/ComunicadosTab'
import { ActasTab } from './tabs/ActasTab'
import { CierresMensualesTab } from './tabs/CierresMensualesTab'
import { NotificacionesTab } from './tabs/NotificacionesTab'
import { MedidoresUnidadTab } from './tabs/MedidoresUnidadTab'
import { VotacionesTab } from './tabs/VotacionesTab'
import { SancionesTab } from './tabs/SancionesTab'
import { MantenimientoPrevTab } from './tabs/MantenimientoPrevTab'
import { PortalResidenteTab } from './tabs/PortalResidenteTab'
import { CorrespondenciaCondTab } from './tabs/CorrespondenciaCondTab'
import { LibroNovedadesTab } from './tabs/LibroNovedadesTab'
import { SeguimientoAcuerdosTab } from './tabs/SeguimientoAcuerdosTab'
import { DashboardEjecutivoTab } from './tabs/DashboardEjecutivoTab'
import { VehiculosTab } from './tabs/VehiculosTab'
import { EventosComunidadTab } from './tabs/EventosComunidadTab'
import { CajaChicaTab } from './tabs/CajaChicaTab'
import { ObrasTab } from './tabs/ObrasTab'
import { PlanPagoCondTab } from './tabs/PlanPagoCondTab'
import { AccesosResTab } from './tabs/AccesosResTab'
import { GarantiasEquipoTab } from './tabs/GarantiasEquipoTab'
import { EntregaUnidadTab } from './tabs/EntregaUnidadTab'
import { AvisosCobroTab } from './tabs/AvisosCobroTab'
import { BitacoraManto as BitacoraMantoTab } from './tabs/BitacoraManto'
import { EvaluacionProveedorTab } from './tabs/EvaluacionProveedorTab'
import { ReclamosTab } from './tabs/ReclamosTab'
import { FondoReservaTab } from './tabs/FondoReservaTab'
import { PermisosObraTab } from './tabs/PermisosObraTab'
import { TarifasTab } from './tabs/TarifasTab'
import { IncidentesTab } from './tabs/IncidentesTab'
import { ChecklistAreasTab } from './tabs/ChecklistAreasTab'
import { ProgramacionLimpiezaTab } from './tabs/ProgramacionLimpiezaTab'
import { ConsumoEnergiaAreasTab } from './tabs/ConsumoEnergiaAreasTab'
import { HistorialResidentesTab } from './tabs/HistorialResidentesTab'
import EstacionamientoVisitaTab from './tabs/EstacionamientoVisitaTab'
import BitacoraGuardiaTab from './tabs/BitacoraGuardiaTab'
import EquiposComunesTab from './tabs/EquiposComunesTab'
import PresenciaPersonalTab from './tabs/PresenciaPersonalTab'
import SuministrosTab from './tabs/SuministrosTab'
import TareasCondominioTab from './tabs/TareasCondominioTab'
import GestionCobranzaTab from './tabs/GestionCobranzaTab'
import SolicitudCertificadoTab from './tabs/SolicitudCertificadoTab'
import VisitasFrecuentesTab from './tabs/VisitasFrecuentesTab'
import ReglamentoTab from './tabs/ReglamentoTab'
import ControlPlagasTab from './tabs/ControlPlagasTab'
import CargosAdicionalesTab from './tabs/CargosAdicionalesTab'
import ProgramaActividadesTab from './tabs/ProgramaActividadesTab'
import RegistroAutoridadesTab from './tabs/RegistroAutoridadesTab'
import NotasAdminTab from './tabs/NotasAdminTab'
import ControlPiscinaTab from './tabs/ControlPiscinaTab'
import MantenimientoJardineriaTab from './tabs/MantenimientoJardineriaTab'
import IncidenciasElevadorTab from './tabs/IncidenciasElevadorTab'
import MantenimientoCisternaTab from './tabs/MantenimientoCisternaTab'

type CondominioTab =
  | 'panel' | 'cuotas' | 'visitantes' | 'amenidades' | 'mantenimiento' | 'comunidad'
  | 'parqueos' | 'mascotas' | 'paqueteria' | 'infracciones' | 'seguridad' | 'arrendamientos'
  | 'asambleas' | 'proveedores' | 'objetos' | 'agenda'
  | 'inventario' | 'polizas' | 'inspecciones' | 'personal'
  | 'emergencias' | 'mudanzas' | 'documentos' | 'residuos'
  | 'bodegas' | 'onboarding' | 'propuestas' | 'memoria'
  | 'str' | 'locales' | 'sostenibilidad' | 'housekeeping'
  | 'firmas' | 'concierge' | 'llaves' | 'encuestas'
  | 'contabilidad' | 'presupuesto' | 'alertas' | 'reportes'
  | 'estadocuenta' | 'calendario' | 'directorio' | 'configuracion'
  | 'solicitudes' | 'junta' | 'prestamos' | 'comunicados'
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

const TABS: { id: CondominioTab; label: string; icon: string }[] = [
  { id: 'panel',          label: 'Panel',          icon: '📊' },
  { id: 'cuotas',         label: 'Cuotas',         icon: '💳' },
  { id: 'visitantes',     label: 'Visitantes',     icon: '🚪' },
  { id: 'amenidades',     label: 'Amenidades',     icon: '🏊' },
  { id: 'mantenimiento',  label: 'Mantenimiento',  icon: '🔧' },
  { id: 'comunidad',      label: 'Comunidad',      icon: '📢' },
  { id: 'parqueos',       label: 'Parqueos',       icon: '🅿️' },
  { id: 'mascotas',       label: 'Mascotas',       icon: '🐾' },
  { id: 'paqueteria',     label: 'Paquetería',     icon: '📦' },
  { id: 'infracciones',   label: 'Infracciones',   icon: '⚖️' },
  { id: 'seguridad',      label: 'Seguridad',      icon: '🛡️' },
  { id: 'arrendamientos', label: 'Arrendamientos', icon: '📄' },
  { id: 'asambleas',      label: 'Asambleas',      icon: '🗳️' },
  { id: 'proveedores',    label: 'Proveedores',    icon: '🤝' },
  { id: 'objetos',        label: 'Obj. Perdidos',  icon: '🔍' },
  { id: 'agenda',         label: 'Agenda',         icon: '📅' },
  { id: 'inventario',    label: 'Inventario',     icon: '🗃️' },
  { id: 'polizas',       label: 'Pólizas',        icon: '🛡️' },
  { id: 'inspecciones',  label: 'Inspecciones',   icon: '🏛️' },
  { id: 'personal',      label: 'Personal',       icon: '👥' },
  { id: 'emergencias',   label: 'Emergencias',    icon: '🆘' },
  { id: 'mudanzas',      label: 'Mudanzas',       icon: '🚚' },
  { id: 'documentos',    label: 'Documentos',     icon: '📁' },
  { id: 'residuos',      label: 'Residuos',       icon: '♻️' },
  { id: 'bodegas',       label: 'Bodegas',        icon: '🗄️' },
  { id: 'onboarding',    label: 'Onboarding',     icon: '🎯' },
  { id: 'propuestas',    label: 'Propuestas',     icon: '💡' },
  { id: 'memoria',        label: 'Memoria',        icon: '📋' },
  { id: 'str',           label: 'STR',            icon: '🏨' },
  { id: 'locales',       label: 'Locales',        icon: '🏪' },
  { id: 'sostenibilidad',label: 'Sostenibilidad', icon: '🌱' },
  { id: 'housekeeping',  label: 'Housekeeping',   icon: '🧹' },
  { id: 'firmas',        label: 'Firmas',         icon: '✍️' },
  { id: 'concierge',     label: 'Concierge',      icon: '🛎️' },
  { id: 'llaves',        label: 'Llaves',         icon: '🔑' },
  { id: 'encuestas',     label: 'Encuestas',      icon: '📊' },
  { id: 'contabilidad',  label: 'Contabilidad',   icon: '🧾' },
  { id: 'presupuesto',   label: 'Presupuesto',    icon: '📋' },
  { id: 'alertas',       label: 'Alertas',        icon: '🔔' },
  { id: 'reportes',      label: 'Reportes',       icon: '📑' },
  { id: 'estadocuenta',  label: 'Estado Cuenta',  icon: '🧾' },
  { id: 'calendario',    label: 'Calendario',     icon: '📅' },
  { id: 'directorio',    label: 'Directorio',     icon: '📒' },
  { id: 'configuracion', label: 'Configuración',  icon: '⚙️' },
  { id: 'solicitudes',   label: 'Solicitudes',    icon: '📥' },
  { id: 'junta',         label: 'Junta Directiva',icon: '👑' },
  { id: 'prestamos',     label: 'Préstamo Equip.',icon: '🪑' },
  { id: 'comunicados',   label: 'Comunicados',    icon: '✉️' },
  { id: 'actas',         label: 'Actas',          icon: '📝' },
  { id: 'cierres',       label: 'Cierres',        icon: '🔒' },
  { id: 'notificaciones',label: 'Notificaciones', icon: '🔔' },
  { id: 'medidores_unidad', label: 'Medidores',    icon: '💧' },
  { id: 'votaciones',       label: 'Votaciones',   icon: '🗳️' },
  { id: 'sanciones',        label: 'Sanciones',    icon: '⚖️' },
  { id: 'mant_preventivo',  label: 'Mant. Prev.',  icon: '🔩' },
  { id: 'portal',             label: 'Portal Resid.',  icon: '👤' },
  { id: 'correspondencia',    label: 'Correspondencia',icon: '📬' },
  { id: 'libro_novedades',    label: 'Libro Novedades',icon: '📖' },
  { id: 'acuerdos',           label: 'Acuerdos',       icon: '✅' },
  { id: 'dashboard_ejecutivo',label: 'Dashboard Ejec.',icon: '📈' },
  { id: 'vehiculos',          label: 'Vehículos',      icon: '🚗' },
  { id: 'eventos_comunidad',  label: 'Eventos',        icon: '🎉' },
  { id: 'caja_chica',         label: 'Caja Chica',     icon: '💵' },
  { id: 'obras',              label: 'Obras',          icon: '🏗️' },
  { id: 'plan_pago',         label: 'Planes Pago',    icon: '📆' },
  { id: 'accesos_res',       label: 'Accesos',        icon: '🔐' },
  { id: 'garantias',         label: 'Garantías',      icon: '🛡️' },
  { id: 'entrega_unidad',    label: 'Entregas',       icon: '🔑' },
  { id: 'avisos_cobro',      label: 'Avisos Cobro',   icon: '📬' },
  { id: 'bitacora_manto',    label: 'Bitácora Manto', icon: '🛠️' },
  { id: 'eval_proveedor',    label: 'Eval. Proveedor',icon: '⭐' },
  { id: 'reclamos',          label: 'Reclamos',       icon: '📝' },
  { id: 'fondo_reserva',    label: 'Fondo Reserva',  icon: '🏦' },
  { id: 'permisos_obra',    label: 'Permisos Obra',  icon: '🔨' },
  { id: 'tarifas',          label: 'Tarifas',        icon: '💰' },
  { id: 'incidentes',       label: 'Incidentes',     icon: '🚨' },
  { id: 'checklist_areas',  label: 'Checklist',      icon: '🗒️' },
  { id: 'prog_limpieza',    label: 'Limpieza',       icon: '🧹' },
  { id: 'consumo_energia',  label: 'Consumo Energía',icon: '⚡' },
  { id: 'historial_res',    label: 'Historial Res.', icon: '👥' },
  { id: 'estac_visita',     label: 'Estac. Visita',   icon: '🅿️' },
  { id: 'bitacora_guardia', label: 'Bitácora Guardia', icon: '👮' },
  { id: 'equipos',          label: 'Equipos',          icon: '⚙️' },
  { id: 'presencia',        label: 'Presencia',        icon: '📋' },
  { id: 'suministros',      label: 'Suministros',      icon: '🗃️' },
  { id: 'tareas_cond',      label: 'Tareas',           icon: '✅' },
  { id: 'cobranza',         label: 'Cobranza',         icon: '💰' },
  { id: 'certificados',     label: 'Certificados',     icon: '📜' },
  { id: 'vis_frecuentes',   label: 'Vis. Frecuentes',  icon: '👨‍👩‍👧' },
  { id: 'reglamento',       label: 'Reglamento',       icon: '📖' },
  { id: 'control_plagas',        label: 'Control Plagas',  icon: '🧪' },
  { id: 'cargos_adicionales',   label: 'Cargos Adic.',    icon: '💸' },
  { id: 'programa_actividades', label: 'Actividades',     icon: '🎽' },
  { id: 'reg_autoridades',      label: 'Autoridades',     icon: '🏛️' },
  { id: 'notas_admin',          label: 'Notas Admin',     icon: '🗒️' },
  { id: 'control_piscina',     label: 'Piscina',         icon: '🏊' },
  { id: 'jardineria',          label: 'Jardinería',      icon: '🌿' },
  { id: 'elevadores',          label: 'Elevadores',      icon: '🛗' },
  { id: 'cisternas',           label: 'Cisternas',       icon: '🏗️' },
]

interface Props {
  proyectos: Proyecto[]
  unidades: Unidad[]
  currentUser: UserSession
  canCreate: (section: string) => boolean
  canEdit: (section: string) => boolean
}

export function CondominiosSection({ proyectos, unidades, currentUser, canCreate, canEdit }: Props) {
  const [activeTab, setActiveTab] = useState<CondominioTab>('panel')
  const [selectedProyectoId, setSelectedProyectoId] = useState<string>('')
  const [loading, setLoading] = useState(false)

  // Fase 1
  const [cuotas, setCuotas] = useState<CuotaCondominio[]>([])
  const [visitantes, setVisitantes] = useState<Visitante[]>([])
  const [amenidades, setAmenidades] = useState<Amenidad[]>([])
  const [reservas, setReservas] = useState<ReservaAmenidad[]>([])
  const [tickets, setTickets] = useState<TicketMantenimiento[]>([])
  const [anuncios, setAnuncios] = useState<AnuncioComunidad[]>([])
  // Fase 2
  const [parqueos, setParqueos] = useState<ParqueoCondominio[]>([])
  const [mascotas, setMascotas] = useState<Mascota[]>([])
  const [paquetes, setPaquetes] = useState<PaqueteRecibido[]>([])
  const [infracciones, setInfracciones] = useState<InfraccionCondominio[]>([])
  const [rondas, setRondas] = useState<RondaSeguridad[]>([])
  const [novedades, setNovedades] = useState<NovedadSeguridad[]>([])
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
  // Fase 5
  const [contactosEmergencia, setContactosEmergencia] = useState<ContactoEmergencia[]>([])
  const [mudanzas, setMudanzas] = useState<Mudanza[]>([])
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

  const proyectosActivos = proyectos.filter(p => p.estado === 'activo')

  useEffect(() => {
    if (proyectosActivos.length > 0 && !selectedProyectoId) {
      setSelectedProyectoId(proyectosActivos[0].id)
    }
  }, [proyectosActivos.length])

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
      contactosEmergRes, mudanzasRes, documentosRes, residuosRes,
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
    ] = await Promise.all([
      supabase.from('cuotas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('visitantes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(200),
      supabase.from('amenidades').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('reservas_amenidades').select('*, amenidades(nombre), unidades(nombre)').eq('company_id', cid).order('fecha', { ascending: false }).limit(200),
      supabase.from('tickets_mantenimiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('anuncios_comunidad').select('*, app_users(nombre_completo)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('parqueos_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
      supabase.from('mascotas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('paquetes_recibidos').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('hora_recepcion', { ascending: false }).limit(200),
      supabase.from('infracciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('rondas_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('inicio', { ascending: false }).limit(100),
      supabase.from('novedades_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }).limit(200),
      supabase.from('contratos_arrendamiento').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('asambleas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('contratos_proveedores').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('objetos_perdidos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_encontrado', { ascending: false }),
      supabase.from('agenda_operativa').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha').order('hora_inicio'),
      supabase.from('inventario_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
      supabase.from('polizas_seguro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
      supabase.from('inspecciones_normativas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('personal_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('cargo').order('nombre'),
      supabase.from('contactos_emergencia').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('nombre'),
      supabase.from('mudanzas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('documentos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('titulo'),
      supabase.from('registros_residuos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('bodegas_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('numero'),
      supabase.from('onboarding_residentes').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_ingreso', { ascending: false }),
      supabase.from('propuestas_inversion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('memoria_labores').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
      supabase.from('reservas_str').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_entrada', { ascending: false }),
      supabase.from('locales_comerciales').select('*').eq('project_id', pid).eq('company_id', cid).order('numero_local'),
      supabase.from('servicios_housekeeping').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('firmas_digitales').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('solicitudes_concierge').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
      supabase.from('llaves_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('encuestas').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('respuestas_encuesta').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('gastos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('presupuesto_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('anio', { ascending: false }),
      supabase.from('alertas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_alerta'),
      supabase.from('eventos_calendario').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio'),
      supabase.from('configuracion_condominio').select('*').eq('project_id', pid).eq('company_id', cid),
      supabase.from('solicitudes_residente').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('junta_directiva').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('prestamos_equipo').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_prestamo', { ascending: false }),
      supabase.from('comunicados_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_envio', { ascending: false }),
      supabase.from('actas_reunion').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('cierres_mensuales').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
      supabase.from('reglas_notificacion').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('medidores_unidad').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('votaciones').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
      supabase.from('sanciones_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }),
      supabase.from('planes_mantenimiento').select('*').eq('project_id', pid).eq('company_id', cid).order('proxima_ejecucion'),
      supabase.from('correspondencia_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('libro_novedades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('turno'),
      supabase.from('seguimiento_acuerdos').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite'),
      supabase.from('vehiculos_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('placa'),
      supabase.from('eventos_comunidad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('registro_asistentes_evento').select('*').eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('caja_chica').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_apertura', { ascending: false }),
      supabase.from('movimientos_caja').select('*').eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('obras_mejoras').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('planes_pago_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('cuotas_plan_pago').select('*').eq('company_id', cid).order('numero'),
      supabase.from('accesos_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('titular'),
      supabase.from('garantias_equipo').select('*').eq('project_id', pid).eq('company_id', cid).order('equipo'),
      supabase.from('entrega_unidades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('avisos_cobro').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }),
      supabase.from('bitacora_manto').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('evaluaciones_proveedor').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('reclamos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('fondo_reserva_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('permisos_obra_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('tarifas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('concepto'),
      supabase.from('incidentes_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('checklist_areas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('programacion_limpieza').select('*').eq('project_id', pid).eq('company_id', cid).order('area'),
      supabase.from('consumo_energia_areas').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }).order('area'),
      supabase.from('historial_residentes').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_desde', { ascending: false }),
      supabase.from('estacionamiento_visita').select('*').eq('project_id', pid).eq('company_id', cid).order('hora_entrada', { ascending: false }).limit(500),
      supabase.from('bitacora_guardia').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('turno'),
      supabase.from('equipos_comunes').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
      supabase.from('presencia_personal').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('nombre'),
      supabase.from('suministros_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('categoria').order('nombre'),
      supabase.from('movimientos_suministro').select('*').eq('company_id', cid).order('fecha', { ascending: false }).limit(500),
      supabase.from('tareas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite').order('created_at', { ascending: false }),
      supabase.from('gestion_cobranza').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('solicitudes_certificado').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
      supabase.from('visitas_frecuentes').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('reglamento_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('capitulo').order('numero_articulo'),
      supabase.from('control_plagas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('cargos_adicionales_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_cargo', { ascending: false }),
      supabase.from('programa_actividades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
      supabase.from('registro_autoridades').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('notas_admin').select('*').eq('project_id', pid).eq('company_id', cid).order('fijada', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('control_piscina').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }).order('hora', { ascending: false }).limit(500),
      supabase.from('mantenimiento_jardineria').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('incidencias_elevador').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('mantenimiento_cisterna').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
    ])

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
      publicado_por_nombre: (r.app_users as { nombre_completo: string } | null)?.nombre_completo,
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
    setContactosEmergencia((contactosEmergRes.data ?? []) as ContactoEmergencia[])
    setMudanzas((mudanzasRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
    } as Mudanza)))
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

    setLoading(false)
  }, [selectedProyectoId, currentUser.company_id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  const unidadesProyecto = unidades.filter(u => u.project_id === selectedProyectoId)
  const proyectoActual = proyectos.find(p => p.id === selectedProyectoId)
  const moneda = proyectoActual?.moneda ?? 'Q'
  const cid = currentUser.company_id ?? ''
  const uid = currentUser.user_id

  if (proyectosActivos.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
        <p style={{ fontSize: '16px', fontWeight: 600, color: '#64748b' }}>No hay proyectos activos</p>
        <p style={{ fontSize: '13px' }}>Crea un proyecto en "Mis Proyectos" para comenzar a usar el módulo Condominios.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Header */}
      <div style={{ padding: '16px 24px 0', borderBottom: '1px solid #e2e8f0', background: 'white', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🏢</span>
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Condominios</h1>
          </div>
          {proyectosActivos.length > 1 && (
            <select value={selectedProyectoId} onChange={e => setSelectedProyectoId(e.target.value)}
              style={{ padding: '6px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc', color: '#374151', fontWeight: 500 }}>
              {proyectosActivos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          )}
          {proyectosActivos.length === 1 && (
            <span style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>{proyectoActual?.nombre}</span>
          )}
          {loading && <span style={{ fontSize: '12px', color: '#94a3b8' }}>Cargando...</span>}
        </div>

        {/* Sub-tabs scrollable */}
        <div style={{ display: 'flex', gap: '2px', overflowX: 'auto', paddingBottom: '1px' }}>
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 14px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: activeTab === tab.id ? 700 : 500,
                background: activeTab === tab.id ? '#f8fafc' : 'transparent',
                color: activeTab === tab.id ? '#0ea5e9' : '#64748b',
                borderBottom: activeTab === tab.id ? '2px solid #0ea5e9' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'panel' && <PanelGeneralTab cuotas={cuotas} tickets={tickets} visitantes={visitantes} amenidades={amenidades} moneda={moneda} />}

        {activeTab === 'cuotas' && <CuotasTab cuotas={cuotas} unidades={unidadesProyecto} proyectos={proyectosActivos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'visitantes' && <VisitantesTab visitantes={visitantes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'amenidades' && <AmenidadesTab amenidades={amenidades} reservas={reservas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mantenimiento' && <MantenimientoTab tickets={tickets} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'comunidad' && <ComunidadTab anuncios={anuncios} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'parqueos' && <ParqueosTab parqueos={parqueos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mascotas' && <MascotasTab mascotas={mascotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'paqueteria' && <PaqueteriaTab paquetes={paquetes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'infracciones' && <InfraccionesTab infracciones={infracciones} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'seguridad' && <SeguridadTab rondas={rondas} novedades={novedades} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'arrendamientos' && <ArrendamientosTab contratos={contratos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'asambleas' && <AsambleasTab asambleas={asambleas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'proveedores' && <ProveedoresTab contratos={contratosProveedores} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'objetos' && <ObjetosTab objetos={objetos} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'agenda' && <AgendaTab agenda={agenda} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'inventario' && <InventarioTab inventario={inventario} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'polizas' && <PolizasTab polizas={polizas} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'inspecciones' && <InspeccionesTab inspecciones={inspecciones} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'personal' && <PersonalTab personal={personal} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'emergencias' && <EmergenciasTab contactos={contactosEmergencia} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mudanzas' && <MudanzasTab mudanzas={mudanzas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'documentos' && <DocumentosTab documentos={documentos} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'residuos' && <ResiduosTab residuos={residuos} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'bodegas' && <BodegasTab bodegas={bodegas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'onboarding' && <OnboardingTab onboardings={onboardings} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'propuestas' && <PropuestasTab propuestas={propuestas} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'memoria' && <MemoriaTab memorias={memorias} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'str' && <STRTab reservasSTR={reservasSTR} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'locales' && <LocalesTab locales={locales} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'sostenibilidad' && <SostenibilidadTab residuos={residuos} proyectoId={selectedProyectoId} companyId={cid} />}

        {activeTab === 'housekeeping' && <HousekeepingTab servicios={serviciosHK} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'firmas' && <FirmaDigitalTab firmas={firmas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'concierge' && <ConciergeTab solicitudes={solicitudesConcierge} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'llaves' && <LlavesTab llaves={llaves} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'encuestas' && <EncuestasTab encuestas={encuestas} respuestas={respuestasEncuesta} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'contabilidad' && <ContabilidadTab gastos={gastos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'presupuesto' && <PresupuestoTab presupuestos={presupuestos} gastos={gastos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'alertas' && <AlertasTab alertas={alertasCondominio} polizas={polizas} contratos={contratosProveedores} inspecciones={inspecciones} llaves={llaves} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'reportes' && <ReportesTab cuotas={cuotas} tickets={tickets} visitantes={visitantes} contratos={contratosProveedores} gastos={gastos} presupuestos={presupuestos} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'estadocuenta' && <EstadoCuentaTab cuotas={cuotas} unidades={unidadesProyecto} moneda={moneda} proyectoId={selectedProyectoId} companyId={cid} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'calendario' && <CalendarioTab eventos={eventosCalendario} asambleas={asambleas} agenda={agenda} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'directorio' && <DirectorioTab personal={personal} contactosEmergencia={contactosEmergencia} proyectoId={selectedProyectoId} companyId={cid} />}
        {activeTab === 'configuracion' && <ConfiguracionTab configuracion={configuracion} proyectoId={selectedProyectoId} companyId={cid} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'solicitudes' && <SolicitudesTab solicitudes={solicitudes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'junta' && <JuntaTab junta={junta} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'prestamos' && <PrestamoEquiposTab prestamos={prestamos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'comunicados' && <ComunicadosTab comunicados={comunicados} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'actas' && <ActasTab actas={actas} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'cierres' && <CierresMensualesTab cierres={cierres} cuotas={cuotas} gastos={gastos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'notificaciones' && <NotificacionesTab reglas={reglas} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'medidores_unidad' && <MedidoresUnidadTab medidores={medidores} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'votaciones' && <VotacionesTab votaciones={votaciones} unidades={unidadesProyecto} asambleas={asambleas} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'sanciones' && <SancionesTab sanciones={sanciones} unidades={unidadesProyecto} infracciones={infracciones} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'mant_preventivo' && <MantenimientoPrevTab planes={planesMantenimiento} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'portal' && <PortalResidenteTab cuotas={cuotas} tickets={tickets} reservas={reservas} comunicados={comunicados} sanciones={sanciones} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'correspondencia' && <CorrespondenciaCondTab correspondencia={correspondencia} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'libro_novedades' && <LibroNovedadesTab novedades={libroNovedades} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'acuerdos' && <SeguimientoAcuerdosTab acuerdos={acuerdos} actas={actas} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'dashboard_ejecutivo' && <DashboardEjecutivoTab cuotas={cuotas} tickets={tickets} visitantes={visitantes} gastos={gastos} presupuestos={presupuestos} sanciones={sanciones} planesMantenimiento={planesMantenimiento} infracciones={infracciones} unidades={unidadesProyecto} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'vehiculos' && <VehiculosTab vehiculos={vehiculos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'eventos_comunidad' && <EventosComunidadTab eventos={eventosComunidad} asistentes={asistentesEvento} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'caja_chica' && <CajaChicaTab cajas={cajasChicas} movimientos={movimientosCaja} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'obras' && <ObrasTab obras={obras} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'plan_pago' && <PlanPagoCondTab planes={planesPage} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'accesos_res' && <AccesosResTab accesos={accesosRes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'garantias' && <GarantiasEquipoTab garantias={garantias} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'entrega_unidad' && <EntregaUnidadTab entregas={entregas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'avisos_cobro' && <AvisosCobroTab avisos={avisosCobro} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'bitacora_manto' && <BitacoraMantoTab registros={bitacoraRegistros} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'eval_proveedor' && <EvaluacionProveedorTab evaluaciones={evaluacionesProv} proveedores={contratosProveedores} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'reclamos' && <ReclamosTab reclamos={reclamos} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'fondo_reserva' && <FondoReservaTab movimientos={fondoReserva} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'permisos_obra' && <PermisosObraTab permisos={permisosObra} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'tarifas' && <TarifasTab tarifas={tarifas} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'incidentes' && <IncidentesTab incidentes={incidentes} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'checklist_areas' && <ChecklistAreasTab checklists={checklistAreas} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'prog_limpieza' && <ProgramacionLimpiezaTab programaciones={progLimpieza} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'consumo_energia' && <ConsumoEnergiaAreasTab consumos={consumoEnergia} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'historial_res' && <HistorialResidentesTab historial={historialRes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'estac_visita' && <EstacionamientoVisitaTab registros={estacVisita} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'bitacora_guardia' && <BitacoraGuardiaTab registros={bitacoraGuardia} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'equipos' && <EquiposComunesTab equipos={equiposComunes} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'presencia' && <PresenciaPersonalTab registros={presenciaPersonal} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'suministros' && <SuministrosTab suministros={suministros} movimientos={movimientosSuministro} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'tareas_cond' && <TareasCondominioTab tareas={tareasCond} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'cobranza' && <GestionCobranzaTab cobranzas={cobranzas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'certificados' && <SolicitudCertificadoTab solicitudes={certificados} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'vis_frecuentes' && <VisitasFrecuentesTab visitas={visitasFrecuentes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'reglamento' && <ReglamentoTab articulos={reglamento} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'control_plagas' && <ControlPlagasTab registros={controlPlagas} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'cargos_adicionales' && <CargosAdicionalesTab cargos={cargosAdicionales} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'programa_actividades' && <ProgramaActividadesTab actividades={programaActividades} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'reg_autoridades' && <RegistroAutoridadesTab registros={registroAutoridades} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'notas_admin' && <NotasAdminTab notas={notasAdmin} proyectoId={selectedProyectoId} companyId={cid} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'control_piscina' && <ControlPiscinaTab registros={controlPiscina} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'jardineria' && <MantenimientoJardineriaTab registros={mantenimientoJardineria} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'elevadores' && <IncidenciasElevadorTab registros={incidenciasElevador} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'cisternas' && <MantenimientoCisternaTab registros={mantenimientoCisterna} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
      </div>
    </div>
  )
}
