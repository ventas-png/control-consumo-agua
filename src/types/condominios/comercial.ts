// Tipos del módulo Condominios — sub-dominio: comercial.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

// ━━ Fase 7: STR, locales comerciales, housekeeping ━━
// ── Fase 7: STR, Locales Comerciales, Housekeeping ────────────────────────────
export type PlataformaSTR = 'airbnb' | 'booking' | 'vrbo' | 'directo' | 'otro'
export type EstadoSTR = 'confirmada' | 'en_curso' | 'completada' | 'cancelada'
export type PoliticaCancelacionSTR = 'flexible' | 'moderada' | 'estricta' | 'no_reembolsable' | 'na' | 'otra'
export interface ReservaSTR {
  id: string
  company_id: string
  project_id: string
  unidad_id?: string | null
  huesped_nombre: string
  huesped_email?: string | null
  huesped_telefono?: string | null
  codigo_confirmacion?: string | null
  fecha_reservacion?: string | null
  fecha_entrada: string
  fecha_salida: string
  hora_llegada_estimada?: string | null
  hora_salida_estimada?: string | null
  num_adultos: number
  num_ninos: number
  num_bebes: number
  plataforma: PlataformaSTR
  monto_noche?: number | null
  monto_total?: number | null
  estado: EstadoSTR
  politica_cancelacion?: PoliticaCancelacionSTR | null
  mascotas: boolean
  notas?: string | null
  foto_url?: string | null
  foto_documento_url?: string | null
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

