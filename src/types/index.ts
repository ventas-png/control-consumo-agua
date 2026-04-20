export interface Cliente {
  id: string;
  nombre: string;
  codigo: string;
  medidor?: string;
  lectura_inicial?: number;
  email?: string;
  direccion?: string;
  telefono?: string;
  whatsapp?: string | null;
  puede_crear_cuenta?: boolean;
  // Datos personales
  nacionalidad?: string | null;
  cui_dui?: string | null;
  fecha_nacimiento?: string | null;
  // Datos de facturación
  numero_facturacion?: string | null;
  // Contacto adicional
  telefono_alterno?: string | null;
  updated_at?: string;
  updated_by?: string | null;
  updated_by_name?: string | null;
}

export interface CompanyCliente {
  id: string;
  company_id: string;
  cliente_id: string;
  added_by?: string;
  created_at?: string;
}

export interface ClienteLookupResult {
  match_count: 0 | 2 | 3;
  cliente_id: string | null;
  cliente_nombre?: string;
  mismatched_fields?: string[];
}

export interface GPS {
  lat: number;
  lng: number;
}

export interface Registro {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  contador_id?: string | null;
  fecha: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo: number;
  tarifa_aplicada: number;
  tarifa_exceso_aplicada?: number;
  canon_aplicado: number;
  monto_calculado: number;
  tipo_cobro: string;
  estado: 'pendiente' | 'pagado' | 'mora';
  monto_pagado?: number;
  fecha_pago?: string | null;
  mes?: string;
  fecha_lectura_anterior?: string;
  dias_servicio?: number;
  notas?: string;
  gps?: GPS;
  foto?: string;
}

export interface Empresa {
  id?: string;
  nombre?: string;
}

export type TipoAgua =
  | 'potable'
  | 'rehuso'
  | 'piscina'
  | 'desalinada'
  | 'riego'
  | 'jacuzzi'
  | 'consumo_humano'
  | 'desmineralizada'
  | 'residuales_tratadas';

export interface FuenteAgua {
  id: string;
  identificador: string;
  nombre: string;
  tipo_agua: TipoAgua;
  descripcion?: string;
  activo: boolean;
  created_at: string;
}

export interface RegistroCalidad {
  id: string;
  fuente_id: string;
  fecha: string;
  parametros: Record<string, number>;
  cumplimiento: Record<string, boolean | null>;
  cumple_total: boolean;
  observaciones?: string;
  reporte_base64?: string;
  reporte_tipo?: 'pdf' | 'imagen';
  reporte_nombre?: string;
  created_by?: string;
  fuentes_agua?: {
    identificador: string;
    nombre: string;
    tipo_agua: TipoAgua;
  };
}

export type UserRole = 'admin' | 'super_admin' | 'company_owner' | 'operator' | 'viewer' | 'cliente' | 'collector';

export interface ModulePermission {
  module_key: string
  can_view: boolean
  can_create: boolean
  can_edit: boolean
  can_change_status: boolean
}

export type ModulePermissionsMap = Record<string, ModulePermission>

export interface UserSession {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  company_id?: string;
  cliente_id?: string;
  login_time: string;
  expires_at: string;
  module_permissions?: ModulePermissionsMap;
}

export interface Ruta {
  id: string;
  nombre: string;
  descripcion?: string;
  tipo_ruta: 'clientes' | 'contadores' | 'unidades';
  cliente_ids: string[];
  contador_ids: string[];
  unidad_ids: string[];
  asignado_a?: string;
  asignado_nombre?: string;
  asignado_email?: string;
  asignado_telefono?: string;
  fecha_programada?: string; // 'YYYY-MM-DD'
  completada: boolean;
  created_at: string;
}

export interface Tarifa {
  id: string;
  project_id: string;
  company_id: string;
  nombre: string;
  descripcion?: string;
  tipo_agua: string;
  precio_m3: number;
  precio_m3_exceso: number;
  canon_fijo: number;
  consumo_minimo: number;
  activa: boolean;
  fecha_revision?: string | null;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
  updated_by_name?: string | null;
}

export interface Contador {
  id: string;
  project_id: string;
  company_id: string;
  numero_serie: string;
  tipo_agua: TipoAgua;
  descripcion?: string;
  marca?: string;
  modelo?: string;
  fecha_instalacion?: string;
  lectura_inicial: number;
  activo: boolean;
  tarifa_id?: string | null;
  unidad_id?: string | null;
  medida?: string | null;
  material?: string | null;
  tipo_contador?: string | null;
  valvula_cheque?: string | null;
  tipo_llave?: string | null;
  llave_antifraude?: string | null;
  valvula_aire?: string | null;
  fecha_reemplazo_sugerida?: string | null;
  numero_derecho_servicio?: string | null;
  cantidad_derecho_servicio_m3?: number | null;
  periodicidad_lectura_dias?: number | null;
  contratista_instalador?: string | null;
  garantia_instalacion_vence?: string | null;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
  updated_by_name?: string | null;
}

