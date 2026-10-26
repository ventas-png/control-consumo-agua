// Reglas puras del préstamo de equipo ligado al inventario (20261108000000).
// Espejo en el cliente de lo que la base impone en `prestamo_equipo_disponible`
// y en `prestamos_equipo_recibir`: la pantalla las usa para avisar antes de
// escribir y para pintar resúmenes; la decisión final siempre es del servidor.
import type { AmenidadInventario, EstadoPrestamo, ItemInventario, PrestamoEquipo } from '../types'

export const ESTADO_PRESTAMO_LABEL: Record<EstadoPrestamo, string> = {
  solicitado: 'Solicitado',
  prestado: 'Prestado',
  devuelto: 'Devuelto',
  dañado: 'Dañado',
  perdido: 'Perdido',
  cancelado: 'Cancelado',
}

/** Estados con los que el préstamo todavía compromete inventario. */
export function prestamoAbierto(p: Pick<PrestamoEquipo, 'estado'>): boolean {
  return p.estado === 'solicitado' || p.estado === 'prestado'
}

/** Estados en los que el equipo ya se recibió (o se dio por perdido). */
export function prestamoCerrado(p: Pick<PrestamoEquipo, 'estado'>): boolean {
  return p.estado === 'devuelto' || p.estado === 'dañado' || p.estado === 'perdido'
}

/**
 * Unidades de `item` que se pueden prestar para `fecha`: la cantidad del
 * inventario (0 si está de baja o en reparación) menos lo que está prestado
 * —en circulación, sea de la fecha que sea— y lo ya solicitado para esa misma
 * fecha. `excluirId` deja fuera el préstamo que se está editando.
 */
export function disponibilidadEquipo(
  item: ItemInventario,
  prestamos: PrestamoEquipo[],
  fecha: string,
  excluirId?: string | null,
): number {
  if (item.estado === 'dado_de_baja' || item.estado === 'en_reparacion') return 0
  const comprometido = prestamos.reduce((s, p) => {
    if (p.inventario_id !== item.id) return s
    if (excluirId && p.id === excluirId) return s
    if (p.estado === 'prestado') return s + p.cantidad
    if (p.estado === 'solicitado' && p.fecha_prestamo === fecha) return s + p.cantidad
    return s
  }, 0)
  return item.cantidad - comprometido
}

/** Unidades de un equipo del inventario que hoy están fuera (prestadas). */
export function enCirculacion(inventarioId: string, prestamos: PrestamoEquipo[]): number {
  return prestamos.reduce((s, p) => (p.inventario_id === inventarioId && p.estado === 'prestado' ? s + p.cantidad : s), 0)
}

/** Cuánto se puede pedir de un equipo en una reserva: el tope configurado, si lo hay, nunca por encima de lo disponible. */
export function topePorReserva(link: Pick<AmenidadInventario, 'cantidad_max_por_reserva'>, disponible: number): number {
  const disp = Math.max(0, disponible)
  return link.cantidad_max_por_reserva != null ? Math.min(link.cantidad_max_por_reserva, disp) : disp
}

/** Unidades que no volvieron de un préstamo ya cerrado (0 mientras siga abierto). */
export function faltantes(p: Pick<PrestamoEquipo, 'estado' | 'cantidad' | 'cantidad_devuelta'>): number {
  if (!prestamoCerrado(p)) return 0
  return Math.max(0, p.cantidad - (p.cantidad_devuelta ?? p.cantidad))
}

/** Reposición que propone el sistema al recibir: faltantes × costo congelado al prestar. */
export function montoReposicionSugerido(cantidad: number, devuelta: number, costoUnitario: number | null | undefined): number {
  const falt = Math.max(0, cantidad - Math.max(0, devuelta))
  return Math.round(falt * Number(costoUnitario ?? 0) * 100) / 100
}

/** Estado de cierre que propone el sistema: todo volvió ⇒ devuelto; faltó algo ⇒ perdido (la administración puede marcar dañado). */
export function estadoRecepcionSugerido(cantidad: number, devuelta: number): Extract<EstadoPrestamo, 'devuelto' | 'perdido'> {
  return devuelta < cantidad ? 'perdido' : 'devuelto'
}

export interface ResumenEquiposReserva {
  total: number
  solicitados: number
  prestados: number
  cerrados: number
  cancelados: number
  /** Suma de la reposición de los préstamos cerrados. */
  reposicion: number
  /** Reposición que todavía no tiene cuota generada. */
  reposicionSinCargo: number
  /** Hay equipo pedido que aún no se entrega. */
  pendienteEntrega: boolean
  /** Hay equipo entregado que aún no se recibe. */
  pendienteRecepcion: boolean
}

/** Resumen del equipo de una reserva (o de cualquier lista de préstamos). */
export function resumenEquiposReserva(prestamos: PrestamoEquipo[]): ResumenEquiposReserva {
  const r: ResumenEquiposReserva = {
    total: prestamos.length, solicitados: 0, prestados: 0, cerrados: 0, cancelados: 0,
    reposicion: 0, reposicionSinCargo: 0, pendienteEntrega: false, pendienteRecepcion: false,
  }
  for (const p of prestamos) {
    if (p.estado === 'solicitado') r.solicitados++
    else if (p.estado === 'prestado') r.prestados++
    else if (p.estado === 'cancelado') r.cancelados++
    else {
      r.cerrados++
      const monto = Number(p.monto_reposicion ?? 0)
      r.reposicion += monto
      if (!p.cuota_reposicion_id) r.reposicionSinCargo += monto
    }
  }
  r.reposicion = Math.round(r.reposicion * 100) / 100
  r.reposicionSinCargo = Math.round(r.reposicionSinCargo * 100) / 100
  r.pendienteEntrega = r.solicitados > 0
  r.pendienteRecepcion = r.prestados > 0
  return r
}

/** Préstamos que cuelgan de una reserva. */
export function prestamosDeReserva(reservaId: string, prestamos: PrestamoEquipo[]): PrestamoEquipo[] {
  return prestamos.filter(p => p.reserva_id === reservaId)
}
