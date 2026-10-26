// domain/portal/reservas.ts — Reservas de amenidades del residente vía RPCs
// atómicos (20260822030000). Toda la validación y el CÁLCULO DE LA TARIFA viven
// en el servidor (SECURITY DEFINER): el cliente solo describe la reserva; el
// monto y el cargo a la unidad (cuota 'amenidad') los sella Postgres en la misma
// transacción. Boundary T7. Desde 20261108000000 la reserva viaja con el equipo
// que el residente quiere que se le entregue (`equipos`), y el catálogo con su
// disponibilidad se consulta por RPC: por RLS el residente sólo ve sus propios
// préstamos, así que no podría calcular cuánto queda.
import { db } from '../../lib/supabase'
import type { Json } from '../../types/database.types'
import type { EquipoAmenidadDisponible, ReservaAmenidad, SolicitudEquipoReserva } from '../../types'

/** Datos que el residente captura para reservar (el monto NO viaja: lo calcula el servidor). */
export interface ReservarAmenidadInput {
  amenidadId: string
  unidadId: string
  fecha: string
  horaInicio: string
  horaFin: string
  numInvitados: number
  notas?: string
  /** Requerido por el servidor solo cuando la amenidad tiene tarifa. */
  metodoPago: 'cargar_unidad' | 'pagar_momento' | null
  reglamentoAceptado: boolean
  /** Equipo enlazado a la amenidad que se pide con la reserva; nace como préstamo 'solicitado' en el mismo commit. */
  equipos?: SolicitudEquipoReserva[]
}

/** La reserva creada, más cuántas líneas de equipo quedaron solicitadas. */
export type ReservaCreada = ReservaAmenidad & { equipos_solicitados?: number }

/**
 * Reserva una amenidad de una unidad propia. El RPC valida reglas, bloqueos y
 * conflicto GLOBAL bajo lock, calcula la tarifa server-side y, si aplica
 * "cargar a la unidad" con reserva confirmada, crea la cuota en la misma
 * transacción. Si se pidió equipo y no alcanza, la reserva entera se rechaza.
 * Devuelve la reserva creada (con monto_tarifa del servidor).
 */
export async function reservarAmenidad(
  input: ReservarAmenidadInput,
): Promise<{ data: ReservaCreada | null; error: string | null }> {
  const equipos = (input.equipos ?? []).filter(e => e.cantidad > 0)
  const { data, error } = await db.rpc('portal_reservar_amenidad', {
    p_amenidad_id: input.amenidadId,
    p_unidad_id: input.unidadId,
    p_fecha: input.fecha,
    p_hora_inicio: input.horaInicio,
    p_hora_fin: input.horaFin,
    p_num_invitados: input.numInvitados,
    p_notas: input.notas ?? undefined,
    p_metodo_pago: input.metodoPago ?? undefined,
    p_reglamento_aceptado: input.reglamentoAceptado,
    p_equipos: equipos.length ? (equipos as unknown as Json) : undefined,
  })
  return { data: (data as ReservaCreada | null) ?? null, error: error?.message ?? null }
}

/**
 * Cancela una reserva propia (pendiente/confirmada, futura, sin check-in) y
 * anula la cuota asociada si sigue pendiente — una cuota pagada no se toca
 * (el reembolso es decisión de la administración). El equipo solicitado y
 * aún no entregado se cancela en la base con la reserva.
 */
export async function cancelarReservaAmenidad(
  reservaId: string,
): Promise<{ data: { cuota_anulada: boolean } | null; error: string | null }> {
  const { data, error } = await db.rpc('portal_cancelar_reserva', {
    p_reserva_id: reservaId,
  })
  return { data: (data as { cuota_anulada: boolean } | null) ?? null, error: error?.message ?? null }
}

/**
 * Equipo que se presta con una amenidad y cuántas unidades quedan para una
 * fecha (hoy si no se indica). Lo usan el residente al reservar y la vista
 * previa del portal que usa el staff.
 */
export async function equiposDeAmenidad(
  amenidadId: string,
  fecha?: string,
): Promise<{ data: EquipoAmenidadDisponible[]; error: string | null }> {
  const { data, error } = await db.rpc('portal_equipos_amenidad', {
    p_amenidad_id: amenidadId,
    p_fecha: fecha || undefined,
  })
  return { data: Array.isArray(data) ? (data as unknown as EquipoAmenidadDisponible[]) : [], error: error?.message ?? null }
}