export type TipoUnidad =
  | 'apartamento'
  | 'casa'
  | 'bodega'
  | 'local_comercial'
  | 'oficina'
  | 'parqueadero'
  | 'otro';

export type TipoRegimen =
  | 'no_sujeto'
  | 'urbanizacion'
  | 'condominio'
  | 'propiedad_horizontal'
  | 'otro';

export type EstadoOcupacional =
  | 'en_construccion'
  | 'habitado'
  | 'en_remodelacion'
  | 'desabitado'
  | 'en_proceso_de_mudanza'
  | 'desocupada'
  | 'disponible_venta'
  | 'disponible_renta'
  | 'en_mantenimiento'
  | 'problemas_legales'
  | 'activo_extraordinario';

export type ContratoSuministro = 'si' | 'no' | 'na';

export interface Unidad {
  id: string;
  project_id: string;
  company_id: string;
  nombre: string;
  tipo: TipoUnidad;
  descripcion?: string;
  piso?: number | null;
  area_m2?: number | null;
  propietario_nombre?: string;
  propietario_telefono?: string;
  propietario_email?: string;
  activo: boolean;
  cliente_id?: string | null;
  created_at?: string;
  updated_at?: string;
  // Datos del inmueble
  direccion?: string | null;
  datos_registrales?: string | null;
  tipo_regimen?: TipoRegimen | null;
  fecha_construccion?: string | null;
  // Estado ocupacional
  estado_ocupacional?: EstadoOcupacional | null;
  // Contrato de suministro
  contrato_suministro?: ContratoSuministro | null;
  fecha_firma_contrato?: string | null;
  numero_contrato_suministro?: string | null;
  fecha_vencimiento_contrato?: string | null;
  updated_by?: string | null;
  updated_by_name?: string | null;
}

export type EstadoProyecto = 'activo' | 'inactivo' | 'suspendido'

export type MaxUnidadesPorTipo = {
  apartamento: number | null
  casa: number | null
  bodega: number | null
  local_comercial: number | null
  oficina: number | null
  parqueadero: number | null
  otro: number | null
}

export interface Proyecto {
  id: string
  nombre: string
  logo_url: string | null
  descripcion: string | null
  direccion: string | null
  latitud: number | null
  longitud: number | null
  moneda: string
  estado: EstadoProyecto
  max_unidades_apartamento: number | null
  max_unidades_casa: number | null
  max_unidades_bodega: number | null
  max_unidades_local_comercial: number | null
  max_unidades_oficina: number | null
  max_unidades_parqueadero: number | null
  max_unidades_otro: number | null
}

export const MONEDAS = [
  { simbolo: 'Q',   nombre: 'Quetzal (Guatemala)' },
  { simbolo: '$',   nombre: 'Dólar' },
  { simbolo: '€',   nombre: 'Euro' },
  { simbolo: 'C$',  nombre: 'Córdoba (Nicaragua)' },
  { simbolo: 'L',   nombre: 'Lempira (Honduras)' },
  { simbolo: '₡',   nombre: 'Colón (Costa Rica)' },
  { simbolo: 'B/.', nombre: 'Balboa (Panamá)' },
] as const

export type AppSection =
  | 'clientes'
  | 'lecturas'
  | 'tabla'
  | 'dashboard'
  | 'admin_dashboard'
  | 'cobros'
  | 'mapa'
  | 'calidad'
  | 'rutas'
  | 'tarifas'
  | 'unidades'
  | 'contadores'
  | 'configuracion'
  | 'perfil'
  | 'empresa_proyectos'
  | 'superadmin_empresas'
  | 'comunicacion'
  | 'servicios_energia'
  | 'condominios';

// ── Módulo Condominios ────────────────────────────────────────────────────────

export type ConceptoCuota = 'mantenimiento' | 'extraordinaria' | 'CAM' | 'otro'
export type EstadoCuota = 'pendiente' | 'pagado' | 'moroso'

export interface CuotaCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  concepto: ConceptoCuota
  monto: number
  periodo: string           // 'YYYY-MM'
  fecha_vencimiento?: string | null
  estado: EstadoCuota
  pago_id?: string | null
  notas?: string | null
  created_by?: string | null
  created_at: string
  // joins opcionales
  unidad_nombre?: string
}

