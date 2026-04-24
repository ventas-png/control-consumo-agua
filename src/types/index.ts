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
  // campos de pago
  fecha_pago?: string | null
  metodo_pago?: string | null
  referencia_pago?: string | null
  comprobante_url?: string | null
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
  qr_token?: string | null
  valido_hasta?: string | null
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
  ruta_id?: string | null
  inicio: string
  fin?: string | null
  estado: EstadoRonda
  notas?: string | null
  created_at: string
  // joins
  ruta_nombre?: string
}

export interface AreaCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  icono: string
  orden: number
  activo: boolean
  created_at: string
}

export interface RutaRonda {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  tiempo_estimado_min?: number | null
  activo: boolean
  created_at: string
}

export interface PuntoControlRuta {
  id: string
  ruta_id: string
  area_id: string
  orden: number
  instrucciones?: string | null
  tiempo_estimado_min?: number | null
  created_at: string
  // joins
  area_nombre?: string
  area_icono?: string
}

export type EstadoVisitaControl = 'pendiente' | 'ok' | 'novedad' | 'omitido'

export interface VisitaControl {
  id: string
  ronda_id: string
  punto_id: string
  estado: EstadoVisitaControl
  notas?: string | null
  visitado_en?: string | null
  created_at: string
  // joins
  area_nombre?: string
  area_icono?: string
  punto_orden?: number
  instrucciones?: string | null
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
  fecha_nacimiento?: string | null
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

// ── Phase 10: Calendario, Configuración ──────────────────────────────────────

export type TipoEvento = 'evento' | 'mantenimiento' | 'asamblea' | 'vencimiento' | 'recordatorio'
export interface EventoCalendario {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  tipo: TipoEvento
  fecha_inicio: string
  hora_inicio?: string | null
  fecha_fin?: string | null
  hora_fin?: string | null
  recurrente: boolean
  frecuencia?: string | null
  color: string
  todo_el_dia: boolean
  created_by?: string | null
  created_at: string
}

export type TipoConfiguracion = 'texto' | 'numero' | 'booleano' | 'json' | 'texto_largo'
export interface ConfiguracionCondominio {
  id: string
  company_id: string
  project_id: string
  clave: string
  valor?: string | null
  tipo: TipoConfiguracion
  descripcion?: string | null
  updated_at: string
}

// ── Phase 11: Solicitudes, Junta, Préstamos, Comunicados ─────────────────────

export type TipoSolicitud = 'solvencia' | 'permiso_mudanza' | 'permiso_obra' | 'reclamo' | 'sugerencia' | 'certificado' | 'otro'
export type EstadoSolicitud = 'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado'
export type PrioridadSolicitud = 'baja' | 'normal' | 'alta' | 'urgente'
export interface SolicitudResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: TipoSolicitud
  descripcion: string
  estado: EstadoSolicitud
  respuesta?: string | null
  prioridad: PrioridadSolicitud
  atendido_por?: string | null
  fecha_limite?: string | null
  created_at: string
  unidad_nombre?: string
}

