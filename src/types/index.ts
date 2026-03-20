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
  lectura_inicial: number;
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

export type UserRole = 'admin' | 'super_admin' | 'operator' | 'viewer';

export interface UserSession {
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  login_time: string;
  expires_at: string;
}

export type AppSection =
  | 'clientes'
  | 'lecturas'
  | 'tabla'
  | 'dashboard'
  | 'mapa'
  | 'calidad'
  | 'configuracion'
  | 'perfil';

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