export interface Visitante {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  nombre: string
  identificacion?: string | null
  placa_vehiculo?: string | null
  motivo?: string | null
  pre_autorizado_por?: string | null
  hora_entrada: string
  hora_salida?: string | null
  foto_url?: string | null
  registrado_por?: string | null
  notas?: string | null
  created_at: string
  // joins opcionales
  unidad_nombre?: string
}

export interface Amenidad {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  capacidad_max?: number | null
  horario_inicio?: string | null   // 'HH:MM'
  horario_fin?: string | null      // 'HH:MM'
  requiere_deposito: boolean
  monto_deposito?: number | null
  activo: boolean
  foto_url?: string | null
  created_at: string
}

export type EstadoReserva = 'confirmada' | 'cancelada' | 'pendiente'

export interface ReservaAmenidad {
  id: string
  company_id: string
  amenidad_id: string
  unidad_id: string
  cliente_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  num_invitados: number
  estado: EstadoReserva
  deposito_pagado: boolean
  notas?: string | null
  created_by?: string | null
  created_at: string
  // joins opcionales
  amenidad_nombre?: string
  unidad_nombre?: string
}

export type TipoTicket = 'preventivo' | 'correctivo'
export type PrioridadTicket = 'baja' | 'media' | 'alta' | 'urgente'
export type EstadoTicket = 'abierto' | 'en_proceso' | 'resuelto' | 'cerrado'

export interface TicketMantenimiento {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoTicket
  titulo: string
  descripcion?: string | null
  prioridad: PrioridadTicket
  estado: EstadoTicket
  asignado_a?: string | null
  reportado_por?: string | null
  cliente_id?: string | null
  foto_urls: string[]
  costo_estimado?: number | null
  costo_real?: number | null
  fecha_limite?: string | null
  fecha_cierre?: string | null
  notas_cierre?: string | null
  created_at: string
  updated_at: string
  // joins opcionales
  unidad_nombre?: string
  asignado_nombre?: string
}

export type TipoAnuncio = 'aviso' | 'urgente' | 'evento' | 'mantenimiento'

export interface AnuncioComunidad {
  id: string
  company_id: string
  project_id: string
  titulo: string
  contenido: string
  tipo: TipoAnuncio
  publicado_por: string
  fecha_evento?: string | null
  activo: boolean
  foto_url?: string | null
  created_at: string
  // joins opcionales
  publicado_por_nombre?: string
}

// ── Módulo Condominios Fase 2 ─────────────────────────────────────────────────

export type TipoParqueo = 'asignado' | 'visita' | 'discapacitado'
export type EspecieMascota = 'perro' | 'gato' | 'ave' | 'otro'
export type EstadoPaquete = 'pendiente' | 'entregado' | 'devuelto'
export type TipoInfraccion = 'ruido' | 'basura' | 'estacionamiento' | 'mascota' | 'daños' | 'otro'
export type EstadoInfraccion = 'emitida' | 'notificada' | 'en_descargo' | 'resuelta' | 'anulada'
export type EstadoRonda = 'en_curso' | 'completada' | 'incompleta'
export type TipoNovedad = 'incidente' | 'observacion' | 'alarma' | 'acceso' | 'otro'
export type PrioridadNovedad = 'normal' | 'alta' | 'critica'
export type EstadoContrato = 'activo' | 'vencido' | 'terminado'

