// domain/portal/reservas.ts — Reservas de amenidades del residente vía RPCs
// atómicos (20260822030000). Toda la validación y el CÁLCULO DE LA TARIFA viven
// en el servidor (SECURITY DEFINER): el cliente solo describe la reserva; el
// monto y el cargo a la unidad (cuota 'amenidad') los sella Postgres en la misma
// transacción. Boundary T7. `supabase` laxo: los RPCs aún no están en el esquema
// generado (entran con el próximo gen:db-types).
import { supabase } from '../../lib/supabase'
import type { ReservaAmenidad } from '../../types'

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
}

/**
 * Reserva una amenidad de una unidad propia. El RPC valida reglas, bloqueos y
 * conflicto GLOBAL bajo lock, calcula la tarifa server-side y, si aplica
 * "cargar a la unidad" con reserva confirmada, crea la cuota en la misma
 * transacción. Devuelve la reserva creada (con monto_tarifa del servidor).
 */
export async function reservarAmenidad(
  input: ReservarAmenidadInput,
): Promise<{ data: ReservaAmenidad | null; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_reservar_amenidad', {
    p_amenidad_id: input.amenidadId,
    p_unidad_id: input.unidadId,
    p_fecha: input.fecha,
    p_hora_inicio: input.horaInicio,
    p_hora_fin: input.horaFin,
    p_num_invitados: input.numInvitados,
    p_notas: input.notas ?? null,
    p_metodo_pago: input.metodoPago,
    p_reglamento_aceptado: input.reglamentoAceptado,
  })
  return { data: (data as ReservaAmenidad | null) ?? null, error: error?.message ?? null }
}

/**
 * Cancela una reserva propia (pendiente/confirmada, futura, sin check-in) y
 * anula la cuota asociada si sigue pendiente — una cuota pagada no se toca
 * (el reembolso es decisión de la administración).
 */
export async function cancelarReservaAmenidad(
  reservaId: string,
): Promise<{ data: { cuota_anulada: boolean } | null; error: string | null }> {
  const { data, error } = await supabase.rpc('portal_cancelar_reserva', {
    p_reserva_id: reservaId,
  })
  return { data: (data as { cuota_anulada: boolean } | null) ?? null, error: error?.message ?? null }
}
