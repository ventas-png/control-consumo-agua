import type { Cliente, Registro } from '../../types'
import type { MapLayer, MapMarker } from './MapView'

// serv:S13 — Lógica específica de agua para alimentar el <MapView> genérico.
// Mantenerla aparte del componente la hace testeable sin Leaflet/DOM y deja a
// MapaSection como una cáscara fina (cabecera + leyenda + <MapView>).

/** Color del pin según el estado de cobro de la última lectura. */
export function colorPorEstado(estado: string): string {
  return estado === 'mora' ? 'red' : estado === 'pendiente' ? 'gold' : 'green'
}

/**
 * Construye la capa "medidores": un pin por cliente con lectura georreferenciada,
 * ubicado en su **última** lectura (por fecha) y coloreado por estado de cobro.
 * Los clientes sin lecturas o sin GPS se omiten.
 */
export function buildMedidoresLayer(clientes: Cliente[], registros: Registro[]): MapLayer {
  const markers: MapMarker[] = clientes.flatMap(cliente => {
    const lecturasCliente = registros
      .filter(r => r.cliente_id === cliente.id && r.gps)
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    if (!lecturasCliente.length) return []
    const ultima = lecturasCliente[0]
    if (!ultima.gps) return []

    const { lat, lng } = ultima.gps
    const color = colorPorEstado(ultima.estado)
    return [{
      id: cliente.id,
      lat,
      lng,
      color,
      popupHtml:
        `<strong>${cliente.nombre}</strong><br>` +
        `Estado: <b style="color:${color}">${ultima.estado.toUpperCase()}</b><br>` +
        `Consumo: ${ultima.consumo} m³<br>` +
        `<small>${new Date(ultima.fecha).toLocaleDateString()}</small>`,
    }]
  })

  return { id: 'medidores', markers }
}
