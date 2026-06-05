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
