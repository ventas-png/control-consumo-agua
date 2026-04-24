import { useState, useMemo } from 'react'
import { TicketMantenimiento } from '../../../types'

interface Props {
  tickets: TicketMantenimiento[]
  moneda: string
}

const PRIORIDAD_COLOR: Record<string, string> = {
  urgente: '#ef4444',
  alta:    '#f97316',
  media:   '#d97706',
  baja:    '#64748b',
}

const ESTADO_COLOR: Record<string, string> = {
  abierto:    '#64748b',
  en_proceso: '#d97706',
  resuelto:   '#2563eb',
  cerrado:    '#16a34a',
}

function diasDiff(desde: string, hasta: string): number {
  return Math.max(0, Math.ceil((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000))
}

export default function GanttMantenimientoTab({ tickets, moneda }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroEstado, setFiltroEstado] = useState<string>('')
  const [filtroPrioridad, setFiltroPrioridad] = useState<string>('')
  const [verPor, setVerPor] = useState<'gantt' | 'stats'>('gantt')

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
    padding: '5px 14px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, cursor: 'pointer',
    background: active ? '#0f172a' : '#fff', color: active ? '#fff' : '#374151', fontWeight: active ? 700 : 400,
  })

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Gantt de Mantenimiento</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
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
              { label: 'Tickets totales', val: String(tickets.length), color: '#374151', bg: '#f8fafc' },
              { label: 'Cerrados', val: String(stats.cerrados), color: '#16a34a', bg: '#dcfce7' },
              { label: 'Activos', val: String(stats.totalAbiertos), color: '#d97706', bg: '#fef3c7' },
              { label: 'Costo total real', val: `${moneda} ${stats.costoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#2563eb', bg: '#eff6ff' },
            ].map(k => (
              <div key={k.label} style={{ flex: '1 1 110px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: '#6b7280' }}>{k.label}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Por prioridad */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 12 }}>Tiempo promedio de resolución por prioridad</div>
              {stats.porPrioridad.map(p => (
                <div key={p.prioridad} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: PRIORIDAD_COLOR[p.prioridad] }}>{p.prioridad}</span>
                    <span style={{ fontSize: 12, color: '#374151' }}>
                      {p.count > 0 ? `${Math.round(p.avgDias)} días prom. (${p.count} tickets)` : 'Sin datos'}
                    </span>
                  </div>
                  <div style={{ height: 8, background: '#f1f5f9', borderRadius: 4 }}>
                    <div style={{ height: 8, borderRadius: 4, background: PRIORIDAD_COLOR[p.prioridad],
                      width: `${Math.min((p.avgDias / 30) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Por tipo */}
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 12 }}>Por tipo de mantenimiento</div>
              {stats.porTipo.map(t => (
                <div key={t.tipo} style={{ marginBottom: 16, padding: '10px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 6, textTransform: 'capitalize' }}>
                    {t.tipo === 'correctivo' ? '🔧' : '🔩'} {t.tipo}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#374151' }}>
                    <span>{t.count} resueltos</span>
                    <span>{t.count > 0 ? `${Math.round(t.avgDias)} días prom.` : '—'}</span>
                    {t.costoTotal > 0 && <span style={{ color: '#2563eb', fontWeight: 600 }}>{moneda} {t.costoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}</span>}
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
            <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, background: '#fff' }}>
              <option value="">Todos los estados</option>
              {['abierto', 'en_proceso', 'resuelto', 'cerrado'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <select value={filtroPrioridad} onChange={e => setFiltroPrioridad(e.target.value)}
              style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 12, background: '#fff' }}>
              <option value="">Todas las prioridades</option>
              {['urgente', 'alta', 'media', 'baja'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <span style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>
              {ticketsFiltrados.length} de {tickets.length} tickets
            </span>
          </div>

          {ticketsFiltrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>Sin tickets con ese filtro</div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
              {/* Leyenda de estados */}
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {Object.entries(ESTADO_COLOR).map(([est, color]) => (
                  <span key={est} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                    <span style={{ width: 10, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
                    {est.replace('_', ' ')}
                  </span>
                ))}
              </div>

              {/* Gantt rows */}
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {ticketsFiltrados.slice(0, 80).map(t => {
                  const inicio = t.created_at.slice(0, 10)
                  const fin = t.fecha_cierre?.slice(0, 10) ?? hoy
                  const left = pctLeft(inicio)
                  const width = pctWidth(inicio, fin)
                  const duracion = diasDiff(inicio, fin)
                  const color = ESTADO_COLOR[t.estado] ?? '#64748b'
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #f8fafc', minHeight: 36 }}>
                      {/* Label */}
                      <div style={{ width: 200, flexShrink: 0, padding: '6px 10px', borderRight: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#0f172a', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{t.titulo}</div>
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
                          <span style={{ fontSize: 9, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {duracion}d
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {ticketsFiltrados.length > 80 && (
                <div style={{ padding: '8px 14px', fontSize: 11, color: '#9ca3af', borderTop: '1px solid #f1f5f9' }}>
                  Mostrando primeros 80 tickets. Usa filtros para acotar.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
