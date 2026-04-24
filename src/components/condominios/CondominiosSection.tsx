import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  UserSession, Proyecto, Unidad,
  OrdenCompra, AsambleaDigital, Proforma,
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
import ControlGeneradorTab from './tabs/ControlGeneradorTab'
import ControlSistemaIncendioTab from './tabs/ControlSistemaIncendioTab'
import ControlCamarasTab from './tabs/ControlCamarasTab'
import LecturasMedidorGasTab from './tabs/LecturasMedidorGasTab'
import ComentariosTicketTab from './tabs/ComentariosTicketTab'
import RecordatoriosTab from './tabs/RecordatoriosTab'
import PlantillasCuotaTab from './tabs/PlantillasCuotaTab'
import BitacoraAccionesTab from './tabs/BitacoraAccionesTab'
import RecargosTab from './tabs/RecargosTab'
import ConveniosCuotaTab from './tabs/ConveniosCuotaTab'
import HistorialSaldosTab from './tabs/HistorialSaldosTab'
import NotificacionesEnviadasTab from './tabs/NotificacionesEnviadasTab'
import ReglasMoraTab from './tabs/ReglasMoraTab'
import CampanasCobroTab from './tabs/CampanasCobroTab'
import CierreAnualTab from './tabs/CierreAnualTab'
import KpisFinancierosTab from './tabs/KpisFinancierosTab'
import CobranzaJudicialTab from './tabs/CobranzaJudicialTab'
import RecibosDigitalesTab from './tabs/RecibosDigitalesTab'
import InformeMensualTab from './tabs/InformeMensualTab'
import BuzonSugerenciasTab from './tabs/BuzonSugerenciasTab'
import VencimientosCriticosTab from './tabs/VencimientosCriticosTab'
import CapacitacionPersonalTab from './tabs/CapacitacionPersonalTab'
import ProyectosCondominioTab from './tabs/ProyectosCondominioTab'
import MetricasServicioTab from './tabs/MetricasServicioTab'
import AnalisisCarteraTab from './tabs/AnalisisCarteraTab'
import IntegracionAguaTab from './tabs/IntegracionAguaTab'
import CentroCostosTab from './tabs/CentroCostosTab'
import ManualResidenteTab from './tabs/ManualResidenteTab'
import ExportacionTab from './tabs/ExportacionTab'
import MultiCondominioTab from './tabs/MultiCondominioTab'
import AutomatizacionesTab from './tabs/AutomatizacionesTab'
import ScoringUnidadesTab from './tabs/ScoringUnidadesTab'
import PanelTurnoTab from './tabs/PanelTurnoTab'
import PlantillasMensajeTab from './tabs/PlantillasMensajeTab'
import FlujoAprobacionTab from './tabs/FlujoAprobacionTab'
import CuadroMandoTab from './tabs/CuadroMandoTab'
import GeneracionCuotasTab from './tabs/GeneracionCuotasTab'
import MapaUnidadesTab from './tabs/MapaUnidadesTab'
import EnvioMasivoTab from './tabs/EnvioMasivoTab'
import ResumenEjecutivoTab from './tabs/ResumenEjecutivoTab'
import OrdenesCompraTab from './tabs/OrdenesCompraTab'
import GraficasTendenciasTab from './tabs/GraficasTendenciasTab'
import ControlAccesosQRTab from './tabs/ControlAccesosQRTab'
import CentroNotificacionesTab from './tabs/CentroNotificacionesTab'
import AsambleaDigitalTab from './tabs/AsambleaDigitalTab'
import ComparativoPresupuestoTab from './tabs/ComparativoPresupuestoTab'
import ProformasTab from './tabs/ProformasTab'
import BitacoraEventosTab from './tabs/BitacoraEventosTab'
import IndiceCalidadTab from './tabs/IndiceCalidadTab'
import KanbanTicketsTab from './tabs/KanbanTicketsTab'
import ConciliacionCobrosTab from './tabs/ConciliacionCobrosTab'
import EstadoCuentaResidenteTab from './tabs/EstadoCuentaResidenteTab'
import PronosticoFinancieroTab from './tabs/PronosticoFinancieroTab'
import SimuladorCuotasTab from './tabs/SimuladorCuotasTab'
import CalendarioMantenimientoTab from './tabs/CalendarioMantenimientoTab'
import ReporteDeudoresTab from './tabs/ReporteDeudoresTab'
import ResumenResidenteTab from './tabs/ResumenResidenteTab'
import GestorAlertasTab from './tabs/GestorAlertasTab'
import UtilizacionAmenidadesTab from './tabs/UtilizacionAmenidadesTab'
import ComparativoAnualTab from './tabs/ComparativoAnualTab'
import GanttMantenimientoTab from './tabs/GanttMantenimientoTab'
import MapaCalorCuotasTab from './tabs/MapaCalorCuotasTab'
import EncuestaDashboardTab from './tabs/EncuestaDashboardTab'
import AnalisisVisitantesTab from './tabs/AnalisisVisitantesTab'
import InformeEjecutivoTab from './tabs/InformeEjecutivoTab'
import TableroOcupacionTab from './tabs/TableroOcupacionTab'
import GestionFondoReservaTab from './tabs/GestionFondoReservaTab'
import DashboardSostenibilidadTab from './tabs/DashboardSostenibilidadTab'
import ConfiguracionCondominioTab from './tabs/ConfiguracionCondominioTab'
import BitacoraActividadTab from './tabs/BitacoraActividadTab'
import PanelDirectivoTab from './tabs/PanelDirectivoTab'
import GestionConflictosTab from './tabs/GestionConflictosTab'
import DirectorioComunidadTab from './tabs/DirectorioComunidadTab'

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
  | 'centro_notificaciones'

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
  { id: 'centro_notificaciones', label: 'Centro notif.', icon: '📬' },
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
  { id: 'generador',           label: 'Generador',       icon: '⚡' },
  { id: 'incendio',            label: 'Contra incendio', icon: '🧯' },
  { id: 'camaras',             label: 'Cámaras',         icon: '📷' },
  { id: 'gas',                 label: 'Medidores gas',   icon: '🔥' },
  { id: 'recordatorios',          label: 'Recordatorios',   icon: '⏰' },
  { id: 'plantillas_cuota',       label: 'Plantillas cuota', icon: '📋' },
  { id: 'bitacora_acciones',      label: 'Bitácora',        icon: '🔎' },
  { id: 'recargos_mora',          label: 'Recargos mora',   icon: '📈' },
  { id: 'convenios_cuota',        label: 'Convenios pago',  icon: '🤝' },
  { id: 'historial_saldos',       label: 'Historial saldos', icon: '💹' },
  { id: 'notificaciones_enviadas',label: 'Notif. enviadas',  icon: '📨' },
  { id: 'reglas_mora',            label: 'Reglas mora',     icon: '📏' },
  { id: 'campanas_cobro',         label: 'Campañas cobro',  icon: '📣' },
  { id: 'cierre_anual',           label: 'Cierre anual',    icon: '📆' },
  { id: 'kpis_financieros',       label: 'KPIs financieros', icon: '📉' },
  { id: 'cobranza_judicial',      label: 'Cobr. judicial',   icon: '⚖️' },
  { id: 'recibos_digitales',      label: 'Recibos',          icon: '🧾' },
  { id: 'informe_mensual',        label: 'Informe mensual',  icon: '📄' },
  { id: 'buzon_sugerencias',      label: 'Sugerencias',      icon: '💬' },
  { id: 'vencimientos_criticos',  label: 'Vencimientos',     icon: '⏳' },
  { id: 'capacitacion_personal',  label: 'Capacitación',     icon: '🎓' },
  { id: 'proyectos_cond',         label: 'Proyectos',        icon: '🏗️' },
  { id: 'metricas_servicio',      label: 'Métricas servicio',icon: '📊' },
  { id: 'analisis_cartera',       label: 'Cartera',          icon: '📉' },
  { id: 'integracion_agua',       label: 'Integración agua', icon: '💧' },
  { id: 'centro_costos',          label: 'Centro costos',    icon: '💰' },
  { id: 'manual_residente',       label: 'Manual residente', icon: '📚' },
  { id: 'exportacion',            label: 'Exportar',         icon: '📥' },
  { id: 'multi_condominio',       label: 'Multi-condominio', icon: '🏘️' },
  { id: 'automatizaciones',       label: 'Automatizaciones', icon: '⚙️' },
  { id: 'scoring_unidades',       label: 'Scoring',          icon: '🎯' },
  { id: 'panel_turno',           label: 'Panel turno',      icon: '🟢' },
  { id: 'plantillas_mensaje',    label: 'Plantillas msg.',  icon: '📨' },
  { id: 'flujo_aprobacion',      label: 'Aprobaciones',     icon: '✅' },
  { id: 'cuadro_mando',          label: 'Cuadro de mando',  icon: '📈' },
  { id: 'generacion_cuotas',     label: 'Generar cuotas',   icon: '🏭' },
  { id: 'mapa_unidades',         label: 'Mapa unidades',    icon: '🗺️' },
  { id: 'envio_masivo',          label: 'Envío masivo',     icon: '📤' },
  { id: 'resumen_ejecutivo',     label: 'Resumen ejecutivo',icon: '📋' },
  { id: 'ordenes_compra',        label: 'Órdenes compra',   icon: '🛒' },
  { id: 'graficas_tendencias',   label: 'Tendencias',       icon: '📊' },
  { id: 'control_accesos_qr',    label: 'Accesos QR',       icon: '📱' },
  { id: 'asamblea_digital',      label: 'Asamblea digital', icon: '🖥️' },
  { id: 'comparativo_presupuesto', label: 'Ppto. vs Real',  icon: '📋' },
  { id: 'proformas',             label: 'Proformas',        icon: '📑' },
  { id: 'bitacora_eventos',      label: 'Bitácora eventos', icon: '📰' },
  { id: 'indice_calidad',        label: 'Índice calidad',   icon: '🏆' },
  { id: 'kanban_tickets',        label: 'Kanban tickets',   icon: '🗂️' },
  { id: 'conciliacion_cobros',   label: 'Conciliación',     icon: '🔄' },
  { id: 'estado_cuenta_residente', label: 'Edo. cuenta',    icon: '📃' },
  { id: 'pronostico_financiero', label: 'Pronóstico',       icon: '🔮' },
  { id: 'simulador_cuotas',      label: 'Simulador',        icon: '🧮' },
  { id: 'calendario_mantenimiento', label: 'Calendario',   icon: '📆' },
  { id: 'reporte_deudores',      label: 'Deudores',         icon: '📋' },
  { id: 'resumen_residente',     label: 'Vista residente',  icon: '🏠' },
  { id: 'gestor_alertas',        label: 'Alertas',          icon: '🚨' },
  { id: 'utilizacion_amenidades',label: 'Uso amenidades',   icon: '📊' },
  { id: 'comparativo_anual',     label: 'Comp. anual',      icon: '📅' },
  { id: 'gantt_mantenimiento',   label: 'Gantt tickets',    icon: '📐' },
  { id: 'mapa_calor_cuotas',    label: 'Mapa de calor',    icon: '🌡️' },
  { id: 'encuesta_dashboard',   label: 'Encuestas',        icon: '📝' },
  { id: 'analisis_visitantes',  label: 'Visitantes',       icon: '👥' },
  { id: 'informe_ejecutivo',    label: 'Informe ejecutivo',icon: '📰' },
  { id: 'tablero_ocupacion',    label: 'Tablero ocupación',icon: '🏗️' },
  { id: 'gestion_fondo',        label: 'Fondo de reserva', icon: '🏦' },
  { id: 'dashboard_sostenibilidad', label: 'Sostenibilidad', icon: '🌿' },
  { id: 'configuracion_cond',   label: 'Config. condominio',icon: '⚙️' },
  { id: 'bitacora_actividad',   label: 'Bitácora actividad',icon: '📋' },
  { id: 'panel_directivo',      label: 'Panel directivo',   icon: '🏛️' },
  { id: 'gestion_conflictos',   label: 'Conflictos',        icon: '⚖️' },
  { id: 'directorio_comunidad', label: 'Directorio',        icon: '📒' },
]

