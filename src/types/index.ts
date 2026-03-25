export interface Cliente {
  id: string;
  nombre: string;
  codigo: string;
  medidor: string;
  email?: string;
  direccion?: string;
  telefono?: string;
  tarifa: number;
  canon: number;
  consumo_minimo: number;
  lectura_inicial: number;
  tarifa_id?: string | null;
}

export interface GPS {
  lat: number;
  lng: number;
}

export interface Registro {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  fecha: string;
  lectura_anterior: number;
  lectura_actual: number;
  consumo: number;
  tarifa_aplicada: number;
  canon_aplicado: number;
  monto_calculado: number;
  tipo_cobro: string;
  estado: 'pendiente' | 'pagado' | 'mora';
  mes?: string;
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

export type UserRole = 'admin' | 'super_admin' | 'company_owner' | 'operator' | 'viewer';

export interface UserSession {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  company_id?: string;
  login_time: string;
  expires_at: string;
}

export interface Ruta {
  id: string;
  nombre: string;
  descripcion?: string;
  cliente_ids: string[];
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
  canon_fijo: number;
  consumo_minimo: number;
  activa: boolean;
  fecha_revision?: string | null;
  created_at?: string;
  updated_at?: string;
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
  cliente_id?: string | null;
  tarifa_id?: string | null;
  unidad_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type TipoUnidad =
  | 'apartamento'
  | 'casa'
  | 'bodega'
  | 'local_comercial'
  | 'oficina'
  | 'parqueadero'
  | 'otro';

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
  created_at?: string;
  updated_at?: string;
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
  | 'mapa'
  | 'calidad'
  | 'rutas'
  | 'tarifas'
  | 'unidades'
  | 'contadores'
  | 'configuracion'
  | 'perfil'
  | 'empresa_proyectos'
  | 'superadmin_empresas';

export interface CostoCalculo {
  total: number;
  tipo_cobro: string;
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
