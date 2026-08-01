// Tipos del módulo Condominios — sub-dominio: core.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

import type { TipoResidente } from './operaciones'

// ━━ base del módulo (rubros, cuotas, visitantes, amenidades, reservas) ━━
export type MetodoCalculo = 'fijo' | 'por_m2' | 'alicuota'

export interface RubroConfig {
  nombre: string
  metodo: MetodoCalculo
  valor: number        // fijo: monto total; por_m2: precio/m²; alicuota: monto total del gasto
  notas?: string
}

export interface RubroDetalle extends RubroConfig {
  monto_calculado: number
}

// ── Módulo Condominios ────────────────────────────────────────────────────────

// Tipos compartidos por la UI de cuotas. Re-exportados desde el archivo
// dedicado del dominio (cond:C9 — partición progresiva de este monolito).

export type ConceptoCuota = 'mantenimiento' | 'extraordinaria' | 'CAM' | 'amenidad' | 'otro'
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
  /**
   * Rol del residente responsable del cargo (mismo dominio que
   * `unidad_residentes.tipo`). NULL/undefined = sin diferenciar
   * (responsabilidad de la unidad). Informativo: no altera la RLS del portal.
   */
  rol_responsable?: TipoResidente | null
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
  // Desglose de rubros calculados para esta cuota
  rubros_detalle?: RubroDetalle[] | null
}

export interface HuespedSTR {
  id: string
  reserva_str_id: string
  nombre: string
  identificacion?: string | null
  es_menor: boolean
  fecha_nacimiento?: string | null
  foto_url?: string | null
  foto_documento_url?: string | null
  visitante_id?: string | null
  created_at: string
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
  foto_documento_url?: string | null
  foto_vehiculo_url?: string | null
  registrado_por?: string | null
  notas?: string | null
  qr_token?: string | null
  valido_hasta?: string | null
  created_at: string
  es_menor?: boolean
  fecha_nacimiento?: string | null
  visitante_principal_id?: string | null
  reserva_str_id?: string | null
  solicitud_mudanza_id?: string | null
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
  requiere_tarifa: boolean
  tarifa_uso?: number | null
  tarifa_uso_finde?: number | null
  max_reservas_mes_unidad?: number | null
  horas_minimas_antelacion?: number | null
  duracion_max_horas?: number | null
  minutos_preparacion_previa?: number | null
  minutos_preparacion_posterior?: number | null
  requiere_aprobacion: boolean
  reglamento?: string | null
  activo: boolean
  foto_url?: string | null
  created_at: string
}

export type EstadoReserva = 'confirmada' | 'cancelada' | 'pendiente'
export type MetodoPagoTarifa = 'cargar_unidad' | 'pagar_momento'
export type EstadoDepositoReserva = 'no_aplica' | 'pendiente' | 'cobrado' | 'devuelto' | 'retenido'

export type MotivoBloqueoAmenidad = 'mantenimiento' | 'limpieza' | 'evento_privado' | 'reparacion' | 'otro'

export interface BloqueoAmenidad {
  id: string
  company_id: string
  project_id: string
  amenidad_id: string
  fecha_inicio: string         // 'YYYY-MM-DD'
  fecha_fin: string            // 'YYYY-MM-DD'
  hora_inicio?: string | null  // 'HH:MM' — null = día completo
  hora_fin?: string | null
  motivo: MotivoBloqueoAmenidad
  notas?: string | null
  created_by?: string | null
  created_at: string
  // joins opcionales
  amenidad_nombre?: string
}

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
  monto_tarifa?: number | null
  metodo_pago_tarifa?: MetodoPagoTarifa | null
  tarifa_pagada: boolean
  cuota_id?: string | null
  recordatorio_enviado: boolean
  recordatorio_enviado_at?: string | null
  no_show: boolean
  checkin_at?: string | null
  checkin_foto_url?: string | null
  checkin_por?: string | null
  checkout_at?: string | null
  checkout_foto_url?: string | null
  checkout_por?: string | null
  observaciones_uso?: string | null
  deposito_estado: EstadoDepositoReserva
  deposito_devuelto_at?: string | null
  deposito_retenido_monto?: number | null
  deposito_retenido_motivo?: string | null
  cuota_retencion_id?: string | null
  reglamento_aceptado_at?: string | null
  aprobada_por?: string | null
  aprobada_at?: string | null
  rechazada_motivo?: string | null
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
  /** Paths de documentos adjuntos (PDF/Word/Excel) en `condominios-media`. */
  archivo_urls: string[]
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