export type CargoJunta = 'presidente' | 'vicepresidente' | 'tesorero' | 'secretario' | 'vocal' | 'fiscal' | 'otro'
export interface MiembroJunta {
  id: string
  company_id: string
  project_id: string
  cargo: CargoJunta
  nombre: string
  unidad_id?: string | null
  telefono?: string | null
  email?: string | null
  periodo_inicio: string
  periodo_fin?: string | null
  activo: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoPrestamo = 'prestado' | 'devuelto' | 'dañado' | 'perdido'
export interface PrestamoEquipo {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  equipo_nombre: string
  cantidad: number
  fecha_prestamo: string
  hora_prestamo?: string | null
  fecha_devolucion?: string | null
  hora_devolucion?: string | null
  estado: EstadoPrestamo
  deposito?: number | null
  deposito_pagado: boolean
  observaciones?: string | null
  entregado_por?: string | null
  recibido_por?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoComunicado = 'carta' | 'circular' | 'aviso' | 'certificado' | 'acta'
export type DestinatarioComunicado = 'todos' | 'propietarios' | 'arrendatarios' | 'junta' | 'especifico'
export interface ComunicadoCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  contenido: string
  tipo: TipoComunicado
  destinatario: DestinatarioComunicado
  unidad_id?: string | null
  enviado_por?: string | null
  fecha_envio: string
  firmado: boolean
  created_at: string
  unidad_nombre?: string
}

export type TipoActa = 'ordinaria' | 'extraordinaria' | 'junta' | 'comite' | 'otro'
export interface ActaReunion {
  id: string
  company_id: string
  project_id: string
  titulo: string
  tipo: TipoActa
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  lugar?: string | null
  quorum?: number | null
  quorum_requerido?: number | null
  asistentes: { nombre: string; unidad?: string; rol?: string }[]
  orden_del_dia: { punto: string; descripcion?: string; acuerdo?: string }[]
  acuerdos?: string | null
  observaciones?: string | null
  redactada_por?: string | null
  aprobada: boolean
  created_at: string
}

export interface CierreMensual {
  id: string
  company_id: string
  project_id: string
  periodo: string
  total_cuotas_emitidas: number
  total_cuotas_cobradas: number
  total_gastos: number
  saldo_periodo: number
  unidades_morosas: number
  notas?: string | null
  cerrado_por?: string | null
  estado: 'borrador' | 'cerrado'
  created_at: string
}

export type EventoNotificacion = 'cuota_pendiente' | 'cuota_morosa' | 'visita_registrada' | 'ticket_abierto' | 'ticket_resuelto' | 'reserva_confirmada' | 'alerta_activa' | 'solicitud_nueva'
export type CanalNotificacion = 'email' | 'whatsapp' | 'push' | 'sms'
export type DestinatarioNotificacion = 'admin' | 'residente' | 'ambos'
export interface ReglaNotificacion {
  id: string
  company_id: string
  project_id: string
  nombre: string
  evento: EventoNotificacion
  canal: CanalNotificacion
  destinatario: DestinatarioNotificacion
  dias_anticipacion: number
  activo: boolean
  mensaje_template?: string | null
  created_at: string
}

export interface MedidorUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  contador_id: string
  activo: boolean
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoVotacion = 'simple' | 'multiple' | 'ponderada'
export type EstadoVotacion = 'abierta' | 'cerrada' | 'anulada'
export interface OpcionVoto { id: string; texto: string }
export interface Votacion {
  id: string
  company_id: string
  project_id: string
  asamblea_id?: string | null
  titulo: string
  descripcion?: string | null
  tipo: TipoVotacion
  opciones: OpcionVoto[]
  estado: EstadoVotacion
  quorum_requerido?: number | null
  total_unidades?: number | null
  fecha_inicio: string
  fecha_cierre?: string | null
  resultado?: string | null
  created_at: string
}

export interface Voto {
  id: string
  company_id: string
  votacion_id: string
  unidad_id: string
  opcion_id: string
  comentario?: string | null
  registrado_por?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoSancion = 'pendiente' | 'pagado' | 'anulado' | 'apelado'
export interface SancionCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  infraccion_id?: string | null
  concepto: string
  monto: number
  fecha_emision: string
  fecha_vencimiento?: string | null
  estado: EstadoSancion
  observaciones?: string | null
  created_at: string
  unidad_nombre?: string
}

export type FrecuenciaMantenimiento = 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'semestral' | 'anual'
export type EstadoEjecucion = 'completado' | 'parcial' | 'omitido'
export interface PlanMantenimiento {
  id: string
  company_id: string
  project_id: string
  equipo: string
  descripcion?: string | null
  frecuencia: FrecuenciaMantenimiento
  responsable?: string | null
  ultima_ejecucion?: string | null
  proxima_ejecucion?: string | null
  costo_estimado?: number | null
  activo: boolean
  created_at: string
}

export interface EjecucionMantenimiento {
  id: string
  company_id: string
  plan_id: string
  fecha: string
  realizado_por?: string | null
  costo_real?: number | null
  observaciones?: string | null
  estado: EstadoEjecucion
  created_at: string
}

export type TipoCorrespondencia = 'entrada' | 'salida'
export type CategoriaCorrespondencia = 'carta' | 'notificacion_legal' | 'factura' | 'circular' | 'otro'
export type EstadoCorrespondencia = 'pendiente' | 'atendido' | 'archivado'
export interface CorrespondenciaCondominio {
  id: string
  company_id: string
  project_id: string
  tipo: TipoCorrespondencia
  categoria: CategoriaCorrespondencia
  asunto: string
  remitente?: string | null
  destinatario?: string | null
  fecha: string
  numero_guia?: string | null
  prioridad: 'normal' | 'urgente'
  estado: EstadoCorrespondencia
  observaciones?: string | null
  unidad_id?: string | null
  created_at: string
}

export type TurnoNovedad = 'mañana' | 'tarde' | 'noche'
export interface LibroNovedad {
  id: string
  company_id: string
  project_id: string
  fecha: string
  turno: TurnoNovedad
  responsable: string
  hora_inicio?: string | null
  hora_fin?: string | null
  novedades: string
  incidentes: unknown[]
  firmado: boolean
  created_at: string
}

export type EstadoAcuerdo = 'pendiente' | 'en_proceso' | 'cumplido' | 'vencido' | 'cancelado'
export interface SeguimientoAcuerdo {
  id: string
  company_id: string
  project_id: string
  acta_id?: string | null
  titulo: string
  descripcion?: string | null
  responsable?: string | null
  fecha_limite?: string | null
  estado: EstadoAcuerdo
  notas_seguimiento?: string | null
  created_at: string
}

export type TipoVehiculo = 'auto' | 'moto' | 'camion' | 'otro'
export interface VehiculoResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  placa: string
  marca?: string | null
  modelo?: string | null
  color?: string | null
  anio?: number | null
  tipo: TipoVehiculo
  activo: boolean
  notas?: string | null
  created_at: string
}

export type TipoEventoComunidad = 'cultural' | 'deportivo' | 'social' | 'informativo' | 'otro'
export type EstadoEventoComunidad = 'programado' | 'en_curso' | 'realizado' | 'cancelado'
export interface EventoComunidad {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  tipo: TipoEventoComunidad
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  lugar?: string | null
  capacidad_max?: number | null
  estado: EstadoEventoComunidad
  asistentes_real?: number | null
  costo_estimado?: number | null
  created_at: string
}

export interface RegistroAsistenteEvento {
  id: string
  company_id: string
  evento_id: string
  unidad_id: string
  nombre: string
  num_personas: number
  confirmado: boolean
  asistio?: boolean | null
  created_at: string
}

export interface CajaChica {
  id: string
  company_id: string
  project_id: string
  fecha_apertura: string
  monto_inicial: number
  responsable: string
  estado: 'abierta' | 'cerrada'
  fecha_cierre?: string | null
  cerrado_por?: string | null
  notas?: string | null
  created_at: string
}

export interface MovimientoCaja {
  id: string
  company_id: string
  caja_id: string
  tipo: 'ingreso' | 'egreso'
  concepto: string
  monto: number
  comprobante?: string | null
  fecha: string
  registrado_por?: string | null
  created_at: string
}

export type EstadoObra = 'planificada' | 'en_ejecucion' | 'completada' | 'pausada' | 'cancelada'
export interface ObraMejora {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  area?: string | null
  contratista?: string | null
  monto_contrato?: number | null
  fecha_inicio?: string | null
  fecha_fin_estimada?: string | null
  fecha_fin_real?: string | null
  estado: EstadoObra
  progreso: number
  notas?: string | null
  created_at: string
}

export interface PlanPagoCond {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  concepto: string
  monto_total: number
  num_cuotas: number
  monto_cuota: number
  fecha_inicio: string
  estado: 'activo' | 'completado' | 'incumplido' | 'cancelado'
  notas?: string | null
  aprobado_por?: string | null
  created_at: string
}

export interface CuotaPlanPago {
  id: string
  company_id: string
  plan_id: string
  numero: number
  monto: number
  fecha_vencimiento: string
  pagado: boolean
  fecha_pago?: string | null
  comprobante?: string | null
  created_at: string
}

