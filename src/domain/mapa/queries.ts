// domain/mapa/queries.ts — Acceso a datos del centro/zoom del mapa por tenant
// (serv:S16). Extraído de MapaSection (T7/PR3): los componentes no importan
// `supabase` directo; el acceso a `companies` para el mapa vive en la capa domain.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'
import { parseMapCenter, type MapCenterConfig } from './schemas'

/**
 * Lee el centro/zoom por defecto del mapa de una empresa (query puntual por PK).
 * Degrada a `null` (default de la app) si no hay fila o las columnas aún no
 * existen. No lanza: ante error devuelve `null`.
 */
export async function fetchMapCenter(companyId: string): Promise<MapCenterConfig | null> {
  const { data, error } = await supabase
    .from('companies')
    .select('center_lat, center_lng, zoom_default')
    .eq('id', companyId)
    .single()
  reportDegradedQuery('mapa.fetchMapCenter', error)
  return parseMapCenter(data)
}

/**
 * Persiste el centro/zoom por defecto del mapa del tenant. La RLS
 * `companies_update` exige owner/super_admin (ya gateado en la UI). Devuelve
 * `{ error }` (mensaje legible o `null`) para que la UI muestre el aviso.
 */
export async function saveMapCenter(
  companyId: string,
  payload: MapCenterConfig,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('companies').update(payload).eq('id', companyId)
  return { error: error?.message ?? null }
}
