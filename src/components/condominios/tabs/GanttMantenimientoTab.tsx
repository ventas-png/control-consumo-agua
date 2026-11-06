import { hoyLocalISO } from '../../../lib/format'
import { useState, useMemo } from 'react'
import { TicketMantenimiento } from '../../../types'
import { tint } from '../../shared/statusTone'
import { TicketFichaModal } from './TicketFichaModal'

interface Props {
  tickets: TicketMantenimiento[]
  moneda: string
}

const PRIORIDAD_COLOR: Record<string, string> = {
  urgente: 'var(--at-danger)',
  alta:    'var(--at-warning)',
  media:   'var(--at-warning)',
  baja:    'var(--at-ink-3)',
}

const ESTADO_COLOR: Record<string, string> = {
  abierto:    'var(--at-ink-3)',
  en_proceso: 'var(--at-warning)',
  resuelto:   'var(--at-primary)',
  cerrado:    'var(--at-success)',
}

function diasDiff(desde: string, hasta: string): number {
  return Math.max(0, Math.ceil((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000))
}

export default function GanttMantenimientoTab({ tickets, moneda }: Props) {
  const hoy = hoyLocalISO()
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [filtroPrioridad, setFiltroPrioridad] = useState<string>('')
  const [verPor, setVerPor] = useState<'gantt' | 'stats'>('gantt')
  // La ficha se guarda por id para que siga a la fila recargada.
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const detalle = useMemo(() => (detalleId ? tickets.find(t => t.id === detalleId) ?? null : null), [tickets, detalleId])

  // Calcular ventana temporal
  const { fechaMin, rangoDias } = useMemo(() => {
    const fechas = tickets.map(t => t.created_at.slice(0, 10))
    const cierres = tickets.filter(t => t.fecha_cierre).map(t => t.fecha_cierre!.slice(0, 10))
    const min = [...fechas].sort()[0] ?? hoy
    const max = [...fechas, ...cierres, hoy].sort().reverse()[0]
    const dias = diasDiff(min, max) + 1
    return { fechaMin: min, rangoDias: Math.max(dias, 1) }
  }, [tickets, hoy])

  const ticketsFiltrados = useMemo(() =>
    tickets.filter(t =>
      (!filtroEstado || t.estado === filtroEstado) &&
      (!filtroPrioridad || t.prioridad === filtroPrioridad)
    ).sort((a, b) => b.created_at.localeCompare(a.created_at))
  , [tickets, filtroEstado, filtroPrioridad])

  /** Inicio, fin (hoy si sigue abierto) y duración de la barra de un ticket. */
  function tramo(t: TicketMantenimiento) {
    const inicio = t.created_at.slice(0, 10)
    const fin = t.fecha_cierre?.slice(0, 10) ?? hoy
    return { inicio, fin, duracion: diasDiff(inicio, fin), enCurso: !t.fecha_cierre }
  }

  function pctLeft(fecha: string): number {
    return (diasDiff(fechaMin, fecha) / rangoDias) * 100
  }
  function pctWidth(inicio: string, fin: string): number {
    return Math.max((diasDiff(inicio, fin) / rangoDias) * 100, 0.5)
  }

  // Stats por prioridad y tipo
  const stats = useMemo(() => {
    const cerrados = tickets.filter(t => t.estado === 'cerrado' && t.fecha_cierre)
    const porPrioridad = ['urgente', 'alta', 'media', 'baja'].map(p => {
      const grupo = cerrados.filter(t => t.prioridad === p)
      const avgDias = grupo.length > 0
        ? grupo.reduce((s, t) => s + diasDiff(t.created_at, t.fecha_cierre!), 0) / grupo.length
        : 0
      return { prioridad: p, count: grupo.length, avgDias }
    })
    const porTipo = ['correctivo', 'preventivo'].map(tp => {
      const grupo = cerrados.filter(t => t.tipo === tp)
      const avgDias = grupo.length > 0
        ? grupo.reduce((s, t) => s + diasDiff(t.created_at, t.fecha_cierre!), 0) / grupo.length
        : 0
      const costoTotal = grupo.reduce((s, t) => s + (t.costo_real ?? t.costo_estimado ?? 0), 0)
      return { tipo: tp, count: grupo.length, avgDias, costoTotal }
    })
    const totalAbiertos = tickets.filter(t => t.estado !== 'cerrado').length
    const conCosto = tickets.filter(t => t.costo_real != null).length
    const costoTotal = tickets.reduce((s, t) => s + (t.costo_real ?? 0), 0)
    return { porPrioridad, porTipo, totalAbiertos, conCosto, costoTotal, cerrados: cerrados.length }
  }, [tickets])

  const BTN = (active: boolean) => ({
    padding: '5px 14px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: 'pointer',
    background: active ? 'var(--at-ink)' : 'var(--at-surface)', color: active ? 'white' : 'var(--at-ink-2)', fontWeight: active ? 700 : 400,
  })

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Gantt de Mantenimiento</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
            {tickets.length} tickets · {stats.cerrados} cerrados · {stats.totalAbiertos} activos
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={BTN(verPor === 'gantt')} onClick={() => setVerPor('gantt')}>📊 Gantt</button>
          <button style={BTN(verPor === 'stats')} onClick={() => setVerPor('stats')}>📈 Estadísticas</button>
        </div>
      </div>

      {verPor === 'stats' ? (
        <>
          {/* Stats generales */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Tickets totales', val: String(tickets.length), color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)' },
              { label: 'Cerrados', val: String(stats.cerrados), color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
              { label: 'Activos', val: String(stats.totalAbiertos), color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
              { label: 'Costo total real', val: `${moneda} ${stats.costoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
            ].map(k => (
              <div key={k.label} style={{ flex: '1 1 110px', background: k.bg, border: `1px solid ${tint(k.color, 13)}`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Por prioridad */}
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Tiempo promedio de resolución por prioridad</div>
              {stats.porPrioridad.map(p => (
                <div key={p.prioridad} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: PRIORIDAD_COLOR[p.prioridad] }}>{p.prioridad}</span>
                    <span style={{ fontSize: 12, color: 'var(--at-ink-2)' }}>
                      {p.count > 0 ? `${Math.round(p.avgDias)} días prom. (${p.count} tickets)` : 'Sin datos'}
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--at-chip)', borderRadius: 4 }}>
                    <div style={{ height: 8, borderRadius: 4, background: PRIORIDAD_COLOR[p.prioridad],
                      width: `${Math.min((p.avgDias / 30) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Por tipo */}
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Por tipo de mantenimiento</div>
              {stats.porTipo.map(t => (
                <div key={t.tipo} style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--at-surface-2)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 6, textTransform: 'capitalize' }}>
                    {t.tipo === 'correctivo' ? '🔧' : '🔩'} {t.tipo}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--at-ink-2)' }}>
                    <span>{t.count} resueltos</span>
                    <span>{t.count > 0 ? `${Math.round(t.avgDias)} días prom.` : '—'}</span>
                    {t.costoTotal > 0 && <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{moneda} {t.costoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Filtros */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} aria-label="Estado"
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
              <option value="">Todos los estados</option>
              {['abierto', 'en_proceso', 'resuelto', 'cerrado'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value)} aria-label="Prioridad"
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, background: 'var(--at-surface)' }}>
              <option value="">Todas las prioridades</option>
              {['urgente', 'alta', 'media', 'baja'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--at-ink-3)', alignSelf: 'center' }}>
              {ticketsFiltrados.length} de {tickets.length} tickets
            </span>
          </div>

          {ticketsFiltrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)' }}>Sin tickets con ese filtro</div>
          ) : (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
              {/* Leyenda de estados */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--at-chip)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {Object.entries(ESTADO_COLOR).map(([est, color]) => (
                  <span key={est} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
                    {est.replace('_', ' ')}
                  </span>
                ))}
              </div>

              {/* Filas del Gantt: cada una abre la ficha del ticket en ventana
                  (antes sólo había un tooltip al pasar el ratón, que en el
                  teléfono no existe). */}
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {ticketsFiltrados.slice(0, 80).map(t => {
                  const { inicio, fin, duracion } = tramo(t)
                  const left = pctLeft(inicio)
                  const width = pctWidth(inicio, fin)
                  const color = ESTADO_COLOR[t.estado] ?? 'var(--at-ink-3)'
                  const abierto = detalleId === t.id
                  return (
                    <div key={t.id} role="button" tabIndex={0} aria-label={t.titulo}
                      onClick={() => setDetalleId(t.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetalleId(t.id) } }}
                      style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--at-surface-2)', minHeight: 36, cursor: 'pointer',
                        background: abierto ? 'var(--at-primary-tint)' : undefined }}>
                      {/* Etiqueta: hasta 200px en escritorio, ~38% en el teléfono para
                          que a la barra le quede sitio. */}
                      <div style={{ flex: '0 0 clamp(120px, 38%, 200px)', minWidth: 0, padding: '6px 10px', borderRight: '1px solid var(--at-chip)' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.titulo}</div>
                        <div style={{ fontSize: 9, color: PRIORIDAD_COLOR[t.prioridad] }}>{t.prioridad} · {t.tipo}</div>
                      </div>
                      {/* Bar area */}
                      <div style={{ flex: 1, position: 'relative', height: 36, padding: '4px 0' }}>
                        <div style={{
                          position: 'absolute',
                          left: `${left}%`,
                          width: `${width}%`,
                          top: 4, bottom: 4,
                          background: color,
                          opacity: 0.8,
                          borderRadius: 4,
                          display: 'flex', alignItems: 'center', paddingLeft: 4,
                          overflow: 'hidden',
                          minWidth: 24,
                        }}
                          title={`${t.titulo} · ${inicio} → ${fin} (${duracion} días)`}>
                          <span style={{ fontSize: 9, color: 'white', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {duracion}d
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {ticketsFiltrados.length > 80 && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: 'var(--at-ink-3)', borderTop: '1px solid var(--at-chip)' }}>
                  Mostrando primeros 80 tickets. Usa filtros para acotar.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Ficha del ticket en ventana (sólo lectura: esta pestaña no edita),
          con el tramo de la barra: inicio, fin y duración. */}
      {detalle && (() => {
        const { inicio, fin, duracion, enCurso } = tramo(detalle)
        return (
          <TicketFichaModal
            ticket={detalle}
            moneda={moneda}
            onClose={() => setDetalleId(null)}
            datosExtra={[
              { label: 'Inicio', value: inicio },
              { label: 'Fin', value: enCurso ? `En curso (hoy ${fin})` : fin },
              { label: 'Duración', value: `${duracion} día${duracion !== 1 ? 's' : ''}` },
            ]}
          />
        )
      })()}
    </div>
  )
}