export type TipoAcceso = 'tarjeta' | 'codigo' | 'llave_digital' | 'biometrico'
export interface AccesoResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: TipoAcceso
  identificador: string
  titular: string
  activo: boolean
  fecha_emision: string
  fecha_vencimiento?: string | null
  notas?: string | null
  created_at: string
}

export type EstadoGarantia = 'vigente' | 'vencida' | 'reclamada' | 'sin_garantia'
export interface GarantiaEquipo {
  id: string
  company_id: string
  project_id: string
  equipo: string
  area?: string | null
  numero_serie?: string | null
  proveedor?: string | null
  contacto_soporte?: string | null
  fecha_compra?: string | null
  fecha_vencimiento?: string | null
  monto_compra?: number | null
  estado: EstadoGarantia
  notas?: string | null
  created_at: string
}

export interface EntregaUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: 'entrega' | 'devolucion'
  fecha: string
  condicion_general: 'excelente' | 'buena' | 'regular' | 'deteriorada'
  inquilino?: string | null
  propietario?: string | null
  representante_admin?: string | null
  observaciones?: string | null
  inventario_items: unknown[]
  firmado_propietario: boolean
  firmado_inquilino: boolean
  created_at: string
}

export interface AvisoCobro {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  tipo: 'primer_aviso' | 'segundo_aviso' | 'ultimo_aviso' | 'notificacion_legal'
  monto_total: number
  detalle: unknown[]
  fecha_emision: string
  fecha_limite?: string | null
  estado: 'emitido' | 'entregado' | 'pagado' | 'anulado'
  enviado_por?: string | null
  notas?: string | null
  created_at: string
}

export interface BitacoraManto {
  id: string
  company_id: string
  project_id: string
  fecha: string
  turno: 'mañana' | 'tarde' | 'noche'
  responsable: string
  area?: string | null
  tareas: unknown[]
  observaciones?: string | null
  firmado: boolean
  created_at: string
}

export interface EvaluacionProveedor {
  id: string
  company_id: string
  project_id: string
  proveedor_id?: string | null
  nombre_proveedor: string
  calificacion: number
  puntualidad?: number | null
  calidad?: number | null
  precio?: number | null
  comentarios?: string | null
  evaluado_por?: string | null
  fecha: string
  created_at: string
}

export interface ReclamoCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo: 'queja' | 'sugerencia' | 'reclamo_formal' | 'apelacion'
  asunto: string
  descripcion?: string | null
  prioridad: 'baja' | 'normal' | 'alta' | 'urgente'
  estado: 'recibido' | 'en_revision' | 'respondido' | 'cerrado' | 'escalado'
  respuesta_admin?: string | null
  respondido_por?: string | null
  fecha_respuesta?: string | null
  plazo_respuesta?: string | null
  anonimo: boolean
  created_at: string
}

// ── Fase 18 ───────────────────────────────────────────────────────────────────

export type TipoMovimientoFondo = 'aporte' | 'retiro' | 'ajuste'
export type EstadoMovimientoFondo = 'pendiente' | 'aprobado' | 'rechazado'

export interface FondoReserva {
  id: string
  company_id: string
  project_id: string
  tipo: TipoMovimientoFondo
  concepto: string
  monto: number
  fecha: string
  justificacion?: string | null
  aprobado_por?: string | null
  estado: EstadoMovimientoFondo
  notas?: string | null
  created_at: string
}

export type TipoObra = 'remodelacion' | 'ampliacion' | 'reparacion' | 'pintura' | 'otro'
export type EstadoPermisoObra = 'solicitado' | 'aprobado' | 'en_ejecucion' | 'completado' | 'rechazado'

export interface PermisoObraUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  tipo_obra: TipoObra
  descripcion: string
  fecha_inicio?: string | null
  fecha_fin_estimada?: string | null
  horario_permitido?: string | null
  fianza?: number | null
  estado: EstadoPermisoObra
  aprobado_por?: string | null
  observaciones?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TipoUnidadTarifa = 'todas' | 'residencial' | 'comercial' | 'bodega' | 'parqueo'
export type PeriodicidadTarifa = 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'unica_vez'

export interface TarifaCondominio {
  id: string
  company_id: string
  project_id: string
  concepto: string
  descripcion?: string | null
  monto: number
  tipo_unidad: TipoUnidadTarifa
  periodicidad: PeriodicidadTarifa
  activo: boolean
  vigente_desde?: string | null
  vigente_hasta?: string | null
  notas?: string | null
  created_at: string
}

export type TipoIncidente = 'robo' | 'vandalismo' | 'accidente' | 'incendio' | 'pelea' | 'otro'
export type EstadoIncidente = 'reportado' | 'investigando' | 'resuelto' | 'cerrado'

export interface IncidenteSeguridad {
  id: string
  company_id: string
  project_id: string
  fecha: string
  hora?: string | null
  tipo: TipoIncidente
  descripcion: string
  area?: string | null
  reportado_por?: string | null
  estado: EstadoIncidente
  involucrados?: string | null
  seguimiento?: string | null
  created_at: string
}

// ── Fase 19 ───────────────────────────────────────────────────────────────────

export type EstadoChecklist = 'completo' | 'con_observaciones' | 'pendiente'

export interface ChecklistItem { item: string; ok: boolean; observacion: string }

export interface ChecklistArea {
  id: string
  company_id: string
  project_id: string
  area: string
  fecha: string
  inspector?: string | null
  items: ChecklistItem[]
  estado: EstadoChecklist
  notas?: string | null
  created_at: string
}

export type FrecuenciaLimpieza = 'diaria' | 'semanal' | 'quincenal' | 'mensual'
export type EstadoLimpieza = 'pendiente' | 'en_curso' | 'completado'

export interface ProgramacionLimpieza {
  id: string
  company_id: string
  project_id: string
  area: string
  frecuencia: FrecuenciaLimpieza
  responsable?: string | null
  ultima_ejecucion?: string | null
  proxima_ejecucion?: string | null
  estado: EstadoLimpieza
  activo: boolean
  notas?: string | null
  created_at: string
}

export type TipoConsumoEnergia = 'electricidad' | 'agua' | 'gas' | 'otro'

