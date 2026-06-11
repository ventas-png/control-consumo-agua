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

