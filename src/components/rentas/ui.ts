import type { CSSProperties } from 'react'
import type { Tone } from '../shared/statusTone'
import type { EstadoArticuloRenta, EstadoContratoRenta, EstadoReservaRenta } from '../../types'
import type { Ocupacion } from '../../domain/rentas/logica'

// Estilos y tonos compartidos por las pestañas de Manejo de Rentas. Los
// estilos de formulario son los mismos de Servicio Energético.
export { encabezadoTab, etiqueta, campo, rejilla, accionesFila } from '../servicios-energia/ui'

export const th: CSSProperties = { padding: '0.75rem', textAlign: 'left', whiteSpace: 'nowrap' }
export const td: CSSProperties = { padding: '0.75rem', verticalAlign: 'top' }
export const thead: CSSProperties = { backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }
export const fila: CSSProperties = { borderBottom: '1px solid var(--at-chip)' }
export const tenue: CSSProperties = { color: 'var(--at-ink-3)', fontSize: '12px' }
export const barraFiltros: CSSProperties = {
  display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem',
}
export const rejillaTiles: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '0.75rem', marginBottom: '1.25rem',
}

export const TONO_OCUPACION: Record<Ocupacion, Tone> = {
  ocupada: 'info', disponible: 'success', mantenimiento: 'warning', inactiva: 'neutral',
}
export const TONO_RESERVA: Record<EstadoReservaRenta, Tone> = {
  confirmada: 'info', en_curso: 'warning', completada: 'success', cancelada: 'danger',
}
export const TONO_CONTRATO: Record<EstadoContratoRenta, Tone> = {
  vigente: 'success', finalizado: 'neutral', cancelado: 'danger',
}
export const TONO_ARTICULO: Record<EstadoArticuloRenta, Tone> = {
  bueno: 'success', regular: 'warning', danado: 'danger', faltante: 'danger',
}