export interface ConsumoEnergiaArea {
  id: string
  company_id: string
  project_id: string
  area: string
  tipo: TipoConsumoEnergia
  periodo: string
  lectura_anterior?: number | null
  lectura_actual: number
  unidad: string
  costo_unitario?: number | null
  total_costo?: number | null
  fecha_lectura: string
  notas?: string | null
  created_at: string
}

export type TipoResidente = 'propietario' | 'arrendatario' | 'familiar' | 'otro'
export type EstadoResidente = 'activo' | 'anterior'

export interface HistorialResidente {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  nombre_completo: string
  tipo: TipoResidente
  fecha_desde: string
  fecha_hasta?: string | null
  email?: string | null
  telefono?: string | null
  estado: EstadoResidente
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

// ── Fase 20 ───────────────────────────────────────────────────────────────────

export type TipoVehiculoVisita = 'auto' | 'moto' | 'camion' | 'otro'

export interface EstacionamientoVisita {
  id: string
  company_id: string
  project_id: string
  espacio: string
  unidad_visitada?: string | null
  placa: string
  tipo_vehiculo: TipoVehiculoVisita
  visitante_nombre?: string | null
  hora_entrada: string
  hora_salida?: string | null
  autorizado_por?: string | null
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type TurnoGuardia = 'mañana' | 'tarde' | 'noche'
export type EstadoBitacoraGuardia = 'abierto' | 'cerrado'
export type TipoNovedadGuardia = 'normal' | 'urgente' | 'informativo'

export interface NovedadGuardia {
  hora: string
  descripcion: string
  tipo: TipoNovedadGuardia
}

export interface BitacoraGuardia {
  id: string
  company_id: string
  project_id: string
  fecha: string
  turno: TurnoGuardia
  guardia_nombre: string
  hora_inicio?: string | null
  hora_fin?: string | null
  novedades: NovedadGuardia[]
  observaciones?: string | null
  estado: EstadoBitacoraGuardia
  created_at: string
}

export type CategoriaEquipo = 'bomba' | 'ascensor' | 'generador' | 'camara' | 'extintor' | 'planta_electrica' | 'otro'
export type EstadoEquipo = 'operativo' | 'mantenimiento' | 'fuera_servicio' | 'baja'

export interface EquipoComun {
  id: string
  company_id: string
  project_id: string
  nombre: string
  categoria: CategoriaEquipo
  marca?: string | null
  modelo?: string | null
  serial?: string | null
  ubicacion?: string | null
  fecha_compra?: string | null
  valor_compra?: number | null
  vida_util_anios?: number | null
  estado: EstadoEquipo
  ultimo_mantenimiento?: string | null
  proximo_mantenimiento?: string | null
  notas?: string | null
  created_at: string
}

export type EstadoPresencia = 'presente' | 'ausente' | 'tardanza' | 'permiso' | 'vacaciones'

export interface PresenciaPersonal {
  id: string
  company_id: string
  project_id: string
  nombre: string
  cargo?: string | null
  fecha: string
  hora_entrada?: string | null
  hora_salida?: string | null
  estado: EstadoPresencia
  observaciones?: string | null
  created_at: string
}

// ── Fase 21 ──────────────────────────────────────────────────────────────────
export type CategoriaSupministro = 'limpieza' | 'herramienta' | 'material' | 'oficina' | 'seguridad' | 'otro'
export type UnidadMedidaSum = 'unidad' | 'litro' | 'kg' | 'metro' | 'caja' | 'rollo' | 'otro'
export interface SuministroCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  categoria: CategoriaSupministro
  unidad_medida: UnidadMedidaSum
  stock_actual: number
  stock_minimo: number
  ubicacion?: string | null
  proveedor?: string | null
  costo_unitario?: number | null
  notas?: string | null
  activo: boolean
  created_at: string
}

export type TipoMovimientoSum = 'entrada' | 'salida' | 'ajuste'
export interface MovimientoSuministro {
  id: string
  company_id: string
  suministro_id: string
  tipo: TipoMovimientoSum
  cantidad: number
  motivo?: string | null
  area_destino?: string | null
  realizado_por?: string | null
  fecha: string
  notas?: string | null
  created_at: string
  // join
  suministro_nombre?: string
}

export type CategoriaTareaCondominio = 'operativa' | 'mantenimiento' | 'administrativa' | 'seguridad' | 'limpieza' | 'otro'
export type PrioridadTarea = 'baja' | 'media' | 'alta' | 'urgente'
export type EstadoTarea = 'pendiente' | 'en_proceso' | 'completada' | 'cancelada'
export interface ComentarioTarea { fecha: string; autor: string; texto: string }
export interface TareaCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  categoria: CategoriaTareaCondominio
  prioridad: PrioridadTarea
  estado: EstadoTarea
  asignado_a?: string | null
  reportado_por?: string | null
  area?: string | null
  fecha_limite?: string | null
  fecha_inicio?: string | null
  fecha_cierre?: string | null
  costo_estimado?: number | null
  costo_real?: number | null
  comentarios: ComentarioTarea[]
  notas?: string | null
  created_at: string
}

export type EtapaCobranza = 'aviso_amistoso' | 'recordatorio' | 'carta_formal' | 'suspension_servicios' | 'cobro_juridico' | 'acuerdo_pago' | 'resuelto'
export type EstadoCobranza = 'activo' | 'resuelto' | 'cancelado'
export type TipoContactoCobranza = 'llamada' | 'email' | 'visita' | 'mensaje'
export interface ContactoCobranza {
  fecha: string
  tipo: TipoContactoCobranza
  resultado: string
  siguiente_accion?: string
}
export interface GestionCobranza {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  responsable: string
  monto_adeudado: number
  monto_pagado: number
  etapa: EtapaCobranza
  fecha_inicio: string
  fecha_resolucion?: string | null
  contactos: ContactoCobranza[]
  observaciones?: string | null
  estado: EstadoCobranza
  created_at: string
  // join
  unidad_nombre?: string
}

