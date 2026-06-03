import { useState, type CSSProperties } from 'react'
import { MapView, type LatLng } from './MapView'

// serv:S15 — Selector de ubicación reutilizable: el usuario hace click en el
// mapa (o arrastra el marcador) para elegir coordenadas. Cualquier formulario
// que necesite capturar lat/lng puede embeberlo (p. ej. ubicar una fuente o
// fijar el GPS de una lectura cuando el dispositivo no lo provee).
//
// Controlado si se pasa `value`; si no, mantiene la selección internamente.

export interface LocationPickerProps {
  value?: LatLng | null
  onChange: (coords: LatLng) => void
  center?: [number, number]
  zoom?: number
  className?: string
  style?: CSSProperties
}

export function LocationPicker({ value, onChange, center, zoom, className, style }: LocationPickerProps) {
  const [internal, setInternal] = useState<LatLng | null>(value ?? null)
  const selected = value !== undefined ? value : internal

  const handlePick = (coords: LatLng) => {
    if (value === undefined) setInternal(coords)
    onChange(coords)
  }

  return (
    <div className={className}>
      <MapView
        layers={[]}
        selected={selected}
        onMapClick={handlePick}
        fitToMarkers={false}
        center={center}
        zoom={zoom}
        style={style ?? { height: 320, width: '100%', borderRadius: 12, overflow: 'hidden' }}
      />
      <div style={{ marginTop: 8, fontSize: 13, color: selected ? 'var(--at-ink-2)' : 'var(--at-ink-3)' }}>
        {selected
          ? `📍 ${selected.lat.toFixed(5)}, ${selected.lng.toFixed(5)}`
          : 'Haz clic en el mapa para elegir la ubicación.'}
      </div>
    </div>
  )
}
