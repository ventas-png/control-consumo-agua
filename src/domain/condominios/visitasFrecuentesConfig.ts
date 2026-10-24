// domain/condominios/visitasFrecuentesConfig.ts — Con cuántos días de
// anticipación avisa el condominio que una visita frecuente está por vencer
// (projects.visitas_frecuentes_dias_aviso, 20261107000200).
//
// La escribe la administración desde la pestaña Vis. Frecuentes; la base sólo
// deja escribirla a quien pasa projects_update. La lee el residente por la rama
// 'cliente' de projects_select, igual que la moneda y las pestañas apagadas.
import { db } from '../../lib/supabase'
import { SinFilasAfectadasError } from '../queryFetch'
import { DIAS_AVISO_RENOVACION_DEFAULT, normalizarDiasAviso } from '../../lib/visitasFrecuentes'

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Días de aviso del condominio. Si no se pudo leer (error de la base, o la
 * columna aún no existe porque el front llegó antes que 20261107000200), el
 * valor por defecto y `error`: la pantalla sigue funcionando con 30 días.
 */
export async function fetchDiasAvisoRenovacion(
  projectId: string,
): Promise<{ dias: number; error: string | null }> {
  try {
    const { data, error } = await db
      .from('projects')
      .select('visitas_frecuentes_dias_aviso')
      .eq('id', projectId)
      .maybeSingle()
    if (error) return { dias: DIAS_AVISO_RENOVACION_DEFAULT, error: error.message }
    if (!data) return { dias: DIAS_AVISO_RENOVACION_DEFAULT, error: 'No se encontró el condominio.' }
    return { dias: normalizarDiasAviso(data.visitas_frecuentes_dias_aviso), error: null }
  } catch (e) {
    return { dias: DIAS_AVISO_RENOVACION_DEFAULT, error: mensaje(e) }
  }
}

/**
 * Guarda los días de aviso. Exige que el servidor haya cambiado la fila: un
 * UPDATE que projects_update no deja tocar vuelve con éxito y cero filas.
 */
export async function guardarDiasAvisoRenovacion(
  projectId: string,
  dias: number,
): Promise<{ error: string | null }> {
  try {
    const { data, error } = await db
      .from('projects')
      .update({ visitas_frecuentes_dias_aviso: normalizarDiasAviso(dias) })
      .eq('id', projectId)
      .select('id')
    if (error) return { error: error.message }
    if (!data || data.length === 0) return { error: new SinFilasAfectadasError().message }
    return { error: null }
  } catch (e) {
    return { error: mensaje(e) }
  }
}
