import type { Cliente, Registro } from '../../types'
import type { MapLayer, MapMarker } from './MapView'
import { escapeHtml } from '../../lib/printHtml'

// serv:S13 — Lógica específica de agua para alimentar el <MapView> genérico.
// Mantenerla aparte del componente la hace testeable sin Leaflet/DOM y deja a
// MapaSection como una cáscara fina (cabecera + leyenda + <MapView>).

/** Color del pin según el estado de cobro de la última lectura. */
export function colorPorEstado(estado: string): string {
  return estado === 'mora' ? 'red' : estado === 'pendiente' ? 'gold' : 'green'
}

// serv:S17 — buckets de estado para filtrar/colorear el mapa. Todo lo que no es
// mora ni pendiente cae en "pagado" (consistente con colorPorEstado).
export type EstadoBucket = 'mora' | 'pendiente' | 'pagado'
export function bucketEstado(estado: string): EstadoBucket {
  return estado === 'mora' ? 'mora' : estado === 'pendiente' ? 'pendiente' : 'pagado'
}

/**
 * Construye la capa "medidores": un pin por cliente con lectura georreferenciada,
 * ubicado en su **última** lectura (por fecha) y coloreado por estado de cobro.
 * Los clientes sin lecturas o sin GPS se omiten. serv:S17 — si se pasa
 * `estadosVisibles`, solo se incluyen los pines cuyo bucket de estado está activo.
 */
export function buildMedidoresLayer(
  clientes: Cliente[],
  registros: Registro[],
  estadosVisibles?: ReadonlySet<EstadoBucket>,
): MapLayer {
  const markers: MapMarker[] = clientes.flatMap(cliente => {
    const lecturasCliente = registros
      .filter(r => r.cliente_id === cliente.id && r.gps)
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    if (!lecturasCliente.length) return []
    const ultima = lecturasCliente[0]
    if (!ultima.gps) return []
    // serv:S17 — filtro por estado (cuando se provee el set de visibles).
    if (estadosVisibles && !estadosVisibles.has(bucketEstado(ultima.estado))) return []

    const { lat, lng } = ultima.gps
    const color = colorPorEstado(ultima.estado)
    return [{
      id: cliente.id,
      lat,
      lng,
      color,
      // serv:S18 — peso para el mapa de calor: consumo de la última lectura.
      weight: ultima.consumo ?? 0,
      // Leaflet bindPopup renderiza este string como HTML → escapamos los datos
      // del cliente (nombre/estado) para evitar XSS al abrir el popup del pin.
      popupHtml:
        `<strong>${escapeHtml(cliente.nombre)}</strong><br>` +
        `Estado: <b style="color:${color}">${escapeHtml(ultima.estado.toUpperCase())}</b><br>` +
        `Consumo: ${ultima.consumo} m³<br>` +
        `<small>${new Date(ultima.fecha).toLocaleDateString()}</small>`,
    }]
  })

  return { id: 'medidores', markers }
}
