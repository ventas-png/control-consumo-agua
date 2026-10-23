// Vistas de listas de novedades y rondas (P1 #3, extraídas de SeguridadTab).
// Cada tarjeta abre su detalle en ventana al tocarla; «Ver detalle» / «Ver» son
// el camino de teclado. En el teléfono, el estado y los botones de una ronda
// bajan a otra línea en vez de apretar la fecha.
import type { PrioridadNovedad } from '../../../../types'
import type { SeguridadCtx } from './ctx'
import { duracionRondaMin } from '../../../../lib/seguridadReglas'
import { accentPrioridad, ESTADO_RONDA, PRIORIDAD_CONFIG, TIPO_NOVEDAD_CONFIG } from './ui'

export function VistaNovedades({ ctx }: { ctx: SeguridadCtx }) {
  const {
    rondas, canDelete, filtroPrioridad, setFiltroPrioridad,
    novedadesFiltradas, setNovedadDetalle, eliminarNovedad,
  } = ctx

  return (
    <>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'normal', 'alta', 'critica'] as const).map(p => (
          <button key={p} onClick={() => setFiltroPrioridad(p)} aria-pressed={filtroPrioridad === p}
            style={{ padding: '6px 13px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: filtroPrioridad === p ? (p === 'todos' ? 'var(--at-line)' : PRIORIDAD_CONFIG[p as PrioridadNovedad]?.bg) : 'transparent',
              color: filtroPrioridad === p ? (p === 'todos' ? 'var(--at-ink-2)' : PRIORIDAD_CONFIG[p as PrioridadNovedad]?.color) : 'var(--at-ink-3)' }}>
            {p === 'todos' ? 'Todas' : PRIORIDAD_CONFIG[p as PrioridadNovedad].label}
          </button>
        ))}
      </div>
      {novedadesFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay novedades registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {novedadesFiltradas.map(n => {
            const pc = PRIORIDAD_CONFIG[n.prioridad]
            const tc = TIPO_NOVEDAD_CONFIG[n.tipo]
            const rondaVinculada = n.ronda_id ? rondas.find(r => r.id === n.ronda_id) : null
            const accentColor = accentPrioridad(n.prioridad)
            return (
              <div key={n.id} onClick={() => setNovedadDetalle(n)}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden', display: 'flex', cursor: 'pointer' }}>
                {/* Accent stripe */}
                <div style={{ width: '5px', background: accentColor, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, padding: '14px 16px' }}>
                  {/* Top row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ fontSize: '22px', flexShrink: 0, lineHeight: 1 }}>{tc.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>{tc.label}</span>
                        <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                        <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginLeft: 'auto' }}>
                          {new Date(n.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {/* Description */}
                      <p style={{ margin: '0 0 8px', fontSize: '13.5px', color: 'var(--at-ink-2)', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{n.descripcion}</p>
                      {/* Metadata footer */}
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {n.ubicacion && (
                          <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            📍 {n.ubicacion}
                          </span>
                        )}
                        {rondaVinculada && (
                          <span style={{ fontSize: '12px', color: 'var(--at-primary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            🛡 Ronda {new Date(rondaVinculada.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        <button onClick={e => { e.stopPropagation(); setNovedadDetalle(n) }}
                          style={{ fontSize: '12px', color: 'var(--at-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontWeight: 600, marginLeft: 'auto' }}>
                          Ver detalle →
                        </button>
                        {canDelete && (
                          <button onClick={e => { e.stopPropagation(); void eliminarNovedad(n.id) }} aria-label="Eliminar novedad"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '14px', padding: '2px 4px' }}>
                            🗑
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

export function VistaRondas({ ctx }: { ctx: SeguridadCtx }) {
  const { rondas, novedades, rutas, visitasControl, canEdit, finalizarRonda, finalizando, setRondaDetalle } = ctx

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {rondas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛡️</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay rondas registradas</p>
        </div>
      ) : rondas.map(r => {
        const ec = ESTADO_RONDA[r.estado]
        const duracion = duracionRondaMin(r.inicio, r.fin, Date.now())
        const novsRonda = novedades.filter(n => n.ronda_id === r.id).length
        const visitasR = visitasControl.filter(v => v.ronda_id === r.id)
        const okCount = visitasR.filter(v => v.estado === 'ok').length
        const novCount = visitasR.filter(v => v.estado === 'novedad').length
        const omitCount = visitasR.filter(v => v.estado === 'omitido').length
        const rutaNombre = r.ruta_id ? rutas.find(rt => rt.id === r.ruta_id)?.nombre : null
        const fecha = `${new Date(r.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })} — ${new Date(r.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
        return (
          <div key={r.id} onClick={() => setRondaDetalle(r)}
            style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '8px 14px', flexWrap: 'wrap', cursor: 'pointer' }}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>🛡️</span>
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{fecha}</div>
              <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', marginTop: '3px', flexWrap: 'wrap' }}>
                <span>⏱ {duracion} min{r.fin ? '' : ' (en curso)'}</span>
                {rutaNombre && <span>🗺 {rutaNombre}</span>}
                {visitasR.length > 0 && (
                  <>
                    {okCount > 0 && <span style={{ color: 'var(--at-success)' }}>✅ {okCount}</span>}
                    {novCount > 0 && <span style={{ color: 'var(--at-warning)' }}>⚠️ {novCount}</span>}
                    {omitCount > 0 && <span style={{ color: 'var(--at-accent-hover)' }}>⏭ {omitCount}</span>}
                  </>
                )}
                {novsRonda > 0 && <span>📋 {novsRonda} novedad{novsRonda > 1 ? 'es' : ''}</span>}
                {r.notas && <span>· {r.notas}</span>}
              </div>
            </div>
            <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: ec.bg, color: ec.color, flexShrink: 0 }}>{ec.label}</span>
              {canEdit && r.estado === 'en_curso' && (
                <button onClick={() => void finalizarRonda(r.id, 'completada')} disabled={finalizando !== null} style={{ padding: '6px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: finalizando ? 'default' : 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0, opacity: finalizando ? 0.6 : 1 }}>
                  {finalizando === r.id ? 'Cerrando…' : '✓ Completar'}
                </button>
              )}
              <button onClick={() => setRondaDetalle(r)} aria-label={`Ver ronda del ${fecha}`}
                style={{ padding: '6px 12px', background: 'var(--at-surface)', color: 'var(--at-ink)', border: '1px solid var(--at-line-strong)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                Ver
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
