import { useEffect, useMemo, useRef, useState } from 'react'
import type { Cliente, Registro } from '../../types'
import { fetchMapCenter, saveMapCenter } from '../../domain/mapa/queries'
import { notify } from '../shared/Dialog'
import { MapView } from './MapView'
import { buildMedidoresLayer, type EstadoBucket } from './aguaMapLayer'
import { resolveMapCenter, type MapCenterConfig } from './mapCenter'

interface Props {
  clientes: Cliente[]
  registros: Registro[]
  // serv:S16 — empresa actual: se lee/guarda el centro del mapa en `companies`.
  companyId?: string
  // serv:S16 — solo company_owner / super_admin pueden fijar el centro (lo exige
  // la policy companies_update); para el resto el botón ni se muestra.
  canConfigurar?: boolean
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
// serv:S16 — además resuelve el centro/zoom inicial desde la empresa (companies).
export function MapaSection({ clientes, registros, companyId, canConfigurar = false }: Props) {
  const [visibles, setVisibles] = useState<Set<EstadoBucket>>(() => new Set(['mora', 'pendiente', 'pagado']))
  const [heatOn, setHeatOn] = useState(false) // serv:S18 — modo mapa de calor
  // serv:S16 — config de centro/zoom del tenant: undefined = cargando, null = sin
  // companyId o sin config (usa el default de la app), objeto = config de companies.
  const [mapCfg, setMapCfg] = useState<MapCenterConfig | null | undefined>(companyId ? undefined : null)
  const [guardando, setGuardando] = useState(false)
  // Última vista (centro/zoom) reportada por el mapa; en ref para no re-renderizar
  // en cada pan/zoom — sólo se lee al pulsar "Fijar centro".
  const vistaActualRef = useRef<{ center: [number, number]; zoom: number } | null>(null)

  // serv:S16 — lee el centro configurado de la empresa directo de `companies`
  // (query puntual por PK). Aislado del useData legacy (tabla `empresa`), que no
  // trae estas columnas; así no se toca esa capa de datos. Degrada a default si
  // la columna aún no existe (migración no aplicada) o no hay fila.
  useEffect(() => {
    if (!companyId) { setMapCfg(null); return }
    let cancelado = false
    setMapCfg(undefined)
    void fetchMapCenter(companyId).then(cfg => { if (!cancelado) setMapCfg(cfg) })
    return () => { cancelado = true }
  }, [companyId])

  const layers = useMemo(
    () => [buildMedidoresLayer(clientes, registros, visibles)],
    [clientes, registros, visibles],
  )

  // serv:S16 — centro/zoom inicial del mapa (tenant si está configurado, si no
  // el default de la app). Cuando hay centro propio se desactiva el auto-fit a
  // markers para respetar la vista elegida por la empresa.
  const { center, zoom } = useMemo(() => resolveMapCenter(mapCfg), [mapCfg])
  const tieneCentro = !!mapCfg && Number.isFinite(mapCfg.center_lat) && Number.isFinite(mapCfg.center_lng)
  const cargandoMapa = mapCfg === undefined

  const toggle = (key: EstadoBucket) =>
    setVisibles(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // serv:S16 — persiste la vista actual del mapa como centro/zoom por defecto del
  // tenant. La RLS companies_update exige owner/super_admin (ya gateado en el botón).
  const fijarCentro = async () => {
    if (!companyId || guardando) return
    const v = vistaActualRef.current ?? { center, zoom }
    const payload: MapCenterConfig = {
      center_lat: Number(v.center[0].toFixed(6)),
      center_lng: Number(v.center[1].toFixed(6)),
      zoom_default: Math.round(v.zoom),
    }
    setGuardando(true)
    const { error } = await saveMapCenter(companyId, payload)
    setGuardando(false)
    if (error) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: 'No se pudo fijar el centro del mapa.' })
      return
    }
    setMapCfg(payload)
    notify({ variant: 'success', title: 'Centro fijado', text: 'El mapa abrirá en esta vista para tu empresa.' })
  }

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
          {/* serv:S16 — fijar el centro/zoom por defecto del tenant (owner/super_admin). */}
          {canConfigurar && companyId && (
            <button
              onClick={fijarCentro}
              disabled={guardando || cargandoMapa}
              title="Guardar la vista actual como centro por defecto del mapa para tu empresa"
              style={{
                marginLeft: '4px',
                padding: '4px 12px',
                background: 'var(--at-surface-2)',
                color: 'var(--at-ink-3)',
                border: '1px solid var(--at-line)',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 500,
                cursor: guardando || cargandoMapa ? 'default' : 'pointer',
                opacity: guardando || cargandoMapa ? 0.6 : 1,
              }}
            >
              📍 {guardando ? 'Guardando…' : 'Fijar centro'}
            </button>
          )}
        </div>
      </div>
      {cargandoMapa ? (
        <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--at-ink-3)', fontSize: '14px' }}>
          Cargando mapa…
        </div>
      ) : (
        <MapView
          layers={layers}
          cluster={!heatOn}
          heat={heatOn}
          center={center}
          zoom={zoom}
          fitToMarkers={!tieneCentro}
          onViewChange={(c, z) => { vistaActualRef.current = { center: c, zoom: z } }}
          style={{ flex: 1, width: '100%' }}
        />
      )}
    </div>
  )
}
