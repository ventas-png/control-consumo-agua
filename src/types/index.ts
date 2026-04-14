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
  | 'comunicacion';

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
