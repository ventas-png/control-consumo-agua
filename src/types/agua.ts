// agua:A6 — Tipos del módulo Agua extraídos de `src/types/index.ts`.
// Segundo paso de la partición por dominio (después de
// `src/types/condominios.ts` con MetodoCalculo/RubroConfig).
//
// El barrel `src/types/index.ts` re-exporta estos tipos para mantener la
// compat con código existente que hace `import { Cliente } from '@/types'`
// o `from '../../types'`. Importar directamente desde `./agua` también
// funciona (preferido en código nuevo).

// ── Cliente ─────────────────────────────────────────────────────────────────
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

// ── GPS (geolocalización compartida) ────────────────────────────────────────
export interface GPS {
  lat: number;
  lng: number;
}

// ── Registro de lectura/facturación ─────────────────────────────────────────
export interface Registro {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  contador_id?: string | null;
  project_id?: string | null;
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
  /**
   * Trazabilidad (migración 20260731000000): usuario que capturó la lectura.
   * Lo sella la BD y es inmutable. `null` = escritura de sistema; ausente en
   * las lecturas anteriores a la migración.
   */
  creado_por?: string | null;
}

// ── Calidad de agua ─────────────────────────────────────────────────────────
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
  // serv:S26 — días entre muestreos esperados de calidad (null = sin programa).
  frecuencia_muestreo_dias?: number | null;
}

export interface RegistroCalidad {
  id: string;
  fuente_id: string;
  fecha: string;
  parametros: Record<string, number>;
  cumplimiento: Record<string, boolean | null>;
  cumple_total: boolean;
  observaciones?: string;
  // serv:S24 — nuevo: ruta en Storage (calidad-reportes bucket). Null = registro
  // previo que aún tiene base64.
  reporte_path?: string | null;
  // Campos legacy (base64). Permanecen para registros anteriores a S24.
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

// ── Rutas de lectura ────────────────────────────────────────────────────────
export type FrecuenciaRuta = 'unica' | 'diaria' | 'semanal' | 'quincenal' | 'mensual' | 'fechas';

export interface Ruta {
  id: string;
  nombre: string;
  descripcion?: string;
  tipo_ruta: 'clientes' | 'contadores' | 'unidades';
  project_id?: string | null;
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
  // Periodicidad
  frecuencia?: FrecuenciaRuta;
  dias_semana?: number[];          // ISO 1=lunes .. 7=domingo (para 'semanal')
  intervalo_dias?: number | null;  // para 'quincenal'/personalizado
  dia_mes?: number | null;         // para 'mensual'
  fechas_especificas?: string[];   // ['YYYY-MM-DD', ...] (para 'fechas')
  hora_programada?: string | null; // 'HH:MM' u 'HH:MM:SS' local GT
  recurrencia_activa?: boolean;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  recordatorio_anticipacion_min?: number; // minutos antes (1440 = 1 día)
  recordatorio_canales?: string[];        // ['email','app']
}

export interface RutaOcurrencia {
  id: string;
  ruta_id: string;
  company_id?: string | null;
  project_id?: string | null;
  fecha: string; // 'YYYY-MM-DD'
  hora?: string | null;
  estado: 'pendiente' | 'completada' | 'vencida' | 'omitida';
  completada_at?: string | null;
  recordatorio_enviado: boolean;
  recordatorio_enviado_at?: string | null;
  created_at: string;
}

// ── Tarifa de agua ──────────────────────────────────────────────────────────
/**
 * Bloque de una tarifa ESCALONADA (increasing-block tariff). El consumo se cobra
 * por bloques: cada m³ dentro de `(desde_m3, hasta_m3]` se cobra a `precio_m3`.
 * Los bloques deben ser contiguos desde 0 y el último tener `hasta_m3 = null` (∞).
 */
export interface TarifaTramo {
  /** Límite inferior del bloque en m³. */
  desde_m3: number;
  /** Límite superior en m³; `null` = sin tope (último bloque). */
  hasta_m3: number | null;
  /** Precio por m³ dentro del bloque. */
  precio_m3: number;
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
  /**
   * Tarifa escalonada opcional. Si tiene ≥1 bloque, ANULA el modelo plano
   * (precio_m3 / precio_m3_exceso / derecho de servicio) y el cobro se calcula por
   * bloques. `consumo_minimo` + `canon_fijo` siguen aplicando como piso mínimo.
   */
  tramos?: TarifaTramo[] | null;
  activa: boolean;
  fecha_revision?: string | null;
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
  updated_by_name?: string | null;
}

// ── Contador (medidor físico) ───────────────────────────────────────────────
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