// ── Fase 22 ──────────────────────────────────────────────────────────────────
export type TipoCertificado = 'solvencia' | 'residencia' | 'historial_pagos' | 'paz_y_salvo' | 'otro'
export type EstadoCertificado = 'pendiente' | 'en_proceso' | 'aprobado' | 'rechazado' | 'entregado'
export interface SolicitudCertificado {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  solicitante: string
  tipo: TipoCertificado
  motivo?: string | null
  estado: EstadoCertificado
  fecha_solicitud: string
  fecha_aprobacion?: string | null
  fecha_entrega?: string | null
  aprobado_por?: string | null
  observaciones?: string | null
  created_at: string
  // join
  unidad_nombre?: string
}

export type RelacionVisitaFrecuente = 'familiar' | 'empleado' | 'proveedor' | 'amigo' | 'otro'
export interface VisitaFrecuente {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  nombre: string
  identificacion?: string | null
  relacion: RelacionVisitaFrecuente
  telefono?: string | null
  placa_vehiculo?: string | null
  foto_url?: string | null
  dias_permitidos?: string[] | null
  hora_desde?: string | null
  hora_hasta?: string | null
  activo: boolean
  notas?: string | null
  created_at: string
  // join
  unidad_nombre?: string
}

export type CategoriaReglamento = 'convivencia' | 'pagos' | 'seguridad' | 'areas_comunes' | 'mascotas' | 'mudanzas' | 'otro'
export interface ArticuloReglamento {
  id: string
  company_id: string
  project_id: string
  capitulo: string
  numero_articulo: string
  titulo: string
  contenido: string
  categoria: CategoriaReglamento
  vigente: boolean
  version: string
  fecha_vigencia?: string | null
  notas?: string | null
  created_at: string
}

export type TipoControlPlagas = 'fumigacion' | 'inspeccion' | 'tratamiento' | 'preventivo'
export type ResultadoControlPlagas = 'satisfactorio' | 'con_observaciones' | 'requiere_seguimiento' | 'no_realizado'
export interface ControlPlagas {
  id: string
  company_id: string
  project_id: string
  tipo: TipoControlPlagas
  empresa?: string | null
  tecnico?: string | null
  areas: string[]
  productos?: string | null
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  resultado: ResultadoControlPlagas
  proxima_visita?: string | null
  costo?: number | null
  observaciones?: string | null
  created_at: string
}

// ── Fase 23 ──────────────────────────────────────────────────────────────────
export type CategoriaCargoAdicional = 'reparacion' | 'exceso_consumo' | 'dano' | 'servicio' | 'multa' | 'otro'
export type EstadoCargoAdicional = 'pendiente' | 'pagado' | 'anulado'
export interface CargoAdicionalUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  concepto: string
  categoria: CategoriaCargoAdicional
  monto: number
  fecha_cargo: string
  fecha_vencimiento?: string | null
  estado: EstadoCargoAdicional
  referencia?: string | null
  observaciones?: string | null
  created_at: string
  unidad_nombre?: string
}

export type CategoriaActividad = 'recreativa' | 'deportiva' | 'cultural' | 'educativa' | 'salud' | 'otro'
export type EstadoActividad = 'programada' | 'activa' | 'completada' | 'cancelada'
export interface ProgramaActividad {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  categoria: CategoriaActividad
  instructor?: string | null
  lugar?: string | null
  fecha_inicio: string
  fecha_fin?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  dias_semana?: string[] | null
  cupo_maximo?: number | null
  inscritos: number
  costo: number
  estado: EstadoActividad
  activo: boolean
  notas?: string | null
  created_at: string
}

export type TipoAutoridad = 'policia' | 'bomberos' | 'salud' | 'municipalidad' | 'electricidad' | 'agua' | 'otro'
export type ResultadoAutoridad = 'sin_novedad' | 'acta_levantada' | 'sancion' | 'recomendacion' | 'otro'
export interface RegistroAutoridad {
  id: string
  company_id: string
  project_id: string
  tipo_autoridad: TipoAutoridad
  nombre_institucion?: string | null
  nombre_funcionario?: string | null
  motivo: string
  fecha: string
  hora_llegada?: string | null
  hora_salida?: string | null
  resultado?: ResultadoAutoridad | null
  documento_referencia?: string | null
  requiere_seguimiento: boolean
  fecha_seguimiento?: string | null
  observaciones?: string | null
  created_at: string
}

export type CategoriaNota = 'general' | 'urgente' | 'recordatorio' | 'seguimiento' | 'reunion' | 'otro'
export type PrioridadNota = 'normal' | 'alta' | 'urgente'
export interface NotaAdmin {
  id: string
  company_id: string
  project_id: string
  titulo: string
  contenido: string
  categoria: CategoriaNota
  prioridad: PrioridadNota
  fijada: boolean
  resuelta: boolean
  fecha_recordatorio?: string | null
  autor?: string | null
  created_at: string
}

// ── Fase 24 ───────────────────────────────────────────────────────────────────

export type TurbiededadPiscina = 'cristalina' | 'ligeramente_turbia' | 'turbia'
export type EstadoPiscina = 'abierta' | 'cerrada_mantenimiento' | 'cerrada_quimica' | 'cerrada_incidente'

