// domain/condominios/portalPestanas.ts — Qué pestañas del portal del residente
// están apagadas en un condominio (projects.portal_tabs_ocultos, 20261106000000).
//
// La escribe el propietario/administrador de la empresa desde el tab «Config.
// portal» (Residentes). La base sólo deja escribirla a quien pasa
// projects_update (super_admin, company_owner/admin de la empresa) y sólo con
// ids del portal (CHECK); el saneo de lo que vuelve vive en lib/portalTabs.
import { db } from '../../lib/supabase'
import { SinFilasAfectadasError } from '../queryFetch'
import { normalizarTabsOcultos, type PortalTab } from '../../lib/portalTabs'

/** Pestañas apagadas del condominio. `error` si no se pudo leer (la UI no debe
 *  ofrecer guardar sobre un estado que no conoce). */
export async function fetchPortalTabsOcultos(
  projectId: string,
): Promise<{ ocultos: PortalTab[]; error: string | null }> {
  const { data, error } = await db
    .from('projects')
    .select('portal_tabs_ocultos')
    .eq('id', projectId)
    .maybeSingle()
  if (error) return { ocultos: [], error: error.message }
  if (!data) return { ocultos: [], error: 'No se encontró el condominio.' }
  return { ocultos: normalizarTabsOcultos(data.portal_tabs_ocultos), error: null }
}

/**
 * Guarda las pestañas apagadas del condominio. Exige que el servidor haya
 * cambiado la fila: un UPDATE que projects_update no deja tocar vuelve con éxito
 * y cero filas, y la pantalla lo mostraría como guardado.
 */
export async function guardarPortalTabsOcultos(
  projectId: string,
  ocultos: readonly PortalTab[],
): Promise<{ error: string | null }> {
  const { data, error } = await db
    .from('projects')
    .update({ portal_tabs_ocultos: normalizarTabsOcultos(ocultos) })
    .eq('id', projectId)
    .select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: new SinFilasAfectadasError().message }
  return { error: null }
}
