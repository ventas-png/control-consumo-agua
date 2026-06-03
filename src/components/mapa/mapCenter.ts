// serv:S16 — Centro/zoom del mapa por tenant. Constantes de fallback (Ciudad de
// Guatemala) + resolución del centro a partir de la empresa. Lógica pura y
// testeable, sin Leaflet (la consume tanto MapView como MapaSection).

export const DEFAULT_CENTER: [number, number] = [14.6349, -90.5069]
export const DEFAULT_ZOOM = 13

export interface MapCenterConfig {
  center_lat?: number | null
  center_lng?: number | null
  zoom_default?: number | null
}

const esNumeroFinito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Centro y zoom iniciales del mapa: usa la configuración del tenant cuando lat y
 * lng están completas, con fallback a Ciudad de Guatemala. El zoom es
 * independiente (cae al default si no está configurado).
 */
export function resolveMapCenter(empresa?: MapCenterConfig | null): { center: [number, number]; zoom: number } {
  const center: [number, number] =
    esNumeroFinito(empresa?.center_lat) && esNumeroFinito(empresa?.center_lng)
      ? [empresa!.center_lat as number, empresa!.center_lng as number]
      : DEFAULT_CENTER
  const zoom = esNumeroFinito(empresa?.zoom_default) ? (empresa!.zoom_default as number) : DEFAULT_ZOOM
  return { center, zoom }
}
