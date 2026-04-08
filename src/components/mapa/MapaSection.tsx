import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { Cliente, Registro } from '../../types'

interface Props {
  clientes: Cliente[]
  registros: Registro[]
}

export function MapaSection({ clientes, registros }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<'mora' | 'pendiente' | 'pagado' | null>(null)

  const conteo = { mora: 0, pendiente: 0, pagado: 0 }
  clientes.forEach(cliente => {
    const ultima = registros
      .filter(r => r.cliente_id === cliente.id && r.gps)
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0]
    if (ultima) conteo[ultima.estado]++
  })

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
  }, [clientes, registros, filtroEstado])

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
      if (filtroEstado && ultima.estado !== filtroEstado) return

      const { lat, lng } = ultima.gps

      const colorPin =
        ultima.estado === 'mora' ? '#dc2626' :
        ultima.estado === 'pendiente' ? '#d97706' :
        '#16a34a'

      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${colorPin};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      })

      const marker = L.marker([lat, lng], { icon }).addTo(mapInstance.current!)

      const montoPendiente = ultima.monto_calculado - (ultima.monto_pagado ?? 0)

      marker.bindPopup(`
        <div style="min-width:190px;font-family:system-ui,sans-serif;line-height:1.5">
          <strong style="font-size:14px">${cliente.nombre}</strong>
          <div style="color:#6b7280;font-size:12px">Cód: ${cliente.codigo}</div>
          ${cliente.direccion ? `<div style="color:#6b7280;font-size:12px">📍 ${cliente.direccion}</div>` : ''}
          ${cliente.telefono ? `<div style="color:#6b7280;font-size:12px">📞 ${cliente.telefono}</div>` : ''}
          <hr style="margin:6px 0;border:none;border-top:1px solid #e5e7eb"/>
          <div>Estado: <b style="color:${colorPin}">${ultima.estado.toUpperCase()}</b></div>
          <div>Consumo: ${ultima.consumo} m³</div>
          <div>Monto: Q${ultima.monto_calculado.toFixed(2)}</div>
          ${ultima.estado !== 'pagado' && montoPendiente > 0 ? `<div style="color:${colorPin};font-weight:600">Por pagar: Q${montoPendiente.toFixed(2)}</div>` : ''}
          <div style="color:#9ca3af;font-size:11px;margin-top:6px">${new Date(ultima.fecha).toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
      `)

      bounds.push([lat, lng])
    })

    if (bounds.length > 0) {
      mapInstance.current.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] })
    }
  }

  return (
    <div style={{ background: 'white', borderRadius: '24px', height: 'calc(100vh - 200px)', minHeight: '300px', maxHeight: '700px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '15px 20px', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>Geolocalización de Medidores</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            { key: 'mora', label: 'Mora', count: conteo.mora, bg: '#fee2e2', color: '#991b1b', dot: '#dc2626' },
            { key: 'pendiente', label: 'Pendiente', count: conteo.pendiente, bg: '#fef3c7', color: '#92400e', dot: '#d97706' },
            { key: 'pagado', label: 'Pagado', count: conteo.pagado, bg: '#d1fae5', color: '#065f46', dot: '#16a34a' },
          ] as const).map(({ key, label, count, bg, color, dot }) => {
            const active = filtroEstado === key
            return (
              <button
                key={key}
                onClick={() => setFiltroEstado(active ? null : key)}
                style={{ padding: '4px 12px', background: active ? dot : bg, color: active ? 'white' : color, border: 'none', borderRadius: '12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: active ? 'white' : dot, display: 'inline-block', flexShrink: 0 }} />
                {label}{count > 0 ? ` (${count})` : ''}
              </button>
            )
          })}
          {filtroEstado && (
            <button
              onClick={() => setFiltroEstado(null)}
              style={{ padding: '4px 10px', background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '12px', fontSize: '13px', cursor: 'pointer' }}
            >
              Ver todos
            </button>
          )}
        </div>
      </div>
      <div ref={mapRef} style={{ flex: 1, width: '100%' }} />
    </div>
  )
}
