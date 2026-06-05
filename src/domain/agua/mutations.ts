// domain/agua/mutations.ts — Escrituras del dominio agua. T7/PR3: el acceso
// directo a `registros` sale de los componentes hacia la capa domain.
import { supabase } from '../../lib/supabase'
import type { Registro } from '../../types'

/**
 * Inserta un registro de lectura (payload ya armado por la UI). Devuelve la fila
 * creada (o `null`) + `error` con el mensaje legible.
 */
export async function createRegistro(
  registro: Record<string, unknown>,
): Promise<{ data: Registro | null; error: string | null }> {
  const { data, error } = await supabase.from('registros').insert(registro).select()
  return { data: (data?.[0] as Registro) ?? null, error: error?.message ?? null }
}

/**
 * Actualiza un registro por id (payload ya armado por la UI: monto_pagado, estado,
 * fecha_pago, factura_estado…). La lógica de negocio (saldos, transición de
 * Factura) se queda en la UI; aquí solo baja la escritura. Usado por el flujo de
 * cobros (aplicar/verificar pago).
 */
export async function updateRegistro(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('registros').update(payload).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Marca un conjunto de registros como 'mora' (para seguimiento del cobrador).
 * Usado al marcar mora en lote y al crear un convenio.
 */
export async function marcarRegistrosMora(ids: string[]): Promise<{ error: string | null }> {
  const { error } = await supabase.from('registros').update({ estado: 'mora' }).in('id', ids)
  return { error: error?.message ?? null }
}
