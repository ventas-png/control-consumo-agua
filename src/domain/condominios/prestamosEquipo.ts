// domain/condominios/prestamosEquipo.ts — Entrega y recepción de equipo
// prestado, y equipo que el panel agrega a una reserva (20261108000000).
//
// SON RPC Y NO UPDATES SUELTOS por tres razones: varias filas cierran en una
// transacción (el check-out recibe todo el equipo de la reserva de una vez),
// la fecha y la hora las sella el servidor, y la autorización contempla a
// quien hace el check-in/check-out de la reserva (`amenidades.edit`) aunque
// no administre el tab de préstamos (`prestamos.edit`) — un UPDATE directo
// moriría en la policy. Mismo shape de error `{ message }` que tabMutations.
import { db } from '../../lib/supabase'
import type { Json } from '../../types/database.types'
import type { RowError } from './tabMutations'
import type { EstadoPrestamo, SolicitudEquipoReserva } from '../../types'

/** Una línea de entrega: `cantidad` NULL = la pedida; 0 = no se entregó (la solicitud se cancela). */
export interface EntregaPrestamo {
  id: string
  cantidad?: number | null
}

/** Una línea de recepción. Sin `estado` el servidor propone devuelto/perdido; sin `monto_reposicion`, faltantes × costo congelado. */
export interface RecepcionPrestamo {
  id: string
  cantidad_devuelta: number
  estado?: Extract<EstadoPrestamo, 'devuelto' | 'dañado' | 'perdido'>
  monto_reposicion?: number | null
  observaciones?: string | null
}

export interface ResultadoEntrega { entregados: number; cancelados: number }
/** Lo que devuelve reserva_equipos_solicitar: cuántas líneas, la renta de lo agregado y la cuota si se pidió cargarla. */
export interface ResultadoSolicitud { equipos_solicitados: number; monto_renta?: number; cuota_id?: string | null }
export interface ResultadoRecepcion { recibidos: number; monto_reposicion: number; cuota_id: string | null }

/** Los arreglos de objetos viajan como Json de PostgREST. */
const comoJson = (v: unknown) => v as Json

/**
 * La administración agrega equipo a una reserva pendiente o confirmada (sin
 * check-out). Con `generarCargo`, la renta de lo agregado se cobra en UNA
 * cuota 'amenidad' a la unidad (20261118000000).
 */
export async function solicitarEquiposReserva(
  reservaId: string,
  equipos: SolicitudEquipoReserva[],
  generarCargo = false,
): Promise<{ data: ResultadoSolicitud | null; error: RowError }> {
  const { data, error } = await db.rpc('reserva_equipos_solicitar', {
    p_reserva_id: reservaId,
    p_equipos: comoJson(equipos),
    p_generar_cargo: generarCargo,
  })
  return { data: (data as ResultadoSolicitud | null) ?? null, error }
}

/** Entrega préstamos 'solicitado': quedan 'prestado' con fecha, hora y quién entregó. */
export async function entregarPrestamos(
  entregas: EntregaPrestamo[],
  entregadoPor?: string | null,
  observaciones?: string | null,
): Promise<{ data: ResultadoEntrega | null; error: RowError }> {
  const { data, error } = await db.rpc('prestamos_equipo_entregar', {
    p_entregas: comoJson(entregas),
    p_entregado_por: entregadoPor || undefined,
    p_observaciones: observaciones || undefined,
  })
  return { data: (data as ResultadoEntrega | null) ?? null, error }
}

/**
 * Recibe préstamos 'prestado': cierra en devuelto/dañado/perdido, calcula la
 * reposición y, con `generarCargo`, crea UNA cuota a la unidad por el total.
 */
export async function recibirPrestamos(
  recepciones: RecepcionPrestamo[],
  recibidoPor?: string | null,
  generarCargo = false,
): Promise<{ data: ResultadoRecepcion | null; error: RowError }> {
  const { data, error } = await db.rpc('prestamos_equipo_recibir', {
    p_recepciones: comoJson(recepciones),
    p_recibido_por: recibidoPor || undefined,
    p_generar_cargo: generarCargo,
  })
  return { data: (data as ResultadoRecepcion | null) ?? null, error }
}
