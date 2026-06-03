import { useMemo } from 'react'
import type { Cliente, Registro } from '../../types'
import { MapView } from './MapView'
import { buildMedidoresLayer } from './aguaMapLayer'

interface Props {
  clientes: Cliente[]
  registros: Registro[]
}

// serv:S13 — MapaSection quedó como cáscara fina: arma su capa de medidores y
// la pinta con el <MapView> genérico (motor Leaflet reutilizable por dominio).
export function MapaSection({ clientes, registros }: Props) {
  const layers = useMemo(() => [buildMedidoresLayer(clientes, registros)], [clientes, registros])

  return (
    <div style={{ background: 'var(--at-surface)', borderRadius: '24px', height: 'calc(100vh - 200px)', minHeight: '300px', maxHeight: '700px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '15px 20px', background: 'var(--at-surface)', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>Geolocalización de Medidores</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={{ padding: '4px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>🔴 Mora</span>
          <span style={{ padding: '4px 12px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>🟡 Pendiente</span>
          <span style={{ padding: '4px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>🟢 Pagado</span>
        </div>
      </div>
      <MapView layers={layers} style={{ flex: 1, width: '100%' }} />
    </div>
  )
}
