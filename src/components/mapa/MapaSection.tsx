import { useMemo, useState } from 'react'
import type { Cliente, Registro } from '../../types'
import { MapView } from './MapView'
import { buildMedidoresLayer, type EstadoBucket } from './aguaMapLayer'

interface Props {
  clientes: Cliente[]
  registros: Registro[]
}

// serv:S17 — leyenda + filtro por estado. Cada chip es un toggle que muestra/
// oculta los pines de ese estado.
const ESTADOS: { key: EstadoBucket; label: string; tint: string; color: string }[] = [
  { key: 'mora',      label: '🔴 Mora',      tint: 'var(--at-danger-tint)',  color: 'var(--at-danger-strong)' },
  { key: 'pendiente', label: '🟡 Pendiente', tint: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
  { key: 'pagado',    label: '🟢 Pagado',    tint: 'var(--at-success-tint)', color: 'var(--at-success-strong)' },
]

// serv:S13 — MapaSection quedó como cáscara fina: arma su capa de medidores y
// la pinta con el <MapView> genérico (motor Leaflet reutilizable por dominio).
export function MapaSection({ clientes, registros }: Props) {
  const [visibles, setVisibles] = useState<Set<EstadoBucket>>(() => new Set(['mora', 'pendiente', 'pagado']))
  const [heatOn, setHeatOn] = useState(false) // serv:S18 — modo mapa de calor
  const layers = useMemo(
    () => [buildMedidoresLayer(clientes, registros, visibles)],
    [clientes, registros, visibles],
  )

  const toggle = (key: EstadoBucket) =>
    setVisibles(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div style={{ background: 'var(--at-surface)', borderRadius: '24px', height: 'calc(100vh - 200px)', minHeight: '300px', maxHeight: '700px', overflow: 'hidden', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '15px 20px', background: 'var(--at-surface)', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <h3 style={{ margin: 0, fontSize: '18px' }}>Geolocalización de Medidores</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {ESTADOS.map(e => {
            const active = visibles.has(e.key)
            return (
              <button
                key={e.key}
                onClick={() => toggle(e.key)}
                aria-pressed={active}
                title={active ? 'Ocultar en el mapa' : 'Mostrar en el mapa'}
                style={{
                  padding: '4px 12px',
                  background: active ? e.tint : 'var(--at-surface-2)',
                  color: active ? e.color : 'var(--at-ink-3)',
                  border: `1px solid ${active ? 'transparent' : 'var(--at-line)'}`,
                  borderRadius: '12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: active ? 1 : 0.55,
                  textDecoration: active ? 'none' : 'line-through',
                }}
              >
                {e.label}
              </button>
            )
          })}
          {/* serv:S18 — toggle de mapa de calor por consumo (m³). */}
          <button
            onClick={() => setHeatOn(v => !v)}
            aria-pressed={heatOn}
            title="Mapa de calor por consumo (m³)"
            style={{
              marginLeft: '4px',
              padding: '4px 12px',
              background: heatOn ? 'var(--at-danger-tint)' : 'var(--at-surface-2)',
              color: heatOn ? 'var(--at-danger-strong)' : 'var(--at-ink-3)',
              border: `1px solid ${heatOn ? 'transparent' : 'var(--at-line)'}`,
              borderRadius: '12px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              opacity: heatOn ? 1 : 0.7,
            }}
          >
            🔥 Calor
          </button>
        </div>
      </div>
      <MapView layers={layers} cluster={!heatOn} heat={heatOn} style={{ flex: 1, width: '100%' }} />
    </div>
  )
}
