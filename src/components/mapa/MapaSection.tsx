import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Cliente, Registro } from '../../types'
interface Props {
  clientes: Cliente[]
  registros: Registro[]
}

export function MapaSection({ clientes, registros }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!mapRef.current) return
    if (mapInstance.current) {
      mapInstance.current.invalidateSize()
      updateMarkers()
      return
    }

    mapInstance.current = L.map(mapRef.current).setView([14.6349, -90.5069], 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance.current)
    updateMarkers()

    return () => {
      mapInstance.current?.remove()
      mapInstance.current = null
    }
  }, [])

  useEffect(() => {
    if (mapInstance.current) updateMarkers()
  }, [clientes, registros])

  function updateMarkers() {
    if (!mapInstance.current) return

    mapInstance.current.eachLayer(layer => {
      if (layer instanceof L.Marker) mapInstance.current!.removeLayer(layer)
    })

    const bounds: [number, number][] = []

    clientes.forEach(cliente => {
      const lecturasCliente = registros
        .filter(r => r.cliente_id === cliente.id && r.gps)
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

      if (!lecturasCliente.length) return
      const ultima = lecturasCliente[0]
      if (!ultima.gps) return
      const { lat, lng } = ultima.gps

      const colorPin =
        ultima.estado === 'mora' ? 'red' :
        ultima.estado === 'pendiente' ? 'gold' :
        'green'

      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${colorPin};width:15px;height:15px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [15, 15],
        iconAnchor: [7, 7],
      })

      const marker = L.marker([lat, lng], { icon }).addTo(mapInstance.current!)
      marker.bindPopup(`
        <strong>${cliente.nombre}</strong><br>
        Estado: <b style="color:${colorPin}">${ultima.estado.toUpperCase()}</b><br>
        Consumo: ${ultima.consumo} m³<br>
        <small>${new Date(ultima.fecha).toLocaleDateString()}</small>
      `)

      bounds.push([lat, lng])
    })

    if (bounds.length > 0) {
      mapInstance.current.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] })
    }
  }

  return (
    <div style={{ background: 'white', borderRadius: '24px', height: 'calc(100vh - 200px)', minHeight: '300px', maxHeight: '700px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '15px 20px', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>Geolocalización de Medidores</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ padding: '4px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>🔴 Mora</span>
          <span style={{ padding: '4px 12px', background: '#fef3c7', color: '#92400e', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>🟡 Pendiente</span>
          <span style={{ padding: '4px 12px', background: '#d1fae5', color: '#065f46', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>🟢 Pagado</span>
        </div>
      </div>
      <div ref={mapRef} style={{ flex: 1, width: '100%' }} />
    </div>
  )
}
