// Catálogos y colores del feature Unidades (sin cambios de valores).
import type { CSSProperties } from 'react'
import type { TipoUnidad, TipoRegimen, EstadoOcupacional, ContratoSuministro } from '../../types'

export const TIPOS_UNIDAD: { value: TipoUnidad; label: string; icon: string }[] = [
  { value: 'apartamento',    label: 'Apartamento',     icon: '🏢' },
  { value: 'casa',           label: 'Casa',            icon: '🏠' },
  { value: 'bodega',         label: 'Bodega',          icon: '🏭' },
  { value: 'local_comercial',label: 'Local Comercial', icon: '🏪' },
  { value: 'oficina',        label: 'Oficina',         icon: '🏛️' },
  { value: 'parqueadero',    label: 'Parqueadero',     icon: '🅿️' },
  { value: 'otro',           label: 'Otro',            icon: '📦' },
]

export const TIPOS_REGIMEN: { value: TipoRegimen; label: string }[] = [
  { value: 'no_sujeto',            label: 'No Sujeto' },
  { value: 'urbanizacion',         label: 'Urbanización' },
  { value: 'condominio',           label: 'Condominio' },
  { value: 'propiedad_horizontal', label: 'Propiedad Horizontal' },
  { value: 'otro',                 label: 'Otro' },
]

export const ESTADOS_OCUPACIONALES: { value: EstadoOcupacional; label: string }[] = [
  { value: 'en_construccion',       label: 'En Construcción' },
  { value: 'habitado',              label: 'Habitado' },
  { value: 'en_remodelacion',       label: 'En Remodelación' },
  { value: 'desabitado',            label: 'Deshabitado' },
  { value: 'en_proceso_de_mudanza', label: 'En Proceso de Mudanza' },
  { value: 'desocupada',            label: 'Desocupada' },
  { value: 'disponible_venta',      label: 'Disponible para Venta' },
  { value: 'disponible_renta',      label: 'Disponible para Renta' },
  { value: 'en_mantenimiento',      label: 'En Mantenimiento' },
  { value: 'problemas_legales',     label: 'Problemas Legales' },
  { value: 'activo_extraordinario', label: 'Activo Extraordinario de Entidad Financiera' },
]

export const CONTRATOS_SUMINISTRO: { value: ContratoSuministro; label: string }[] = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' },
]

export const TIPO_AGUA_LABELS: Record<string, string> = {
  potable:             '💧 Potable',
  rehuso:              '♻️ Reúso',
  piscina:             '🏊 Piscina',
  desalinada:          '🌊 Desalinada',
  riego:               '🌱 Riego',
  jacuzzi:             '🛁 Jacuzzi',
  consumo_humano:      '🚰 Consumo Humano',
  desmineralizada:     '🧪 Desmineralizada',
  residuales_tratadas: '🔄 Residuales Tratadas',
}

export const TIPO_COLORES: Record<TipoUnidad, { bg: string; color: string }> = {
  apartamento:     { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  casa:            { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
  bodega:          { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  local_comercial: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  oficina:         { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-darker)' },
  parqueadero:     { bg: 'var(--at-chip)', color: 'var(--at-ink-2)' },
  otro:            { bg: '#fce7f3', color: '#9d174d' },
}


export const inputStyle: CSSProperties = {
  padding: '10px 14px',
  border: '2px solid var(--at-line)',
  borderRadius: '8px',
  fontSize: '14px',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
}
export const labelStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--at-ink-2)',
  marginBottom: '5px',
  display: 'block',
}