export interface ParqueoCondominio {
  id: string
  company_id: string
  project_id: string
  numero: string
  tipo: TipoParqueo
  unidad_id?: string | null
  placa_vehiculo?: string | null
  marca_vehiculo?: string | null
  color_vehiculo?: string | null
  activo: boolean
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface Mascota {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  nombre: string
  especie: EspecieMascota
  raza?: string | null
  color?: string | null
  fecha_nacimiento?: string | null
  fecha_ultima_vacuna?: string | null
  activo: boolean
  foto_url?: string | null
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface PaqueteRecibido {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  remitente?: string | null
  descripcion: string
  num_guia?: string | null
  empresa_mensajeria?: string | null
  estado: EstadoPaquete
  hora_recepcion: string
  hora_entrega?: string | null
  recibido_por?: string | null
  entregado_por?: string | null
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface InfraccionCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: TipoInfraccion
  descripcion: string
  monto_multa?: number | null
  estado: EstadoInfraccion
  reportado_por?: string | null
  fecha_infraccion: string
  fecha_limite_descargo?: string | null
  descargo?: string | null
  resolucion?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface RondaSeguridad {
  id: string
  company_id: string
  project_id: string
  guardia_id?: string | null
  inicio: string
  fin?: string | null
  estado: EstadoRonda
  notas?: string | null
  created_at: string
}

export interface NovedadSeguridad {
  id: string
  company_id: string
  project_id: string
  ronda_id?: string | null
  tipo: TipoNovedad
  descripcion: string
  ubicacion?: string | null
  prioridad: PrioridadNovedad
  reportado_por?: string | null
  foto_url?: string | null
  created_at: string
}

export interface ContratoArrendamiento {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  arrendatario_nombre: string
  arrendatario_identificacion?: string | null
  arrendatario_telefono?: string | null
  arrendatario_email?: string | null
  monto_renta: number
  dia_pago: number
  fecha_inicio: string
  fecha_fin?: string | null
  deposito?: number | null
  estado: EstadoContrato
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

// ── Centro de Comunicación ─────────────────────────────────────────────────

export type ConversationStatus =
  | 'abierta'
  | 'en_progreso'
  | 'esperando_cliente'
  | 'resuelta'
  | 'cerrada';

export type ConversationCategory = 'general' | 'pagos' | 'tecnico' | 'calidad';
export type ConversationPriority = 'baja' | 'media' | 'alta' | 'urgente';

export interface Conversation {
  id: string;
  company_id: string;
  project_id?: string | null;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  is_internal?: boolean;
  subject: string;
  category: ConversationCategory;
  priority: ConversationPriority;
  status: ConversationStatus;
  assigned_to?: string | null;
  assigned_name?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
  // join opcional (último mensaje)
  last_message?: string | null;
  unread_count?: number;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_type: 'cliente' | 'agent';
  sender_name?: string | null;
  body: string;
  is_internal_note: boolean;
  read_at?: string | null;
  created_at: string;
  // Adjuntos (imagen o documento)
  attachment_url?: string | null;
  attachment_name?: string | null;
  attachment_type?: string | null;
  attachment_size?: number | null;
}

export interface ConversationAccessRule {
  id: string;
  company_id: string;
  role: string;
  can_view_all: boolean;
  can_respond: boolean;
  can_assign: boolean;
  categories: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationAssignment {
  id: string;
  conversation_id: string;
  user_id: string;
  user_name: string;
  assigned_by_id: string;
  assigned_by_name: string;
  seen_at: string | null;
  created_at: string;
}

export type FormaPago =
  | 'efectivo'
  | 'transferencia'
  | 'deposito'
  | 'tarjeta_credito'
  | 'tarjeta_debito'
  | 'cheque'
  | 'convenio_pago'
  | 'otro';

export type TipoAplicacion = 'pago_total' | 'abono' | 'convenio';
export type EstadoPago = 'pendiente' | 'verificado' | 'rechazado' | 'aplicado';
export type EstadoConvenio = 'activo' | 'completado' | 'incumplido' | 'cancelado';

export interface Pago {
  id: string;
  registro_id?: string | null;
  cliente_id: string;
  project_id?: string | null;
  monto: number;
  metodo: FormaPago;
  referencia?: string | null;
  numero_documento?: string | null;
  tipo_aplicacion?: TipoAplicacion;
  convenio_id?: string | null;
  comprobante_url?: string | null;
  comprobante_tipo?: 'imagen' | 'pdf' | null;
  verification_status?: EstadoPago;
  verification_notes?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  stripe_payment_intent_id?: string | null;
  paypal_transaction_id?: string | null;
  estado: EstadoPago;
  notas?: string | null;
  created_by?: string | null;
  created_at: string;
  cliente_nombre?: string;
}

export interface CompanyPaymentConfig {
  stripe_public_key?: string | null;
  stripe_configured: boolean;
  stripe_activo?: boolean;
  paypal_client_id?: string | null;
  paypal_configured: boolean;
  paypal_activo?: boolean;
}

export interface PaymentRequest {
  id: string;
  cliente_id: string;
  registro_id?: string | null;
  company_id: string;
  monto: number;
  provider: 'stripe' | 'paypal' | 'manual';
  estado: 'pending' | 'succeeded' | 'failed' | 'pending_verification';
  stripe_payment_intent?: string | null;
  paypal_order_id?: string | null;
  numero_comprobante?: string | null;
  referencia?: string | null;
  notas?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConvenioPago {
  id: string;
  cliente_id: string;
  project_id?: string | null;
  company_id?: string | null;
  numero_convenio: string;
  descripcion?: string | null;
  monto_total: number;
  monto_pagado: number;
  cuotas_pactadas?: number | null;
  fecha_inicio: string;
  fecha_vencimiento?: string | null;
  estado: EstadoConvenio;
  registro_ids: string[];
  notas?: string | null;
  created_by?: string | null;
  created_at: string;
  // join opcional
  cliente_nombre?: string;
}

export interface CostoCalculo {
  total: number;
  tipo_cobro: 'Canon Fijo' | 'Consumo Normal' | 'Consumo con Exceso';
  desglose: {
    tramo: 1 | 2 | 3;
    canon_fijo?: number;
    consumo_m3?: number;
    precio_m3?: number;
    derecho_m3?: number;
    exceso_m3?: number;
    precio_exceso?: number;
    monto_base?: number;
    monto_exceso?: number;
  };
}

export interface Parametro {
  key: string;
  label: string;
  unidad: string;
  min: number;
  max: number;
}

export interface Tipologia {
  label: string;
  parametros: Parametro[];
}

// ── Módulo de Servicios Energéticos ────────────────────────────────────────

export type ModoSuministroEnergia = 'red' | 'solar_autonomo' | 'hibrido';

export interface ProveedorEnergia {
  id: string;
  project_id: string;
  company_id: string;
  nombre: string;
  nit?: string;
  contacto?: string;
  tipo: 'distribuidora' | 'comercializadora' | 'autogeneracion';
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface TarifaEnergia {
  id: string;
  project_id: string;
  company_id: string;
  proveedor_id: string;
  nombre: string;
  descripcion?: string;
  precio_kwh_energia: number;
  precio_kw_potencia: number;
  cargo_fijo: number;
  alumbrado_publico: number;
  alumbrado_tipo: 'fijo' | 'porcentual';
  iva_porcentaje: number;
  precio_kwh_exportado: number;
  moneda: string;
  activa: boolean;
  created_at: string;
  updated_at: string;
}

export interface FuenteEnergia {
  id: string;
  project_id: string;
  company_id: string;
  fuente_agua_id: string;
  nombre: string;
  modo_suministro: ModoSuministroEnergia;
  proveedor_id?: string;
  tarifa_id?: string;
  numero_medidor?: string;
  numero_cuenta?: string;
  potencia_contratada_kw?: number;
  capacidad_solar_kwp?: number;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface FacturaEnergia {
  id: string;
  project_id: string;
  company_id: string;
  fuente_energia_id: string;
  proveedor_id?: string;
  tarifa_id?: string;
  numero_factura?: string;
  periodo_inicio: string;
  periodo_fin: string;
  fecha_emision?: string;
  kwh_consumidos: number;
  kwh_generados: number;
  kwh_exportados: number;
  kw_demanda_max?: number;
  monto_energia: number;
  monto_potencia: number;
  monto_cargo_fijo: number;
  monto_alumbrado: number;
  monto_iva: number;
  monto_credito_exportacion: number;
  monto_otros: number;
  monto_total: number;
  moneda: string;
  estado: 'pendiente' | 'pagada' | 'vencida';
  fecha_pago?: string;
  archivo_factura_url?: string;
  notas?: string;
  created_at: string;
  updated_at: string;
}

// ── Difusión (mensajes masivos) ───────────────────────────────────────────────

export type BroadcastTargetType = 'todos' | 'proyecto' | 'unidades' | 'clientes'

export interface Broadcast {
  id: string
  company_id: string
  title: string
  body: string
  sent_by_id: string
  sent_by_name: string
  target_type: BroadcastTargetType
  target_ids: string[]
  recipient_count: number
  send_email: boolean
  created_at: string
  // join optional — calculado en query
  read_count?: number
}

export interface BroadcastRecipient {
  id: string
  broadcast_id: string
  cliente_id: string
  read_at: string | null
  email_sent: boolean
  email_error: string | null
  created_at: string
  // join opcional
  broadcast?: Broadcast
}

// ── Condominios Fase 3 ────────────────────────────────────────────────────────

export type TipoAsamblea = 'ordinaria' | 'extraordinaria'
export type EstadoAsamblea = 'programada' | 'en_curso' | 'finalizada' | 'cancelada'
export type TipoPunto = 'informativo' | 'votacion' | 'debate'
export type TipoVoto = 'a_favor' | 'en_contra' | 'abstencion'
export type ServicioProveedor = 'limpieza' | 'jardineria' | 'seguridad' | 'mantenimiento' | 'elevadores' | 'piscina' | 'otro'
export type EstadoObjeto = 'en_custodia' | 'reclamado' | 'donado' | 'descartado'
export type TipoAgenda = 'tarea' | 'evento' | 'mantenimiento' | 'reunion' | 'otro'
export type EstadoAgenda = 'pendiente' | 'en_curso' | 'completado' | 'cancelado'

export interface Asamblea {
  id: string
  company_id: string
  project_id: string
  titulo: string
  tipo: TipoAsamblea
  fecha: string
  hora_inicio: string
  hora_fin?: string
  lugar?: string
  estado: EstadoAsamblea
  quorum_requerido: number
  quorum_alcanzado?: number
  acta?: string
  convocado_por?: string
  created_at: string
}

export interface PuntoAsamblea {
  id: string
  asamblea_id: string
  orden: number
  titulo: string
  descripcion?: string
  tipo: TipoPunto
  resultado?: string
  created_at: string
  votos?: VotoAsamblea[]
}

export interface VotoAsamblea {
  id: string
  punto_id: string
  unidad_id: string
  voto: TipoVoto
  registrado_por?: string
  created_at: string
  unidad_nombre?: string
}

export interface ContratoProveedor {
  id: string
  company_id: string
  project_id: string
  proveedor_nombre: string
  proveedor_contacto?: string | null
  proveedor_telefono?: string | null
  proveedor_email?: string | null
  servicio: ServicioProveedor
  descripcion?: string | null
  monto_mensual?: number | null
  fecha_inicio: string
  fecha_fin?: string | null
  estado: EstadoContrato
  documento_url?: string | null
  notas?: string | null
  created_at: string
}

export interface ObjetoPerdido {
  id: string
  company_id: string
  project_id: string
  descripcion: string
  lugar_encontrado?: string | null
  fecha_encontrado: string
  estado: EstadoObjeto
  reclamado_por?: string | null
  fecha_reclamo?: string | null
  foto_url?: string | null
  registrado_por?: string | null
  notas?: string | null
  created_at: string
}

export interface AgendaItem {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  tipo: TipoAgenda
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  estado: EstadoAgenda
  asignado_a?: string | null
  recurrente: boolean
  notas?: string | null
  created_at: string
}

// ── Condominios Fase 4 ────────────────────────────────────────────────────────

export type CategoriaInventario = 'herramienta' | 'equipo' | 'material' | 'mobiliario' | 'vehiculo' | 'otro'
export type EstadoInventario = 'disponible' | 'en_uso' | 'en_reparacion' | 'dado_de_baja'
export type TipoPoliza = 'incendio' | 'responsabilidad_civil' | 'terremoto' | 'inundacion' | 'robo' | 'vida' | 'otro'
export type EstadoPoliza = 'vigente' | 'vencida' | 'cancelada'
export type TipoInspeccion = 'bomberos' | 'igss' | 'municipalidad' | 'electrica' | 'sanitaria' | 'elevadores' | 'otro'
export type ResultadoInspeccion = 'aprobado' | 'aprobado_con_observaciones' | 'reprobado' | 'pendiente'
export type CargoPersonal = 'conserje' | 'guardia' | 'jardinero' | 'mantenimiento' | 'administrador' | 'otro'
export type TurnoPersonal = 'diurno' | 'nocturno' | 'rotativo'
export type EstadoPersonal = 'activo' | 'inactivo' | 'vacaciones' | 'incapacidad'

export interface ItemInventario {
  id: string
  company_id: string
  project_id: string
  nombre: string
  categoria: CategoriaInventario
  descripcion?: string | null
  numero_serie?: string | null
  ubicacion?: string | null
  estado: EstadoInventario
  cantidad: number
  cantidad_minima: number
  unidad_medida: string
  costo_unitario?: number | null
  proveedor?: string | null
  fecha_adquisicion?: string | null
  fecha_vencimiento?: string | null
  foto_url?: string | null
  notas?: string | null
  created_at: string
}

export interface PolizaSeguro {
  id: string
  company_id: string
  project_id: string
  numero_poliza: string
  aseguradora: string
  tipo: TipoPoliza
  descripcion?: string | null
  suma_asegurada?: number | null
  prima_anual?: number | null
  fecha_inicio: string
  fecha_vencimiento: string
  estado: EstadoPoliza
  agente_nombre?: string | null
  agente_telefono?: string | null
  agente_email?: string | null
  documento_url?: string | null
  notas?: string | null
  created_at: string
}

export interface InspeccionNormativa {
  id: string
  company_id: string
  project_id: string
  tipo: TipoInspeccion
  entidad_inspectora?: string | null
  fecha: string
  resultado: ResultadoInspeccion
  hallazgos?: string | null
  acciones_correctivas?: string | null
  fecha_proxima?: string | null
  inspector_nombre?: string | null
  certificado_url?: string | null
  notas?: string | null
  created_at: string
}

export interface PersonalCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  cargo: CargoPersonal
  telefono?: string | null
  email?: string | null
  fecha_ingreso?: string | null
  turno: TurnoPersonal
  estado: EstadoPersonal
  salario?: number | null
  dpi?: string | null
  foto_url?: string | null
  notas?: string | null
  created_at: string
}

// ── Condominios Fase 5 ────────────────────────────────────────────────────────

export type TipoContactoEmergencia = 'bomberos' | 'policia' | 'ambulancia' | 'hospital' | 'electricidad' | 'agua' | 'gas' | 'administracion' | 'general'
export type TipoMudanza = 'ingreso' | 'salida'
export type EstadoMudanza = 'programada' | 'en_curso' | 'completada' | 'cancelada'
export type CategoriaDocumento = 'reglamento' | 'circular' | 'manual' | 'acta' | 'contrato' | 'formulario' | 'otro'
export type VisibilidadDocumento = 'admin' | 'residentes' | 'todos'
export type TipoResiduo = 'general' | 'reciclable' | 'organico' | 'electronico' | 'peligroso' | 'escombros'
export type EstadoResiduo = 'pendiente' | 'recolectado' | 'procesado'

export interface ContactoEmergencia {
  id: string
  company_id: string
  project_id: string
  nombre: string
  tipo: TipoContactoEmergencia
  telefono: string
  telefono_alternativo?: string | null
  descripcion?: string | null
  disponible_24h: boolean
  orden: number
  activo: boolean
  created_at: string
}

export interface Mudanza {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoMudanza
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  nombre_residente: string
  telefono?: string | null
  empresa_mudanza?: string | null
  estado: EstadoMudanza
  deposito_requerido: boolean
  deposito_pagado: boolean
  monto_deposito?: number | null
  ascensor_reservado: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export interface DocumentoCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  categoria: CategoriaDocumento
  descripcion?: string | null
  url: string
  version?: string | null
  vigente: boolean
  visibilidad: VisibilidadDocumento
  subido_por?: string | null
  created_at: string
}

export interface RegistroResiduo {
  id: string
  company_id: string
  project_id: string
  fecha: string
  tipo_residuo: TipoResiduo
  cantidad_kg?: number | null
  punto_acopio?: string | null
  empresa_recolectora?: string | null
  estado: EstadoResiduo
  incidencia: boolean
  descripcion_incidencia?: string | null
  registrado_por?: string | null
  notas?: string | null
  created_at: string
}

// ── Fase 6: Bodegas, Onboarding, Propuestas, Memoria ──────────────────────────
export type EstadoBodega = 'disponible' | 'asignada' | 'bloqueada'
export interface BodegaCondominio {
  id: string
  company_id: string
  project_id: string
  numero: string
  piso?: string | null
  area_m2?: number | null
  unidad_id?: string | null
  estado: EstadoBodega
  monto_renta?: number | null
  fecha_asignacion?: string | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoOnboarding = 'en_proceso' | 'completado' | 'cancelado'
export interface OnboardingResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  nombre_residente: string
  fecha_ingreso: string
  tipo: 'propietario' | 'arrendatario'
  estado: EstadoOnboarding
  llaves_entregadas: boolean
  reglamento_firmado: boolean
  deposito_pagado: boolean
  datos_registrados: boolean
  accesos_configurados: boolean
  inspeccion_unidad: boolean
  bienvenida_enviada: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type CategoriaPropuesta = 'mejora' | 'reparacion' | 'expansion' | 'tecnologia' | 'seguridad' | 'otro'
export type EstadoPropuesta = 'propuesta' | 'en_evaluacion' | 'aprobada' | 'rechazada' | 'en_ejecucion' | 'completada'
export type PrioridadPropuesta = 'baja' | 'media' | 'alta'
export interface PropuestaInversion {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  categoria: CategoriaPropuesta
  monto_estimado?: number | null
  prioridad: PrioridadPropuesta
  estado: EstadoPropuesta
  votos_favor: number
  votos_contra: number
  fecha_propuesta: string
  fecha_aprobacion?: string | null
  fecha_ejecucion?: string | null
  notas?: string | null
  created_at: string
}

export type TipoPeriodo = 'mensual' | 'trimestral' | 'anual'
export type EstadoMemoria = 'borrador' | 'publicado'
export interface MemoriaLabores {
  id: string
  company_id: string
  project_id: string
  titulo: string
  periodo: string
  tipo_periodo: TipoPeriodo
  resumen?: string | null
  logros?: string | null
  pendientes?: string | null
  tickets_resueltos?: number | null
  visitantes_registrados?: number | null
  cuotas_cobradas?: number | null
  incidencias_atendidas?: number | null
  estado: EstadoMemoria
  created_at: string
}

// ── Fase 7: STR, Locales Comerciales, Housekeeping ────────────────────────────
export type PlataformaSTR = 'airbnb' | 'booking' | 'vrbo' | 'directo' | 'otro'
export type EstadoSTR = 'confirmada' | 'en_curso' | 'completada' | 'cancelada'
export interface ReservaSTR {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  huesped_nombre: string
  huesped_email?: string | null
  huesped_telefono?: string | null
  fecha_entrada: string
  fecha_salida: string
  num_adultos: number
  num_ninos: number
  plataforma: PlataformaSTR
  monto_noche?: number | null
  monto_total?: number | null
  estado: EstadoSTR
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type GiroLocal = 'restaurante' | 'oficina' | 'comercio' | 'servicio' | 'otro'
export type EstadoLocal = 'disponible' | 'ocupado' | 'en_remodelacion'
export interface LocalComercial {
  id: string
  company_id: string
  project_id: string
  numero_local: string
  piso?: string | null
  area_m2?: number | null
  giro: GiroLocal
  inquilino_nombre?: string | null
  inquilino_telefono?: string | null
  fecha_inicio?: string | null
  fecha_fin?: string | null
  renta_base?: number | null
  porcentaje_cam?: number | null
  cuota_cam?: number | null
  estado: EstadoLocal
  notas?: string | null
  created_at: string
}

export type TipoHousekeeping = 'limpieza_estandar' | 'limpieza_profunda' | 'lavanderia' | 'mantenimiento_menor' | 'otro'
export type EstadoHousekeeping = 'pendiente' | 'en_proceso' | 'completado' | 'cancelado'
export interface ServicioHousekeeping {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoHousekeeping
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  responsable?: string | null
  estado: EstadoHousekeeping
  costo?: number | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

// ── Fase 8: Firma Digital, Concierge, Llaves, Encuestas ───────────────────────
export type TipoDocumentoFirma = 'contrato' | 'reglamento' | 'acta' | 'aviso' | 'otro'
export type EstadoFirma = 'pendiente' | 'firmado' | 'rechazado' | 'expirado'
export interface FirmaDigital {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  documento_titulo: string
  documento_tipo: TipoDocumentoFirma
  firmante_nombre?: string | null
  firmante_email?: string | null
  estado: EstadoFirma
  fecha_vencimiento?: string | null
  fecha_firma?: string | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoConcierge = 'taxi' | 'restaurante' | 'tour' | 'compras' | 'mensajeria' | 'limpieza_extra' | 'otro'
export type EstadoConcierge = 'pendiente' | 'en_proceso' | 'completado' | 'cancelado'
export interface SolicitudConcierge {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoConcierge
  descripcion: string
  fecha_solicitud: string
  hora_solicitud?: string | null
  estado: EstadoConcierge
  atendido_por?: string | null
  costo?: number | null
  notas_staff?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoLlave = 'fisica' | 'tarjeta' | 'codigo' | 'app'
export type EstadoLlave = 'activa' | 'devuelta' | 'perdida' | 'bloqueada'
export interface LlaveCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoLlave
  descripcion: string
  codigo?: string | null
  cantidad: number
  fecha_entrega?: string | null
  fecha_devolucion?: string | null
  estado: EstadoLlave
  deposito_pagado: boolean
  monto_deposito?: number | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoEncuesta = 'borrador' | 'activa' | 'cerrada'
export interface Encuesta {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  preguntas: unknown[]
  fecha_inicio?: string | null
  fecha_fin?: string | null
  estado: EstadoEncuesta
  created_at: string
}

export interface RespuestaEncuesta {
  id: string
  company_id: string
  project_id: string
  encuesta_id: string
  unidad_id?: string | null
  nombre_respondente?: string | null
  respuestas: unknown
  created_at: string
  unidad_nombre?: string
}

// ── Phase 9: Contabilidad, Presupuesto, Alertas ───────────────────────────────

export type CategoriaGasto = 'mantenimiento' | 'servicios' | 'administrativo' | 'seguridad' | 'limpieza' | 'obras' | 'otros'
export type EstadoGasto = 'pendiente' | 'pagado' | 'anulado'
export interface GastoCondominio {
  id: string
  company_id: string
  project_id: string
  concepto: string
  categoria: CategoriaGasto
  monto: number
  fecha: string
  proveedor_nombre?: string | null
  estado: EstadoGasto
  metodo_pago?: string | null
  comprobante_num?: string | null
  notas?: string | null
  created_at: string
}

export interface PresupuestoCondominio {
  id: string
  company_id: string
  project_id: string
  anio: number
  categoria: string
  monto_presupuestado: number
  notas?: string | null
  created_at: string
}

export type TipoAlerta = 'vencimiento' | 'recordatorio' | 'aviso' | 'urgente'
export type EstadoAlerta = 'activa' | 'resuelta' | 'ignorada'
export interface AlertaCondominio {
  id: string
  company_id: string
  project_id: string
  tipo: TipoAlerta
  titulo: string
  descripcion?: string | null
  fecha_alerta: string
  estado: EstadoAlerta
  referencia_tabla?: string | null
  referencia_id?: string | null
  created_at: string
}