export interface ControlPiscina {
  id: string
  company_id: string
  project_id: string
  fecha: string
  hora?: string | null
  piscina: string
  ph?: number | null
  cloro?: number | null
  temperatura?: number | null
  turbiedad: TurbiededadPiscina
  estado: EstadoPiscina
  num_usuarios?: number | null
  registrado_por?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoJardineria = 'mantenimiento_general' | 'poda' | 'fumigacion' | 'siembra' | 'riego' | 'limpieza' | 'otro'
export type EstadoJardineria = 'programado' | 'en_proceso' | 'completado' | 'cancelado'

export interface MantenimientoJardineria {
  id: string
  company_id: string
  project_id: string
  fecha: string
  tipo: TipoJardineria
  areas: string[]
  proveedor?: string | null
  trabajadores?: number | null
  horas_trabajo?: number | null
  insumos?: string | null
  costo?: number | null
  estado: EstadoJardineria
  proxima_visita?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoIncidenciaElevador = 'falla' | 'mantenimiento_preventivo' | 'mantenimiento_correctivo' | 'inspeccion_legal' | 'otro'
export type EstadoIncidenciaElevador = 'reportado' | 'en_atencion' | 'resuelto' | 'requiere_seguimiento'

export interface IncidenciaElevador {
  id: string
  company_id: string
  project_id: string
  elevador: string
  tipo: TipoIncidenciaElevador
  descripcion: string
  fecha: string
  hora_inicio?: string | null
  hora_fin?: string | null
  empresa_servicio?: string | null
  tecnico?: string | null
  estado: EstadoIncidenciaElevador
  costo?: number | null
  proxima_inspeccion?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoMantenimientoCisterna = 'lectura' | 'limpieza' | 'cloracion' | 'inspeccion' | 'reparacion'
export type EstadoCisterna = 'normal' | 'bajo_nivel' | 'mantenimiento' | 'fuera_servicio'

export interface MantenimientoCisterna {
  id: string
  company_id: string
  project_id: string
  fecha: string
  cisterna: string
  tipo: TipoMantenimientoCisterna
  nivel_agua_pct?: number | null
  cloro_residual?: number | null
  ph?: number | null
  estado: EstadoCisterna
  empresa_servicio?: string | null
  tecnico?: string | null
  costo?: number | null
  proxima_revision?: string | null
  observaciones?: string | null
  created_at: string
}

// ── Fase 25 ───────────────────────────────────────────────────────────────────

export type TipoRegistroGenerador = 'lectura' | 'mantenimiento' | 'prueba' | 'falla' | 'arranque_emergencia'
export type EstadoGenerador = 'standby' | 'operando' | 'mantenimiento' | 'falla' | 'apagado'

export interface ControlGenerador {
  id: string
  company_id: string
  project_id: string
  generador: string
  fecha: string
  tipo: TipoRegistroGenerador
  nivel_combustible_pct?: number | null
  horas_operacion?: number | null
  horas_acumuladas?: number | null
  estado: EstadoGenerador
  voltaje?: number | null
  frecuencia?: number | null
  operador?: string | null
  empresa_servicio?: string | null
  costo?: number | null
  proximo_mantenimiento?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoSistemaIncendio = 'extintor' | 'rociador' | 'alarma' | 'hidrant' | 'detector_humo' | 'gabinete' | 'otro'
export type TipoInspeccionIncendio = 'revision_visual' | 'prueba_funcional' | 'recarga' | 'reemplazo' | 'inspeccion_legal'
export type ResultadoInspeccionIncendio = 'aprobado' | 'observacion' | 'requiere_mantenimiento' | 'fuera_servicio'

export interface ControlSistemaIncendio {
  id: string
  company_id: string
  project_id: string
  fecha: string
  tipo_sistema: TipoSistemaIncendio
  identificador: string
  ubicacion: string
  tipo_inspeccion: TipoInspeccionIncendio
  resultado: ResultadoInspeccionIncendio
  fecha_vencimiento?: string | null
  empresa_servicio?: string | null
  tecnico?: string | null
  costo?: number | null
  proxima_inspeccion?: string | null
  observaciones?: string | null
  created_at: string
}

export type TipoCamara = 'domo' | 'bullet' | 'ptz' | 'fisheye' | 'otro'
export type EstadoCamara = 'activa' | 'falla' | 'mantenimiento' | 'sin_señal' | 'inactiva'

export interface ControlCamaraSeguridad {
  id: string
  company_id: string
  project_id: string
  codigo: string
  nombre: string
  ubicacion: string
  tipo: TipoCamara
  resolucion?: string | null
  ip_address?: string | null
  grabacion: boolean
  dias_retencion?: number | null
  estado: EstadoCamara
  ultimo_mantenimiento?: string | null
  proximo_mantenimiento?: string | null
  observaciones?: string | null
  activo: boolean
  created_at: string
}

export interface LecturaMedidorGas {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  area?: string | null
  fecha: string
  lectura_anterior?: number | null
  lectura_actual: number
  consumo?: number | null
  alerta_fuga: boolean
  costo_unitario?: number | null
  costo_total?: number | null
  periodo?: string | null
  leido_por?: string | null
  observaciones?: string | null
  created_at: string
  // join
  unidad_nombre?: string
}

// ── Fase 28: Comentarios Ticket, Recordatorios, Plantillas Cuota, Bitácora ──

export interface ComentarioTicket {
  id: string
  company_id: string
  ticket_id: string
  autor_id?: string | null
  autor_nombre: string
  contenido: string
  estado_nuevo?: string | null
  created_at: string
}

export type PrioridadRecordatorio = 'normal' | 'alta' | 'critica'
export type TipoEntidadRecordatorio = 'cuota' | 'contrato' | 'inspeccion' | 'mantenimiento' | 'general'

export interface RecordatorioCondominio {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  fecha_limite: string
  tipo_entidad?: TipoEntidadRecordatorio | null
  entidad_id?: string | null
  asignado_a?: string | null
  asignado_nombre?: string | null
  prioridad: PrioridadRecordatorio
  completado: boolean
  fecha_completado?: string | null
  created_by?: string | null
  created_at: string
}

export type PeriodicidadPlantilla = 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'única'

export interface PlantillaCuota {
  id: string
  company_id: string
  project_id: string
  nombre: string
  concepto: string
  monto: number
  dia_vencimiento: number
  periodicidad: PeriodicidadPlantilla
  aplica_a: string
  activa: boolean
  notas?: string | null
  created_at: string
}

export type AccionBitacora = 'crear' | 'editar' | 'eliminar' | 'aprobar' | 'rechazar' | 'pagar' | 'cerrar'

export interface BitacoraAccion {
  id: string
  company_id: string
  project_id?: string | null
  usuario_id?: string | null
  usuario_nombre: string
  accion: AccionBitacora
  modulo: string
  entidad_id?: string | null
  entidad_desc?: string | null
  detalles?: Record<string, unknown> | null
  ip_address?: string | null
  created_at: string
}

// ── Fase 29: Recargos mora, Convenios cuota, Historial saldos, Notificaciones ─

export type EstadoRecargo = 'pendiente' | 'aplicado' | 'anulado'
export type TipoRecargo = 'porcentaje' | 'monto_fijo'

export interface RecargoMora {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  cuota_id?: string | null
  tipo: TipoRecargo
  valor: number
  monto_calculado: number
  fecha_aplicacion: string
  estado: EstadoRecargo
  motivo?: string | null
  anulado_por?: string | null
  fecha_anulacion?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export type EstadoConvenioCuota = 'activo' | 'cumplido' | 'incumplido' | 'anulado'

export interface ConvenioCuotaCond {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  descripcion: string
  monto_total: number
  num_cuotas: number
  monto_cuota: number
  dia_pago: number
  fecha_inicio: string
  fecha_fin?: string | null
  cuotas_pagadas: number
  estado: EstadoConvenioCuota
  aprobado_por?: string | null
  notas?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
}

export interface HistorialSaldoUnidad {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  periodo: string
  saldo_anterior: number
  cargos_periodo: number
  pagos_periodo: number
  saldo_final: number
  num_cuotas_vencidas: number
  created_at: string
  // joins
  unidad_nombre?: string
}

export type EstadoNotificacion = 'enviado' | 'fallido' | 'pendiente' | 'leido'

export interface NotificacionEnviada {
  id: string
  company_id: string
  project_id?: string | null
  unidad_id?: string | null
  cliente_id?: string | null
  canal: CanalNotificacion
  destinatario: string
  asunto?: string | null
  contenido: string
  estado: EstadoNotificacion
  error_detalle?: string | null
  enviado_por?: string | null
  fecha_envio: string
  created_at: string
  // joins
  unidad_nombre?: string
}

// ── Fase 30 ────────────────────────────────────────────────────────────────────
export type TipoReglaRecargo = 'porcentaje' | 'monto_fijo'
export type AplicarSobreRecargo = 'saldo_vencido' | 'monto_cuota'
export interface ReglaMoraConfig {
  id: string
  company_id: string
  project_id: string
  nombre: string
  dias_vencimiento: number
  tipo: TipoReglaRecargo
  valor: number
  aplicar_sobre: AplicarSobreRecargo
  periodo_gracia: number
  activa: boolean
  notas?: string | null
  created_at: string
}

export type CanalCampana = 'whatsapp' | 'email' | 'sms'
export type EstadoCampana = 'borrador' | 'enviada' | 'completada'
export interface CampanaCobro {
  id: string
  company_id: string
  project_id: string
  nombre: string
  mensaje: string
  canal: CanalCampana
  estado: EstadoCampana
  total_destinatarios: number
  enviadas: number
  fallidas: number
  criterio_dias_mora?: number | null
  criterio_monto_min?: number | null
  enviada_por?: string | null
  fecha_envio?: string | null
  created_at: string
}

export type EstadoCierreAnual = 'borrador' | 'cerrado'
export interface CierreAnual {
  id: string
  company_id: string
  project_id: string
  anio: number
  total_ingresos: number
  total_egresos: number
  saldo: number
  total_cuotas_generadas: number
  total_cuotas_cobradas: number
  tasa_recaudacion?: number | null
  unidades_morosas: number
  monto_mora_total: number
  notas?: string | null
  firmado_por?: string | null
  fecha_cierre?: string | null
  estado: EstadoCierreAnual
  created_at: string
}

// ── Fase 31 ────────────────────────────────────────────────────────────────────
export type EtapaCobranzaJudicial = 'carta_notarial' | 'juzgado' | 'sentencia' | 'ejecutado' | 'archivado'
export type EstadoCobranzaJudicial = 'activo' | 'resuelto' | 'archivado'
export interface CobranzaJudicial {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  etapa: EtapaCobranzaJudicial
  monto_adeudado: number
  fecha_inicio: string
  fecha_actualizacion?: string | null
  abogado?: string | null
  expediente?: string | null
  notas?: string | null
  estado: EstadoCobranzaJudicial
  created_at: string
  unidad_nombre?: string
}

export type EstadoReciboDigital = 'generado' | 'enviado' | 'anulado'
export interface ReciboDigital {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  cuota_id?: string | null
  numero_recibo: string
  monto: number
  concepto: string
  fecha_emision: string
  enviado_por?: string | null
  destinatario_email?: string | null
  destinatario_nombre?: string | null
  estado: EstadoReciboDigital
  notas?: string | null
  created_at: string
  unidad_nombre?: string
}

export type EstadoInformeMensual = 'borrador' | 'publicado'
export interface InformeMensual {
  id: string
  company_id: string
  project_id: string
  periodo: string
  total_cuotas: number
  cuotas_pagadas: number
  cuotas_morosas: number
  total_recaudado: number
  total_gastos: number
  num_tickets: number
  tickets_resueltos: number
  num_visitantes: number
  num_incidentes: number
  notas?: string | null
  firmado_por?: string | null
  estado: EstadoInformeMensual
  created_at: string
}

export type CategoriaSugerencia = 'instalaciones' | 'seguridad' | 'servicios' | 'convivencia' | 'otro'
export type EstadoSugerencia = 'pendiente' | 'en_revision' | 'respondida' | 'archivada'
export interface SugerenciaCondominio {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  categoria: CategoriaSugerencia
  titulo: string
  descripcion: string
  estado: EstadoSugerencia
  respuesta?: string | null
  respondido_por?: string | null
  fecha_respuesta?: string | null
  anonima: boolean
  created_at: string
  unidad_nombre?: string
}

// ── Fase 32 ────────────────────────────────────────────────────────────────────
export type CategoriaVencimiento = 'contrato' | 'permiso' | 'certificacion' | 'seguro' | 'otro'
export interface VencimientoExtra {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  categoria: CategoriaVencimiento
  fecha_vencimiento: string
  entidad?: string | null
  monto?: number | null
  alerta_dias: number
  renovado: boolean
  notas?: string | null
  created_at: string
}

export type EstadoCapacitacion = 'planificado' | 'en_progreso' | 'completado' | 'vencido'
export interface CapacitacionPersonal {
  id: string
  company_id: string
  project_id: string
  personal_id?: string | null
  nombre_empleado: string
  cargo?: string | null
  curso: string
  proveedor?: string | null
  fecha_inicio: string
  fecha_fin?: string | null
  fecha_vencimiento_cert?: string | null
  costo?: number | null
  estado: EstadoCapacitacion
  notas?: string | null
  created_at: string
}

export type CategoriaProyectoCond = 'mejora' | 'mantenimiento' | 'seguridad' | 'tecnologia' | 'otro'
export type EstadoProyectoCond = 'planificado' | 'en_progreso' | 'pausado' | 'completado' | 'cancelado'
export interface ProyectoCondominio {
  id: string
  company_id: string
  project_id: string
  nombre: string
  descripcion?: string | null
  categoria: CategoriaProyectoCond
  estado: EstadoProyectoCond
  responsable?: string | null
  fecha_inicio?: string | null
  fecha_fin_estimada?: string | null
  fecha_fin_real?: string | null
  porcentaje_avance: number
  presupuesto?: number | null
  costo_real?: number | null
  notas?: string | null
  created_at: string
}

export type SeccionManual = 'amenidades' | 'normas' | 'faq' | 'contactos' | 'otro'
export interface ArticuloManual {
  id: string
  company_id: string
  project_id: string
  seccion: SeccionManual
  titulo: string
  contenido: string
  orden: number
  activo: boolean
  created_at: string
}

export type TriggerTipoAuto = 'cuota_vencida_dias' | 'ticket_sin_resolver_dias' | 'vencimiento_critico_dias' | 'cert_personal_vence_dias'
export type AccionTipoAuto = 'notificacion_interna' | 'crear_alerta' | 'marcar_moroso'
export interface AutomatizacionCond {
  id: string
  company_id: string
  project_id: string
  nombre: string
  trigger_tipo: TriggerTipoAuto
  trigger_valor: number
  accion_tipo: AccionTipoAuto
  accion_config: Record<string, unknown>
  activa: boolean
  ultima_ejecucion?: string | null
  notas?: string | null
  created_at: string
}

export type CanalPlantilla = 'whatsapp' | 'email' | 'sms'
export interface PlantillaMensajeCond {
  id: string
  company_id: string
  project_id: string
  nombre: string
  canal: CanalPlantilla
  asunto?: string | null
  cuerpo: string
  variables: string[]
  activa: boolean
  created_at: string
}

export type TipoFlujoAprobacion = 'gasto_mayor' | 'propuesta' | 'permiso_obra' | 'mudanza' | 'otro'
export type EstadoFlujoAprobacion = 'pendiente' | 'aprobado' | 'rechazado'
export interface FlujoAprobacionCond {
  id: string
  company_id: string
  project_id: string
  tipo: TipoFlujoAprobacion
  titulo: string
  descripcion?: string | null
  monto?: number | null
  solicitado_por?: string | null
  aprobado_por?: string | null
  estado: EstadoFlujoAprobacion
  fecha_solicitud: string
  fecha_resolucion?: string | null
  comentario_resolucion?: string | null
  created_at: string
}

// ── Fase 36 ───────────────────────────────────────────────────────────────────
export interface GeneracionCuotasLog {
  id: string
  company_id: string
  project_id: string
  periodo: string
  concepto: string
  monto_unitario: number
  fecha_vencimiento: string
  unidades_generadas: number
  created_at: string
}

// ── Fase 37 ───────────────────────────────────────────────────────────────────
export type EstadoOrdenCompra = 'borrador' | 'aprobada' | 'emitida' | 'recibida' | 'cancelada'
export interface OrdenCompra {
  id: string
  company_id: string
  project_id: string
  correlativo: number
  proveedor_nombre: string
  concepto: string
  descripcion?: string | null
  monto_estimado?: number | null
  monto_real?: number | null
  fecha_entrega_esperada?: string | null
  estado: EstadoOrdenCompra
  notas?: string | null
  created_by?: string | null
  created_at: string
}

export interface AsambleaDigital {
  id: string
  company_id: string
  project_id: string
  titulo: string
  descripcion?: string | null
  fecha_hora: string
  modalidad: 'presencial' | 'virtual' | 'hibrida'
  link_reunion?: string | null
  quorum_requerido: number
  estado: 'programada' | 'en_curso' | 'finalizada' | 'cancelada'
  acta_url?: string | null
  created_by?: string | null
  created_at: string
}

export interface PuntoAsamblea2 {
  id: string
  asamblea_id: string
  orden: number
  titulo: string
  descripcion?: string | null
  tipo: 'informativo' | 'aprobacion' | 'eleccion'
  resultado?: string | null
  votos_favor: number
  votos_contra: number
  votos_abstencion: number
}

// ── Fase 38 ───────────────────────────────────────────────────────────────────
export type EstadoProforma = 'borrador' | 'enviada' | 'aprobada' | 'convertida_oc' | 'rechazada'
export interface Proforma {
  id: string
  company_id: string
  project_id: string
  proveedor_nombre: string
  concepto: string
  descripcion?: string | null
  monto?: number | null
  fecha_validez?: string | null
  estado: EstadoProforma
  notas?: string | null
  created_at: string
}

// ── Fase 39 ───────────────────────────────────────────────────────────────────
export interface ConciliacionCobrosLog {
  id: string
  company_id: string
  project_id: string
  cuota_id: string
  unidad_id: string
  monto_cuota: number
  monto_recibido: number
  diferencia: number
  referencia_pago?: string | null
  fecha_pago: string
  metodo_pago: string
  notas?: string | null
  estado: 'conciliado' | 'diferencia'
  created_at: string
}

// ── Fase 43 ───────────────────────────────────────────────────────────────────
export interface FondoReservaMovimiento {
  id: string
  company_id: string
  project_id: string
  tipo: 'aportacion' | 'retiro' | 'rendimiento' | 'ajuste'
  concepto: string
  monto: number
  fecha: string
  referencia?: string | null
  notas?: string | null
  created_at: string
}

export interface ConfigCondominio {
  id: string
  company_id: string
  project_id: string
  cuota_base?: number | null
  dias_gracia: number
  tasa_mora_mensual: number
  metodos_pago: string[]
  nombre_administrador?: string | null
  telefono_admin?: string | null
  email_admin?: string | null
  reglamento_url?: string | null
  notif_dias_antes_vencimiento: number
  permitir_reservas_online: boolean
  max_reservas_por_unidad_mes: number
  created_at: string
  updated_at: string
}
