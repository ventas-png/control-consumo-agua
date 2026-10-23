// Tipos del módulo Condominios — sub-dominio: gobernanza.
// Particionado de types/condominios.ts (auditoría P1); el barrel
// ./index.ts re-exporta todo, así que la superficie pública no cambia.

import type { EstadoContrato } from './seguridad'

// ━━ Fase 3: asambleas, proveedores de servicio, agenda ━━
// ── Condominios Fase 3 ────────────────────────────────────────────────────────

export type TipoAsamblea = 'ordinaria' | 'extraordinaria'
export type EstadoAsamblea = 'programada' | 'en_curso' | 'finalizada' | 'cancelada'
export type TipoPunto = 'informativo' | 'votacion' | 'debate'
export type TipoVoto = 'a_favor' | 'en_contra' | 'abstencion'
/** Regla con que se decide un punto de votación (20261106000200). */
export type TipoMayoria = 'simple' | 'absoluta' | 'calificada'
/** Cuánto vale cada unidad: 1, o su alícuota (configuración del condominio). */
export type BaseVotacion = 'unidad' | 'alicuota'
export type ModalidadAsistencia = 'presencial' | 'virtual' | 'poder'
export type DecisionPunto = 'aprobado' | 'rechazado' | 'sin_quorum'
export type ModalidadAsamblea = 'presencial' | 'virtual' | 'hibrida'
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
  /** 20261106000300: presencial | virtual | hibrida (antes, la «asamblea digital»). */
  modalidad?: ModalidadAsamblea
  /** Sólo http/https (CHECK asambleas_link_reunion_check). */
  link_reunion?: string | null
  descripcion?: string | null
  estado: EstadoAsamblea
  quorum_requerido: number
  /** Lo escribe la base al finalizar (escrutinio). */
  quorum_alcanzado?: number | null
  /** La base que rige la asamblea, fijada al abrirla; null mientras está programada. */
  base_votacion?: BaseVotacion | null
  /** Escrito por la base al finalizar; null antes (y en las finalizadas de antes del escrutinio). */
  escrutinio?: EscrutinioAsamblea | null
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
  /** 'Aprobado' | 'Rechazado' | 'Sin quórum' en los de votación, al finalizar. */
  resultado?: string
  mayoria?: TipoMayoria
  /** Sólo en la calificada: porcentaje del padrón (50 < x ≤ 100). */
  mayoria_pct?: number | null
  created_at: string
  votos?: VotoAsamblea[]
}

/** Unidad con derecho a voto en una asamblea, tomada al abrirla. */
export interface PadronAsamblea {
  asamblea_id: string
  unidad_id: string
  unidad_nombre: string
  /** 1 por unidad; por alícuota, su porcentaje. */
  peso: number
}

export interface AsistenciaAsamblea {
  id: string
  asamblea_id: string
  unidad_id: string
  modalidad: ModalidadAsistencia
  /** Sólo por poder: quién representa a la unidad y el path del documento. */
  apoderado_nombre: string | null
  poder_documento: string | null
  registrado_por: string | null
  created_at: string
}

export interface ConteoEscrutinio { unidades: number; peso: number }

export interface EscrutinioPunto {
  punto_id: string
  titulo: string
  mayoria: TipoMayoria
  mayoria_pct: number | null
  a_favor: ConteoEscrutinio
  en_contra: ConteoEscrutinio
  abstencion: ConteoEscrutinio
  decision: DecisionPunto
}

/** asambleas_calcular_escrutinio(): presente = asistió o votó; sólo cuenta el padrón. */
export interface EscrutinioAsamblea {
  base: BaseVotacion | null
  padron: ConteoEscrutinio
  presentes: ConteoEscrutinio
  quorum_pct: number
  quorum_requerido: number
  hay_quorum: boolean
  puntos: EscrutinioPunto[]
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

/** Punto de una asamblea tal como lo proyecta portal_asambleas_unidad(). */
export interface PuntoAsambleaPortal {
  id: string
  orden: number
  titulo: string
  descripcion: string | null
  tipo: TipoPunto
  resultado: string | null
  /** Voto de la unidad consultada (nunca el de otra). */
  mi_voto: TipoVoto | null
  /** Totales del punto; sólo en puntos de votación de asambleas finalizadas. */
  conteo: Record<TipoVoto, number> | null
}

/** Asamblea del condominio de una unidad propia (portal del propietario). */
export interface AsambleaPortal {
  id: string
  titulo: string
  tipo: TipoAsamblea
  fecha: string
  hora_inicio: string
  hora_fin: string | null
  lugar: string | null
  estado: EstadoAsamblea
  quorum_requerido: number
  quorum_alcanzado: number | null
  /** Sólo con la asamblea finalizada. */
  acta: string | null
  puntos: PuntoAsambleaPortal[]
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

