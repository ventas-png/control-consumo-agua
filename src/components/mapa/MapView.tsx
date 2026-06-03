import { useEffect, useRef, type CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { clusterByGrid, type PixelPoint } from './mapClustering'
import { heatStyle } from './heatScale'

// serv:S13 — Mapa genérico reutilizable (agua/condominios/energía): extrae el
// "motor" de Leaflet detrás de una API declarativa por capas.
// serv:S14 — clustering de pines por grilla (prop `cluster`).
// serv:S15 — interacción: click en el mapa (`onMapClick`) + marcador
//            seleccionado arrastrable (`selected`) para elegir una ubicación.

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
// serv:S19 (atribución OSM) cubierta por default.
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors'

// Ciudad de Guatemala — centro por defecto cuando no hay markers a los que ajustar.
const DEFAULT_CENTER: [number, number] = [14.6349, -90.5069]
const DEFAULT_ZOOM = 13
const DEFAULT_PIN_COLOR = '#2563eb'
const CLUSTER_CELL_PX = 60

export interface LatLng {
  lat: number
  lng: number
}

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
  /** serv:S18 — intensidad para el modo "mapa de calor" (p. ej. consumo). */
  weight?: number
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
  /** serv:S14 — agrupa pines cercanos en clusters (con conteo). Default: false. */
  cluster?: boolean
  /** serv:S18 — modo "mapa de calor": círculos graduados por `weight`. Default: false. */
  heat?: boolean
  /** serv:S15 — click en el mapa (o arrastre del marcador `selected`). */
  onMapClick?: (coords: LatLng) => void
  /** serv:S15 — marcador de ubicación elegida (arrastrable). */
  selected?: LatLng | null
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

function clusterIcon(count: number): L.DivIcon {
  const size = count < 10 ? 34 : count < 100 ? 40 : 46
  return L.divIcon({
    className: '',
    html: `<div style="background:${DEFAULT_PIN_COLOR};color:white;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function selectedIcon(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--at-primary);border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  })
}

function addSingleMarker(group: L.FeatureGroup, m: MapMarker) {
  const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m.color ?? DEFAULT_PIN_COLOR) })
  if (m.popupHtml) marker.bindPopup(m.popupHtml)
  if (m.tooltip) marker.bindTooltip(m.tooltip)
  group.addLayer(marker)
}

// serv:S18 — pinta los markers como círculos de calor graduados por `weight`,
// normalizando contra el rango del propio dataset (azul = bajo → rojo = alto).
// Los translúcidos se superponen, así que las zonas densas se ven más cálidas.
function addHeatPoints(group: L.FeatureGroup, markers: MapMarker[]) {
  if (!markers.length) return
  const weights = markers.map(m => m.weight ?? 0)
  const min = Math.min(...weights)
  const max = Math.max(...weights)
  for (const m of markers) {
    const { color, radius, fillOpacity } = heatStyle(m.weight ?? 0, min, max)
    const circle = L.circleMarker([m.lat, m.lng], { radius, stroke: false, fillColor: color, fillOpacity })
    if (m.popupHtml) circle.bindPopup(m.popupHtml)
    if (m.tooltip) circle.bindTooltip(m.tooltip)
    group.addLayer(circle)
  }
}

interface MarkerCluster {
  markers: MapMarker[]
  lat: number
  lng: number
}

// Proyecta cada marker a píxeles (en el zoom actual), los agrupa por grilla y
// devuelve clusters con su centroide. El id de cada punto es su índice, así no
// dependemos de que los marker.id sean únicos entre capas.
function computeClusters(map: L.Map, markers: MapMarker[], cellPx: number): MarkerCluster[] {
  const z = map.getZoom()
  const points: PixelPoint[] = markers.map((m, i) => {
    const p = map.project([m.lat, m.lng], z)
    return { id: String(i), x: p.x, y: p.y }
  })
  return clusterByGrid(points, cellPx).map(group => {
    const ms = group.ids.map(i => markers[Number(i)])
    const lat = ms.reduce((s, m) => s + m.lat, 0) / ms.length
    const lng = ms.reduce((s, m) => s + m.lng, 0) / ms.length
    return { markers: ms, lat, lng }
  })
}

export function MapView({
  layers,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  fitToMarkers = true,
  cluster = false,
  heat = false,
  onMapClick,
  selected,
  className,
  style,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markersGroup = useRef<L.FeatureGroup | null>(null)
  const selectedMarker = useRef<L.Marker | null>(null)
  // onMapClick puede cambiar en cada render; lo leemos por ref para suscribir el
  // handler de click una sola vez.
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick

  // Ciclo de vida del mapa: se crea una vez y se destruye al desmontar.
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return
    const map = L.map(mapRef.current).setView(center, zoom)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(map)
    markersGroup.current = L.featureGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    mapInstance.current = map
    return () => {
      map.remove()
      mapInstance.current = null
      markersGroup.current = null
      selectedMarker.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pinta markers (con o sin clustering) cuando cambian las capas. En modo
  // cluster, re-agrupa en cada zoom (la proyección a píxeles depende del zoom).
  useEffect(() => {
    const map = mapInstance.current
    const group = markersGroup.current
    if (!map || !group) return

    const allMarkers = layers.flatMap(l => l.markers)

    const render = () => {
      group.clearLayers()
      // serv:S18 — el modo calor tiene prioridad sobre el clustering.
      if (heat) {
        addHeatPoints(group, allMarkers)
        return
      }
      if (!cluster) {
        for (const m of allMarkers) addSingleMarker(group, m)
        return
      }
      for (const c of computeClusters(map, allMarkers, CLUSTER_CELL_PX)) {
        if (c.markers.length === 1) {
          addSingleMarker(group, c.markers[0])
          continue
        }
        const cm = L.marker([c.lat, c.lng], { icon: clusterIcon(c.markers.length) })
        cm.on('click', () => {
          const b = L.latLngBounds(c.markers.map(m => [m.lat, m.lng] as [number, number]))
          map.flyToBounds(b, { padding: [60, 60], maxZoom: 17 })
        })
        group.addLayer(cm)
      }
    }

    map.invalidateSize()
    render()

    if (fitToMarkers && allMarkers.length > 0) {
      const b = L.latLngBounds(allMarkers.map(m => [m.lat, m.lng] as [number, number]))
      if (b.isValid()) map.fitBounds(b, { padding: [50, 50] })
    }

    if (cluster && !heat) {
      map.on('zoomend', render)
      return () => { map.off('zoomend', render) }
    }
  }, [layers, fitToMarkers, cluster, heat])

  // serv:S15 — marcador de ubicación elegida (arrastrable). Vive fuera del
  // featureGroup de datos para no verse afectado por el clustering.
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (selectedMarker.current) {
      selectedMarker.current.remove()
      selectedMarker.current = null
    }
    if (selected) {
      const m = L.marker([selected.lat, selected.lng], { icon: selectedIcon(), draggable: true, zIndexOffset: 1000 })
      m.on('dragend', () => {
        const ll = m.getLatLng()
        onMapClickRef.current?.({ lat: ll.lat, lng: ll.lng })
      })
      m.addTo(map)
      selectedMarker.current = m
    }
  }, [selected])

  return <div ref={mapRef} className={className} style={style} />
}
