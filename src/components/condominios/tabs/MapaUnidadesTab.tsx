import { useState, useMemo } from 'react'
import { CuotaCondominio, Unidad, ContratoArrendamiento } from '../../../types'

interface Props {
  unidades: Unidad[]
  cuotas: CuotaCondominio[]
  contratos: ContratoArrendamiento[]
  moneda: string
}

type EstadoUnidad = 'al_dia' | 'mora' | 'vacia' | 'arrendada'

interface UnidadInfo {
  unidad: Unidad
  estado: EstadoUnidad
  saldoPendiente: number
  cuotasVencidas: number
  cuotasTotales: number
  arrendatario?: string
}

const ESTADO_CFG: Record<EstadoUnidad, { label: string; color: string; bg: string; border: string; icon: string }> = {
  al_dia:    { label: 'Al día',     color: '#16a34a', bg: '#dcfce7', border: '#86efac', icon: '🟢' },
  mora:      { label: 'En mora',    color: '#ef4444', bg: '#fef2f2', border: '#fca5a5', icon: '🔴' },
  arrendada: { label: 'Arrendada',  color: 'var(--at-primary)', bg: 'var(--at-primary-tint)', border: 'var(--at-accent-2)', icon: '🔑' },
  vacia:     { label: 'Sin cuotas', color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)', border: 'var(--at-line)', icon: '⬜' },
}

export default function MapaUnidadesTab({ unidades, cuotas, contratos, moneda }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [popover, setPopover] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<EstadoUnidad | ''>('')

  const infos = useMemo<UnidadInfo[]>(() => {
    return unidades.map(u => {
      const cuotasU = cuotas.filter(c => c.unidad_id === u.id)
      const vencidas = cuotasU.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
      const saldo = cuotasU.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
      const contratoActivo = contratos.find(c => c.unidad_id === u.id && c.estado === 'activo')
      let estado: EstadoUnidad = 'vacia'
      if (vencidas.length > 0) estado = 'mora'
      else if (cuotasU.length > 0) estado = 'al_dia'
      if (contratoActivo && estado !== 'mora') estado = 'arrendada'
      return { unidad: u, estado, saldoPendiente: saldo, cuotasVencidas: vencidas.length, cuotasTotales: cuotasU.length, arrendatario: contratoActivo?.arrendatario_nombre }
    })
  }, [unidades, cuotas, contratos, hoy])

  const conteos: Record<EstadoUnidad, number> = useMemo(() => ({
    al_dia:    infos.filter(i => i.estado === 'al_dia').length,
    mora:      infos.filter(i => i.estado === 'mora').length,
    arrendada: infos.filter(i => i.estado === 'arrendada').length,
    vacia:     infos.filter(i => i.estado === 'vacia').length,
  }), [infos])

  const filtradas = filtro ? infos.filter(i => i.estado === filtro) : infos

  const popInfo = popover ? infos.find(i => i.unidad.id === popover) : null

  if (unidades.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-3)', paddingTop: 60 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🗺️</div>
        No hay unidades en este proyecto
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }} onClick={() => setPopover(null)}>
      {/* Leyenda / KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
        {(Object.keys(ESTADO_CFG) as EstadoUnidad[]).map(e => {
          const cfg = ESTADO_CFG[e]
          return (
            <div key={e} onClick={ev => { ev.stopPropagation(); setFiltro(filtro === e ? '' : e) }}
              style={{ background: filtro === e ? cfg.bg : 'var(--at-surface)', border: `1.5px solid ${filtro === e ? cfg.border : 'var(--at-line)'}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{conteos[e]}</div>
              <div style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }}>{cfg.icon} {cfg.label}</div>
            </div>
          )
        })}
      </div>

      {filtro && (
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Filtrando: <strong>{ESTADO_CFG[filtro].label}</strong> ({filtradas.length} unidades)</span>
          <button onClick={() => setFiltro('')} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--at-line)', borderRadius: 5, cursor: 'pointer', background: 'var(--at-surface-2)' }}>✕ Limpiar</button>
        </div>
      )}

      {/* Grid de unidades */}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
          {filtradas.map(info => {
            const cfg = ESTADO_CFG[info.estado]
            const isOpen = popover === info.unidad.id
            return (
              <div key={info.unidad.id} style={{ position: 'relative' }}>
                <div
                  onClick={ev => { ev.stopPropagation(); setPopover(isOpen ? null : info.unidad.id) }}
                  style={{
                    background: cfg.bg, border: `1.5px solid ${isOpen ? cfg.color : cfg.border}`,
                    borderRadius: 10, padding: '10px 6px', textAlign: 'center', cursor: 'pointer',
                    boxShadow: isOpen ? `0 0 0 2px ${cfg.color}44` : 'none', transition: 'all 0.15s',
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{info.unidad.nombre}</div>
                  <div style={{ fontSize: 9, color: cfg.color, marginTop: 2 }}>{cfg.icon}</div>
                  {info.cuotasVencidas > 0 && (
                    <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>{info.cuotasVencidas} venc.</div>
                  )}
                </div>

                {/* Popover */}
                {isOpen && popInfo && (
                  <div
                    onClick={ev => ev.stopPropagation()}
                    style={{
                      position: 'absolute', zIndex: 100, top: '110%', left: '50%', transform: 'translateX(-50%)',
                      background: 'var(--at-surface)', border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '12px 14px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: 200, maxWidth: 240,
                    }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)', marginBottom: 6, borderBottom: '1px solid var(--at-chip)', paddingBottom: 4 }}>
                      {info.unidad.nombre}
                    </div>
                    <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--at-ink-3)' }}>Estado</span>
                        <span style={{ fontWeight: 700, color: cfg.color }}>{cfg.icon} {cfg.label}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--at-ink-3)' }}>Cuotas totales</span>
                        <span style={{ fontWeight: 600 }}>{info.cuotasTotales}</span>
                      </div>
                      {info.cuotasVencidas > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--at-ink-3)' }}>Cuotas vencidas</span>
                          <span style={{ fontWeight: 700, color: '#ef4444' }}>{info.cuotasVencidas}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--at-chip)', paddingTop: 4, marginTop: 2 }}>
                        <span style={{ color: 'var(--at-ink-3)' }}>Saldo pendiente</span>
                        <span style={{ fontWeight: 700, color: info.saldoPendiente > 0 ? '#ef4444' : '#16a34a' }}>
                          {moneda} {info.saldoPendiente.toLocaleString('es', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      {info.arrendatario && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--at-ink-3)' }}>Arrendatario</span>
                          <span style={{ fontWeight: 600, color: 'var(--at-primary)', maxWidth: 120, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.arrendatario}</span>
                        </div>
                      )}
                      {info.unidad.tipo && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--at-ink-3)' }}>Tipo</span>
                          <span style={{ fontWeight: 600 }}>{info.unidad.tipo}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--at-ink-3)', textAlign: 'center' }}>
        Haz click en una unidad para ver su detalle · {infos.length} unidades totales
      </div>
    </div>
  )
}
