import { useState, useMemo } from 'react'
import { TicketMantenimiento, SugerenciaCondominio, Visitante, CuotaCondominio } from '../../../types'

interface Props {
  tickets: TicketMantenimiento[]
  sugerencias: SugerenciaCondominio[]
  visitantes: Visitante[]
  cuotas: CuotaCondominio[]
  moneda: string
}

function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100) }

function tiempoResolucion(tickets: TicketMantenimiento[]): number {
  const resueltos = tickets.filter(t => (t.estado === 'resuelto' || t.estado === 'cerrado') && t.created_at && t.fecha_cierre)
  if (resueltos.length === 0) return 0
  const total = resueltos.reduce((s, t) => {
    const dias = Math.floor((new Date(t.fecha_cierre!).getTime() - new Date(t.created_at).getTime()) / 86400000)
    return s + Math.max(0, dias)
  }, 0)
  return Math.round(total / resueltos.length)
}

export default function MetricasServicioTab({ tickets, sugerencias, visitantes, cuotas }: Props) {
  const periodos = useMemo(() => [...new Set(cuotas.map(c => c.periodo).filter(Boolean))].sort().reverse(), [cuotas])
  const [filtroPeriodo, setFiltroPeriodo] = useState(periodos[0] ?? '')

  const ym = filtroPeriodo
  const ticketsMes = tickets.filter(t => t.created_at?.startsWith(ym))
  const sugerenciasMes = sugerencias.filter(s => s.created_at?.startsWith(ym))
  const cuotasMes = cuotas.filter(c => c.periodo === ym)

  const tasaResolucionTickets = pct(ticketsMes.filter(t => t.estado === 'resuelto' || t.estado === 'cerrado').length, ticketsMes.length)
  const tasaRespuestaSugerencias = pct(sugerenciasMes.filter(s => s.estado === 'respondida').length, sugerenciasMes.length)
  const tasaRecaudacion = pct(cuotasMes.filter(c => c.estado === 'pagado').length, cuotasMes.length)
  const diasPromedioResolucion = tiempoResolucion(ticketsMes)

  // Tickets por prioridad
  const porPrioridad = ['urgente', 'alta', 'media', 'baja'].map(p => ({
    prioridad: p, count: tickets.filter(t => t.prioridad === p).length,
  }))
  const maxPrioridad = Math.max(...porPrioridad.map(p => p.count), 1)

  // Tickets por estado
  const porEstado = ['abierto', 'en_proceso', 'resuelto', 'cerrado'].map(e => ({
    estado: e, count: tickets.filter(t => t.estado === e).length,
  }))

  // Tendencia de tickets últimos 6 meses
  const ultimos6 = periodos.slice(0, 6).reverse()
  const tendTickets = ultimos6.map(p => ({
    periodo: p,
    total: tickets.filter(t => t.created_at?.startsWith(p)).length,
    resueltos: tickets.filter(t => t.created_at?.startsWith(p) && (t.estado === 'resuelto' || t.estado === 'cerrado')).length,
    visitantes: visitantes.filter(v => v.hora_entrada?.startsWith(p)).length,
  }))
  const maxTend = Math.max(...tendTickets.map(t => Math.max(t.total, t.visitantes)), 1)

  // Sugerencias por categoría
  const porCategoria = ['instalaciones', 'seguridad', 'servicios', 'convivencia', 'otro'].map(cat => ({
    cat, count: sugerencias.filter(s => s.categoria === cat).length,
  })).filter(c => c.count > 0)
  const maxCat = Math.max(...porCategoria.map(c => c.count), 1)

  const CAT_ICON: Record<string, string> = { instalaciones: '🔧', seguridad: '🛡️', servicios: '🧹', convivencia: '🤝', otro: '💬' }
  const PRIOR_COLOR: Record<string, string> = { urgente: 'var(--at-danger)', alta: 'var(--at-warning)', media: 'var(--at-warning)', baja: 'var(--at-success-border)' }
  const ESTADO_COLOR: Record<string, string> = { abierto: 'var(--at-danger)', en_proceso: 'var(--at-warning)', resuelto: 'var(--at-success)', cerrado: 'var(--at-ink-3)' }

  function kpiCard(label: string, val: string | number, sub: string, color: string, bg: string) {
    return (
      <div style={{ background: bg, borderRadius: 10, padding: '12px 16px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color }}>{val}</div>
        <div style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>{sub}</div>}
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Filtro período */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--at-ink)' }}>Métricas de servicio del período</div>
        <select value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
          {periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* KPIs del período */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {kpiCard('Tickets del período', ticketsMes.length, `${tasaResolucionTickets}% resueltos`, 'var(--at-accent-hover)', 'var(--at-accent-tint-2)')}
        {kpiCard('Tiempo prom. resolución', diasPromedioResolucion === 0 ? '—' : `${diasPromedioResolucion}d`, 'días hábiles estimados', diasPromedioResolucion <= 3 ? 'var(--at-success)' : diasPromedioResolucion <= 7 ? 'var(--at-warning)' : 'var(--at-danger)', diasPromedioResolucion <= 3 ? 'var(--at-success-tint)' : diasPromedioResolucion <= 7 ? 'var(--at-warning-tint)' : 'var(--at-danger-tint)')}
        {kpiCard('Sugerencias respondidas', `${tasaRespuestaSugerencias}%`, `${sugerenciasMes.filter(s => s.estado === 'respondida').length} de ${sugerenciasMes.length}`, tasaRespuestaSugerencias >= 80 ? 'var(--at-success)' : 'var(--at-warning)', tasaRespuestaSugerencias >= 80 ? 'var(--at-success-tint)' : 'var(--at-warning-tint)')}
        {kpiCard('Tasa de recaudación', `${tasaRecaudacion}%`, `${cuotasMes.filter(c => c.estado === 'pagado').length} de ${cuotasMes.length} cuotas`, tasaRecaudacion >= 80 ? 'var(--at-success)' : tasaRecaudacion >= 60 ? 'var(--at-warning)' : 'var(--at-danger)', tasaRecaudacion >= 80 ? 'var(--at-success-tint)' : tasaRecaudacion >= 60 ? 'var(--at-warning-tint)' : 'var(--at-danger-tint)')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Tickets por prioridad */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Tickets por prioridad (total)</div>
          {porPrioridad.map(({ prioridad, count }) => (
            <div key={prioridad} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ textTransform: 'capitalize', color: 'var(--at-ink-2)' }}>{prioridad}</span>
                <span style={{ fontWeight: 600, color: PRIOR_COLOR[prioridad] }}>{count}</span>
              </div>
              <div style={{ background: 'var(--at-chip)', borderRadius: 4, height: 6 }}>
                <div style={{ height: '100%', background: PRIOR_COLOR[prioridad], width: `${(count / maxPrioridad) * 100}%`, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Tickets por estado */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Estado actual de tickets</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {porEstado.map(({ estado, count }) => (
              <div key={estado} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: ESTADO_COLOR[estado] }}>{count}</div>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', textTransform: 'capitalize' }}>{estado.replace('_', ' ')}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Tendencia tickets + visitantes */}
        {tendTickets.length > 0 && (
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Tendencia mensual (últimos {tendTickets.length} meses)</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 100, marginBottom: 6 }}>
              {tendTickets.map(t => (
                <div key={t.periodo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', height: 90 }}>
                    <div style={{ flex: 1, background: 'var(--at-accent-light)', borderRadius: '2px 2px 0 0', height: `${(t.total / maxTend) * 100}%`, minHeight: 2 }} title={`Tickets: ${t.total}`} />
                    <div style={{ flex: 1, background: 'var(--at-success-border)', borderRadius: '2px 2px 0 0', height: `${(t.visitantes / maxTend) * 100}%`, minHeight: 2 }} title={`Visitantes: ${t.visitantes}`} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--at-ink-3)' }}>{t.periodo.slice(2)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--at-ink-3)' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-accent-light)', borderRadius: 2, marginRight: 4 }} />Tickets</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-success-border)', borderRadius: 2, marginRight: 4 }} />Visitantes</span>
            </div>
          </div>
        )}

        {/* Sugerencias por categoría */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Sugerencias por categoría</div>
          {porCategoria.length === 0
            ? <div style={{ color: 'var(--at-ink-3)', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>Sin sugerencias</div>
            : porCategoria.map(({ cat, count }) => (
              <div key={cat} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: 'var(--at-ink-2)' }}>{CAT_ICON[cat]} {cat}</span>
                  <span style={{ fontWeight: 600, color: 'var(--at-accent)' }}>{count}</span>
                </div>
                <div style={{ background: 'var(--at-chip)', borderRadius: 4, height: 6 }}>
                  <div style={{ height: '100%', background: 'var(--at-accent-soft)', width: `${(count / maxCat) * 100}%`, borderRadius: 4 }} />
                </div>
              </div>
            ))
          }
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--at-accent-tint-2)', borderRadius: 8, fontSize: 11, color: 'var(--at-ink-3)' }}>
            Respondidas: <strong style={{ color: 'var(--at-accent)' }}>{pct(sugerencias.filter(s => s.estado === 'respondida').length, sugerencias.length)}%</strong> del total
          </div>
        </div>
      </div>
    </div>
  )
}
