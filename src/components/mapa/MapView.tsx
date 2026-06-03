import { useEffect, useRef, type CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// serv:S13 — Mapa genérico reutilizable (agua/condominios/energía).
//
// Antes, la lógica de Leaflet vivía embebida y específica de agua dentro de
// MapaSection. Aquí se extrae el "motor" (init del mapa, tile layer, pintado de
// pines, fitBounds) detrás de una API declarativa por capas. Cada dominio
// construye sus `layers` (markers con lat/lng + color + popup) y los pasa.
//
// Fuera de alcance (hallazgos propios): interacción click-para-crear (serv:S15),
// clustering/paginación de pines (serv:S14), heatmap (serv:S18).

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
// serv:S19 (atribución OSM) ya cubierta aquí por default.
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors'

// Ciudad de Guatemala — centro por defecto cuando no hay markers a los que ajustar.
const DEFAULT_CENTER: [number, number] = [14.6349, -90.5069]
const DEFAULT_ZOOM = 13
const DEFAULT_PIN_COLOR = '#2563eb'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  /** Color del pin (cualquier color CSS). Default: azul. */
  color?: string
  /** HTML del popup. El caller es responsable de sanitizar su contenido. */
  popupHtml?: string
  /** Texto del tooltip al pasar el cursor. */
  tooltip?: string
}

export interface MapLayer {
  id: string
  markers: MapMarker[]
}

export interface MapViewProps {
  layers: MapLayer[]
  center?: [number, number]
  zoom?: number
  /** Ajusta el viewport a todos los markers cuando hay alguno. Default: true. */
  fitToMarkers?: boolean
  className?: string
  /** El contenedor debe tener una altura definida para que Leaflet renderice. */
  style?: CSSProperties
}

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:15px;height:15px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
    iconSize: [15, 15],
    iconAnchor: [7, 7],
  })
}

export function MapView({
  layers,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  fitToMarkers = true,
  className,
  style,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markersGroup = useRef<L.FeatureGroup | null>(null)

  // Ciclo de vida del mapa: se crea una sola vez y se destruye al desmontar.
  // center/zoom solo aplican al inicializar (viewport inicial); cambios
  // posteriores de datos se reflejan vía fitToMarkers en el efecto de markers.
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    const map = L.map(mapRef.current).setView(center, zoom)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(map)
    markersGroup.current = L.featureGroup().addTo(map)
    mapInstance.current = map
    return () => {
      map.remove()
      mapInstance.current = null
      markersGroup.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-pinta los markers cuando cambian las capas. El efecto de ciclo de vida
  // corre primero (deja refs listas), así que en el mount inicial este efecto
  // ya encuentra el mapa creado.
  useEffect(() => {
    const map = mapInstance.current
    const group = markersGroup.current
    if (!map || !group) return
    map.invalidateSize()
    group.clearLayers()
    for (const layer of layers) {
      for (const m of layer.markers) {
        const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m.color ?? DEFAULT_PIN_COLOR) })
        if (m.popupHtml) marker.bindPopup(m.popupHtml)
        if (m.tooltip) marker.bindTooltip(m.tooltip)
        group.addLayer(marker)
      }
    }
    if (fitToMarkers) {
      const bounds = group.getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [50, 50] })
    }
  }, [layers, fitToMarkers])

  return <div ref={mapRef} className={className} style={style} />
}
