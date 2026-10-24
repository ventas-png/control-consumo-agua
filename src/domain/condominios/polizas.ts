import { diasHastaFechaCalendario } from '../../lib/format'
import type { PolizaSeguro } from '../../types'

/** Con menos de estos días para vencer, una póliza vigente está «por vencer». */
export const DIAS_AVISO_POLIZA = 60

export type SituacionPoliza = 'vigente' | 'por_vencer' | 'vencida' | 'cancelada'

/**
 * En qué situación está una póliza hoy. La fecha manda sobre el estado
 * guardado: una póliza marcada «vigente» cuyo vencimiento ya pasó está
 * vencida, igual que la cuenta el Panel general. Antes la pestaña de Seguros
 * la seguía mostrando —y sumando a la prima— como vigente.
 */
export function situacionPoliza(
  p: Pick<PolizaSeguro, 'estado' | 'fecha_vencimiento'>,
  referencia: Date = new Date(),
): SituacionPoliza {
  if (p.estado === 'cancelada') return 'cancelada'
  const dias = diasHastaFechaCalendario(p.fecha_vencimiento, referencia)
  if (p.estado === 'vencida' || (dias !== null && dias < 0)) return 'vencida'
  if (dias !== null && dias < DIAS_AVISO_POLIZA) return 'por_vencer'
  return 'vigente'
}

/** Sigue marcada «vigente» aunque ya venció: hay que renovarla o marcarla vencida. */
export function vencidaSinMarcar(p: Pick<PolizaSeguro, 'estado' | 'fecha_vencimiento'>, referencia: Date = new Date()): boolean {
  return p.estado === 'vigente' && situacionPoliza(p, referencia) === 'vencida'
}

/** «vence en 5 días», «vence hoy», «venció hace 3 días». Días de calendario locales. */
export function plazoPoliza(dias: number): string {
  if (dias < 0) return `venció hace ${-dias} día${dias === -1 ? '' : 's'}`
  if (dias === 0) return 'vence hoy'
  return `vence en ${dias} día${dias === 1 ? '' : 's'}`
}