// ── Secciones de navegación de 2 niveles ─────────────────────────────────────
type SectionKey = 'panel' | 'finanzas' | 'residentes' | 'operaciones' | 'instalaciones' | 'seguridad' | 'comunidad' | 'administracion' | 'especiales'

interface SectionDef { id: SectionKey; label: string; icon: string; tabs: string[] }

const SECTIONS: SectionDef[] = [
  { id: 'panel', label: 'Panel', icon: '📊', tabs: [
    'panel', 'panel_directivo', 'cuadro_mando', 'dashboard_ejecutivo', 'resumen_ejecutivo',
    'informe_ejecutivo', 'informe_mensual', 'indice_calidad', 'dashboard_sostenibilidad',
    'bitacora_actividad', 'gestor_alertas', 'alertas', 'centro_notificaciones', 'graficas_tendencias', 'metricas_servicio',
    'bitacora_eventos', 'reportes', 'kpis_financieros',
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
    'entrega_unidad', 'portal', 'resumen_residente', 'solicitudes', 'vehiculos', 'mascotas',
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
    'visitantes', 'analisis_visitantes', 'vis_frecuentes', 'seguridad', 'paqueteria',
    'objetos', 'incidentes', 'reclamos', 'bitacora_guardia', 'presencia', 'panel_turno',
    'emergencias',
  ]},
  { id: 'comunidad', label: 'Comunidad', icon: '🏘️', tabs: [
    'comunidad', 'infracciones', 'sanciones', 'gestion_conflictos', 'asambleas',
    'asamblea_digital', 'votaciones', 'junta', 'actas', 'acuerdos', 'eventos_comunidad',
    'agenda', 'programa_actividades', 'buzon_sugerencias', 'encuestas', 'encuesta_dashboard',
    'comunicados', 'recordatorios',
  ]},
  { id: 'administracion', label: 'Administración', icon: '📋', tabs: [
    'documentos', 'reglamento', 'firmas', 'personal', 'capacitacion_personal',
    'correspondencia', 'libro_novedades', 'notas_admin', 'reg_autoridades', 'bitacora_acciones',
    'vencimientos_criticos', 'polizas', 'inspecciones', 'propuestas', 'memoria',
    'automatizaciones', 'plantillas_mensaje', 'flujo_aprobacion', 'envio_masivo',
    'notificaciones', 'configuracion_cond', 'configuracion', 'multi_condominio',
  ]},
  { id: 'especiales', label: 'Especiales', icon: '⭐', tabs: [
    'str', 'locales', 'housekeeping', 'concierge', 'residuos', 'mudanzas', 'sostenibilidad',
  ]},
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
  const [activeSection, setActiveSection] = useState<SectionKey>('panel')
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
      supabase.from('control_generador').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('control_sistema_incendio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('control_camaras_seguridad').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('lecturas_medidor_gas').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      // Fase 28
      supabase.from('recordatorios_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_limite'),
      supabase.from('plantillas_cuota').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('bitacora_acciones').select('*').eq('company_id', cid).order('created_at', { ascending: false }).limit(500),
      // Fase 29
      supabase.from('recargos_mora').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_aplicacion', { ascending: false }),
      supabase.from('convenios_cuota_cond').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('historial_saldos_unidad').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
      supabase.from('notificaciones_enviadas').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_envio', { ascending: false }).limit(500),
      // Fase 30
      supabase.from('reglas_mora_config').select('*').eq('project_id', pid).eq('company_id', cid).order('dias_vencimiento'),
      supabase.from('campanas_cobro').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('cierres_anuales').select('*').eq('project_id', pid).eq('company_id', cid).order('anio', { ascending: false }),
      // Fase 31
      supabase.from('cobranza_judicial').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      supabase.from('recibos_digitales').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('fecha_emision', { ascending: false }),
      supabase.from('informes_mensuales').select('*').eq('project_id', pid).eq('company_id', cid).order('periodo', { ascending: false }),
      supabase.from('sugerencias_condominio').select('*, unidades(nombre)').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      // Fase 32
      supabase.from('vencimientos_extra').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_vencimiento'),
      supabase.from('capacitacion_personal_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_inicio', { ascending: false }),
      supabase.from('proyectos_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      // Fase 33
      supabase.from('manual_residente_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('orden').order('titulo'),
      // Fase 34
      supabase.from('automatizaciones_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      // Fase 35
      supabase.from('plantillas_mensaje_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('nombre'),
      supabase.from('flujo_aprobacion_cond').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_solicitud', { ascending: false }),
      // Fase 37
      supabase.from('ordenes_compra').select('*').eq('project_id', pid).eq('company_id', cid).order('correlativo', { ascending: false }),
      supabase.from('asambleas_digital').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha_hora', { ascending: false }),
      // Fase 38
      supabase.from('proformas_condominio').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      // Fase 39
      supabase.from('conciliacion_cobros_log').select('*').eq('project_id', pid).eq('company_id', cid).order('created_at', { ascending: false }),
      // Fase 43
      supabase.from('fondo_reserva').select('*').eq('project_id', pid).eq('company_id', cid).order('fecha', { ascending: false }),
      supabase.from('config_condominio').select('*').eq('project_id', pid).eq('company_id', cid).maybeSingle(),
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

        {/* Barra de secciones (nivel 1) */}
        <div style={{ display: 'flex', gap: 1, overflowX: 'auto', marginTop: 8, borderBottom: '2px solid #e2e8f0' }}>
          {SECTIONS.map(sec => {
            const activa = activeSection === sec.id
            return (
              <button key={sec.id} onClick={() => {
                setActiveSection(sec.id)
                if (!sec.tabs.includes(activeTab)) {
                  const primero = sec.tabs.find(tid => TABS.some(t => t.id === tid))
                  if (primero) setActiveTab(primero as CondominioTab)
                }
              }}
                style={{
                  padding: '7px 13px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontSize: 12, fontWeight: activa ? 700 : 500,
                  background: activa ? '#0f172a' : '#f1f5f9',
                  color: activa ? '#fff' : '#64748b',
                  borderRadius: '6px 6px 0 0',
                  borderBottom: activa ? '2px solid #0f172a' : '2px solid transparent',
                  marginBottom: -2,
                }}>
                {sec.icon} {sec.label}
              </button>
            )
          })}
        </div>

        {/* Barra de sub-tabs (nivel 2) */}
        <div style={{ display: 'flex', gap: 1, overflowX: 'auto', background: '#f8fafc', padding: '0 2px', borderBottom: '1px solid #e2e8f0' }}>
          {SECTIONS.find(s => s.id === activeSection)?.tabs
            .map(tid => TABS.find(t => t.id === tid))
            .filter(Boolean)
            .map(tab => tab && (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as CondominioTab)}
                style={{
                  padding: '6px 12px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  fontSize: 11, fontWeight: activeTab === tab.id ? 700 : 400,
                  background: activeTab === tab.id ? '#fff' : 'transparent',
                  color: activeTab === tab.id ? '#0ea5e9' : '#94a3b8',
                  borderBottom: activeTab === tab.id ? '2px solid #0ea5e9' : '2px solid transparent',
                  borderRadius: '4px 4px 0 0',
                }}>
                {tab.icon} {tab.label}
              </button>
            ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'panel' && <PanelGeneralTab cuotas={cuotas} tickets={tickets} visitantes={visitantes} amenidades={amenidades} reservas={reservas} polizas={polizas} inspecciones={inspecciones} gastos={gastos} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}

        {activeTab === 'cuotas' && <CuotasTab cuotas={cuotas} unidades={unidadesProyecto} proyectos={proyectosActivos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'visitantes' && <VisitantesTab visitantes={visitantes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} proyectoNombre={proyectoActual?.nombre} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'amenidades' && <AmenidadesTab amenidades={amenidades} reservas={reservas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

        {activeTab === 'mantenimiento' && <MantenimientoTab tickets={tickets} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} proyectoNombre={proyectoActual?.nombre} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}

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
        {activeTab === 'centro_notificaciones' && <CentroNotificacionesTab cuotas={cuotas} tickets={tickets} reservas={reservas} polizas={polizas} sugerencias={sugerencias} vencimientosExtra={vencimientosExtra} inspecciones={inspecciones} contratos={contratos} unidades={unidadesProyecto} moneda={moneda} />}
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
        {activeTab === 'cierres' && <CierresMensualesTab cierres={cierres} cuotas={cuotas} gastos={gastos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} proyectoNombre={proyectoActual?.nombre} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
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
        {activeTab === 'fondo_reserva' && <FondoReservaTab movimientos={fondoReserva} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} proyectoNombre={proyectoActual?.nombre} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
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
        {activeTab === 'generador' && <ControlGeneradorTab registros={controlGenerador} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'incendio' && <ControlSistemaIncendioTab registros={controlIncendio} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'camaras' && <ControlCamarasTab camaras={camarasSeguridad} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'gas' && <LecturasMedidorGasTab lecturas={lecturasGas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'recordatorios' && <RecordatoriosTab recordatorios={recordatorios} proyectoId={selectedProyectoId} companyId={cid} userId={uid} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'plantillas_cuota' && <PlantillasCuotaTab plantillas={plantillasCuota} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'bitacora_acciones' && <BitacoraAccionesTab bitacora={bitacoraAcciones} />}
        {activeTab === 'recargos_mora' && <RecargosTab recargos={recargosMora} cuotas={cuotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'convenios_cuota' && <ConveniosCuotaTab convenios={conveniosCuota} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'historial_saldos' && <HistorialSaldosTab historial={historialSaldos} cuotas={cuotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'notificaciones_enviadas' && <NotificacionesEnviadasTab notificaciones={notificacionesEnviadas} unidades={unidadesProyecto} />}
        {activeTab === 'reglas_mora' && <ReglasMoraTab reglas={reglasMora} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'campanas_cobro' && <CampanasCobroTab campanas={campanasCobro} cuotas={cuotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'cierre_anual' && <CierreAnualTab cierres={cierresAnuales} cuotas={cuotas} gastos={gastos} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'kpis_financieros' && <KpisFinancierosTab cuotas={cuotas} gastos={gastos} historialSaldos={historialSaldos} recargosMora={recargosMora} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'cobranza_judicial' && <CobranzaJudicialTab cobranzas={cobranzaJudicial} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'recibos_digitales' && <RecibosDigitalesTab recibos={recibosDigitales} cuotas={cuotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} autorNombre={currentUser.name ?? ''} proyectoNombre={proyectoActual?.nombre} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'informe_mensual' && <InformeMensualTab informes={informesMensuales} cuotas={cuotas} gastos={gastos} tickets={tickets} visitantes={visitantes} incidentes={incidentes} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'buzon_sugerencias' && <BuzonSugerenciasTab sugerencias={sugerencias} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'vencimientos_criticos' && <VencimientosCriticosTab vencimientosExtra={vencimientosExtra} polizas={polizas} contratosProveedores={contratosProveedores} inspecciones={inspecciones} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'capacitacion_personal' && <CapacitacionPersonalTab capacitaciones={capacitaciones} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'proyectos_cond' && <ProyectosCondominioTab proyectos={proyectosCond} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'metricas_servicio' && <MetricasServicioTab tickets={tickets} sugerencias={sugerencias} visitantes={visitantes} cuotas={cuotas} moneda={moneda} />}
        {activeTab === 'analisis_cartera' && <AnalisisCarteraTab cuotas={cuotas} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'integracion_agua' && <IntegracionAguaTab unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'centro_costos' && <CentroCostosTab gastos={gastos} cuotas={cuotas} moneda={moneda} />}
        {activeTab === 'manual_residente' && <ManualResidenteTab articulos={articulosManual} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'exportacion' && <ExportacionTab cuotas={cuotas} gastos={gastos} tickets={tickets} visitantes={visitantes} unidades={unidadesProyecto} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'multi_condominio' && <MultiCondominioTab proyectos={proyectosActivos} companyId={cid} moneda={moneda} />}
        {activeTab === 'automatizaciones' && <AutomatizacionesTab automatizaciones={automatizaciones} cuotas={cuotas} tickets={tickets} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'scoring_unidades' && <ScoringUnidadesTab cuotas={cuotas} infracciones={infracciones} sanciones={sanciones} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'panel_turno' && <PanelTurnoTab visitantes={visitantes} tickets={tickets} tareasCond={tareasCond} reservas={reservas} polizas={polizas} contratosProveedores={contratosProveedores} inspecciones={inspecciones} vencimientosExtra={vencimientosExtra} cuotas={cuotas} />}
        {activeTab === 'plantillas_mensaje' && <PlantillasMensajeTab plantillas={plantillasMensaje} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'flujo_aprobacion' && <FlujoAprobacionTab flujos={flujoAprobacion} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} autorNombre={currentUser.name ?? ''} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'cuadro_mando' && <CuadroMandoTab cuotas={cuotas} tickets={tickets} visitantes={visitantes} gastos={gastos} presupuestos={presupuestos} incidentes={incidentes} sugerencias={sugerencias} polizas={polizas} contratosProveedores={contratosProveedores} inspecciones={inspecciones} vencimientosExtra={vencimientosExtra} encuestas={encuestas} moneda={moneda} />}
        {activeTab === 'generacion_cuotas' && <GeneracionCuotasTab cuotas={cuotas} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'mapa_unidades' && <MapaUnidadesTab unidades={unidadesProyecto} cuotas={cuotas} contratos={contratos} moneda={moneda} />}
        {activeTab === 'envio_masivo' && <EnvioMasivoTab plantillas={plantillasMensaje} cuotas={cuotas} unidades={unidadesProyecto} reservas={reservas} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} proyectoNombre={proyectoActual?.nombre} onRefresh={cargarDatos} />}
        {activeTab === 'resumen_ejecutivo' && <ResumenEjecutivoTab cuotas={cuotas} tickets={tickets} gastos={gastos} presupuestos={presupuestos} unidades={unidadesProyecto} incidentes={incidentes} polizas={polizas} contratosProveedores={contratosProveedores} inspecciones={inspecciones} vencimientosExtra={vencimientosExtra} sugerencias={sugerencias} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'ordenes_compra' && <OrdenesCompraTab ordenes={ordenesCompra} proveedores={contratosProveedores} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'graficas_tendencias' && <GraficasTendenciasTab cuotas={cuotas} tickets={tickets} gastos={gastos} incidentes={incidentes} moneda={moneda} />}
        {activeTab === 'control_accesos_qr' && <ControlAccesosQRTab visitantes={visitantes} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'asamblea_digital' && <AsambleaDigitalTab asambleas={asambleasDigital} unidades={unidadesProyecto} proyectoId={selectedProyectoId} companyId={cid} userId={uid} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'comparativo_presupuesto' && <ComparativoPresupuestoTab gastos={gastos} presupuestos={presupuestos} moneda={moneda} />}
        {activeTab === 'proformas' && <ProformasTab proformas={proformas} proveedores={contratosProveedores} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'bitacora_eventos' && <BitacoraEventosTab visitantes={visitantes} tickets={tickets} incidentes={incidentes} anuncios={anuncios} ordenesCompra={ordenesCompra} asambleas={asambleasDigital} gastos={gastos} cuotas={cuotas} moneda={moneda} />}
        {activeTab === 'indice_calidad' && <IndiceCalidadTab cuotas={cuotas} tickets={tickets} incidentes={incidentes} encuestas={encuestas} polizas={polizas} contratosProveedores={contratosProveedores} planesMantenimiento={planesMantenimiento} sugerencias={sugerencias} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'kanban_tickets' && <KanbanTicketsTab tickets={tickets} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'conciliacion_cobros' && <ConciliacionCobrosTab cuotas={cuotas} unidades={unidadesProyecto} conciliaciones={conciliaciones} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'estado_cuenta_residente' && <EstadoCuentaResidenteTab cuotas={cuotas} recargosMora={recargosMora} conveniosCuota={conveniosCuota} unidades={unidadesProyecto} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'pronostico_financiero' && <PronosticoFinancieroTab cuotas={cuotas} gastos={gastos} moneda={moneda} />}
        {activeTab === 'simulador_cuotas' && <SimuladorCuotasTab cuotas={cuotas} gastos={gastos} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'calendario_mantenimiento' && <CalendarioMantenimientoTab tickets={tickets} reservas={reservas} planesMantenimiento={planesMantenimiento} inspecciones={inspecciones} vencimientosExtra={vencimientosExtra} />}
        {activeTab === 'reporte_deudores' && <ReporteDeudoresTab cuotas={cuotas} unidades={unidadesProyecto} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'resumen_residente' && <ResumenResidenteTab cuotas={cuotas} recargosMora={recargosMora} reservas={reservas} anuncios={anuncios} tickets={tickets} unidades={unidadesProyecto} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'gestor_alertas' && <GestorAlertasTab cuotas={cuotas} tickets={tickets} polizas={polizas} contratosProveedores={contratosProveedores} inspecciones={inspecciones} vencimientosExtra={vencimientosExtra} sugerencias={sugerencias} moneda={moneda} />}
        {activeTab === 'utilizacion_amenidades' && <UtilizacionAmenidadesTab amenidades={amenidades} reservas={reservas} moneda={moneda} />}
        {activeTab === 'comparativo_anual' && <ComparativoAnualTab cuotas={cuotas} gastos={gastos} moneda={moneda} />}
        {activeTab === 'gantt_mantenimiento' && <GanttMantenimientoTab tickets={tickets} moneda={moneda} />}
        {activeTab === 'mapa_calor_cuotas' && <MapaCalorCuotasTab cuotas={cuotas} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'encuesta_dashboard' && <EncuestaDashboardTab encuestas={encuestas} respuestas={respuestasEncuesta} />}
        {activeTab === 'analisis_visitantes' && <AnalisisVisitantesTab visitantes={visitantes} unidades={unidadesProyecto} />}
        {activeTab === 'informe_ejecutivo' && <InformeEjecutivoTab cuotas={cuotas} gastos={gastos} tickets={tickets} visitantes={visitantes} unidades={unidadesProyecto} polizas={polizas} contratosProveedores={contratosProveedores} inspecciones={inspecciones} sugerencias={sugerencias} moneda={moneda} proyectoNombre={proyectoActual?.nombre} />}
        {activeTab === 'tablero_ocupacion' && <TableroOcupacionTab unidades={unidadesProyecto} contratos={contratos} cuotas={cuotas} moneda={moneda} />}
        {activeTab === 'gestion_fondo' && <GestionFondoReservaTab movimientos={fondoReservaMovs} proyectoId={selectedProyectoId} companyId={cid} moneda={moneda} canCreate={canCreate('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'dashboard_sostenibilidad' && <DashboardSostenibilidadTab gastos={gastos} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'configuracion_cond' && <ConfiguracionCondominioTab config={configCondominio} proyectoId={selectedProyectoId} companyId={cid} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'bitacora_actividad' && <BitacoraActividadTab cuotas={cuotas} visitantes={visitantes} tickets={tickets} reservas={reservas} anuncios={anuncios} conciliaciones={conciliaciones} fondoReservaMovs={fondoReservaMovs} infracciones={infracciones} sugerencias={sugerencias} unidades={unidadesProyecto} moneda={moneda} />}
        {activeTab === 'panel_directivo' && <PanelDirectivoTab cuotas={cuotas} gastos={gastos} presupuestos={presupuestos} tickets={tickets} polizas={polizas} inspecciones={inspecciones} contratos={contratos} infracciones={infracciones} sugerencias={sugerencias} unidades={unidadesProyecto} recargosMora={recargosMora} fondoReservaMovs={fondoReservaMovs} moneda={moneda} />}
        {activeTab === 'gestion_conflictos' && <GestionConflictosTab infracciones={infracciones} sugerencias={sugerencias} unidades={unidadesProyecto} canEdit={canEdit('condominios')} onRefresh={cargarDatos} />}
        {activeTab === 'directorio_comunidad' && <DirectorioComunidadTab unidades={unidadesProyecto} contratos={contratos} mascotas={mascotas} vehiculos={vehiculos} />}
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
      </div>
    </div>
  )
}
