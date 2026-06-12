// agua:A6 / plat — Tipos de la plataforma: usuarios/roles/permisos, proyectos,
// unidades, mensajes del portal, notificaciones in-app, AppSection.
// Extraído del monolito `src/types/index.ts`. El barrel re-exporta para
// preservar imports existentes (`from '@/types'`).

export interface Empresa {
  id?: string;
  nombre?: string;
  // serv:S16 — centro/zoom por defecto del mapa por tenant (null = default app).
  center_lat?: number | null;
  center_lng?: number | null;
  zoom_default?: number | null;
}

export type UserRole = 'admin' | 'super_admin' | 'company_owner' | 'operator' | 'viewer' | 'cliente' | 'collector';

export type AguaRole = 'admin' | 'operator' | 'collector' | 'viewer'

export type CondominiosRole =
  | 'administrador_general'
  | 'junta_directiva'
  | 'finanzas'
  | 'operaciones'
  | 'seguridad'
  | 'comunidad'
  | 'recepcion'
  | 'visualizador'

export interface AssignedRoleInfo {
  id: string;
  name: string;
  service: 'condominios' | 'agua' | 'general' | null;
  color: string | null;
}

export interface UserSession {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  company_id?: string;
  cliente_id?: string;
  login_time: string;
  expires_at: string;
  servicio_agua?: boolean;
  servicio_condominios?: boolean;
  // RBAC: effective permission keys for this user (e.g. 'condominios.tab.cuotas')
  permissions?: Set<string>;
  // RBAC: assigned role IDs (system + custom)
  assigned_role_ids?: string[];
  // RBAC: assigned role objects with display metadata (name, service, color)
  // Used to render the user's effective role label in the UI when a project-
  // scoped role (condominios/agua) is more meaningful than the platform role.
  assigned_roles?: AssignedRoleInfo[];
}

// ─── RBAC types ──────────────────────────────────────────────────────────────

export interface PermissionDef {
  key: string;
  category: string;
  label: string;
  description?: string;
}

export interface RoleDef {
  id: string;
  company_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  color: string;
  service?: string | null;
  // Plantilla de la que nació esta copia de empresa (linaje). null/ausente en
  // roles del sistema y en roles personalizados creados desde cero.
  cloned_from_role_id?: string | null;
}

export interface RoleWithPermissions extends RoleDef {
  permission_keys: string[];
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
  // Portal del residente
  token_portal?: string | null;
  portal_activo?: boolean;
  // Alícuota de participación en gastos comunes (0-100)
  alicuota_pct?: number | null;
}

export type TipoMensajePortal = 'consulta' | 'queja' | 'sugerencia' | 'emergencia'
export type EstadoMensajePortal = 'nuevo' | 'leido' | 'respondido' | 'cerrado'

// Notificaciones in-app cross-cutting (rutas, paquetes, comunicaciones, etc.).
// Vive en index.ts por ser shared entre todos los dominios.
export interface UserNotification {
  id: string;
  user_id: string;
  company_id?: string | null;
  tipo: string;
  titulo: string;
  cuerpo?: string | null;
  seccion?: string | null;
  ruta_id?: string | null;
  ocurrencia_id?: string | null;
  paquete_id?: string | null;
  leido: boolean;
  leido_at?: string | null;
  created_at: string;
}

export interface MensajePortal {
  id: string
  company_id: string
  project_id: string
  unidad_id: string
  asunto: string
  cuerpo: string
  tipo: TipoMensajePortal
  estado: EstadoMensajePortal
  respuesta?: string | null
  respondido_en?: string | null
  created_at: string
  // joins
  unidad_nombre?: string
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
  company_id: string
  logo_url: string | null
  descripcion: string | null
  direccion: string | null
  latitud: number | null
  longitud: number | null
  moneda: string
  moneda_condominios: string | null
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
  | 'condominios'
  | 'condominios_dashboard'
  | 'condominios_visitantes'
  | 'condominios_cuotas'
  | 'condominios_mantenimiento'
  | 'paquetes'
  | 'contabilidad';
