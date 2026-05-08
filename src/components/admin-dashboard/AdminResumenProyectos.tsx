import type { Registro, Contador, Proyecto, Unidad, TipoAgua } from '../../types'

interface Props {
  registros: Registro[]
  contadores: Contador[]
  proyectos: Proyecto[]
  unidades: Unidad[]
  moneda: string
  fechaDesde?: string
  fechaHasta?: string
}

const TIPOLOGIA_META: Partial<Record<TipoAgua, { label: string; icon: string; color: string }>> = {
  potable:             { label: 'Potable',             icon: '💧', color: '#0ea5e9' },
  rehuso:              { label: 'Rehúso',              icon: '♻️', color: '#06b6d4' },
  piscina:             { label: 'Piscina',             icon: '🏊', color: '#38bdf8' },
  desalinada:          { label: 'Desalinada',          icon: '🌊', color: '#6366f1' },
  riego:               { label: 'Riego',               icon: '🌿', color: '#10b981' },
  jacuzzi:             { label: 'Jacuzzi',             icon: '🛁', color: '#8b5cf6' },
  consumo_humano:      { label: 'Consumo Humano',      icon: '🚰', color: '#14b8a6' },
  desmineralizada:     { label: 'Desmineralizada',     icon: '🧪', color: '#a855f7' },
  residuales_tratadas: { label: 'Residuales Tratadas', icon: '🔄', color: '#f97316' },
}

interface ProyectoStats {
  totalM3: number
  totalMonto: number
  byTipo: Map<TipoAgua, number>
}

export function AdminResumenProyectos({ registros, contadores, proyectos, unidades, moneda, fechaDesde, fechaHasta }: Props) {
  const hoy = new Date()
  const mesActual = registros.filter(r => {
    const f = r.fecha.slice(0, 10)
    return (!fechaDesde || f >= fechaDesde) && (!fechaHasta || f <= fechaHasta)
  })

  // contador_id → tipo_agua (for typology breakdown)
  const contadorTipoMap = new Map<string, TipoAgua>()
  for (const c of contadores) {
    contadorTipoMap.set(c.id, c.tipo_agua)
  }

  const activeProyectos = proyectos.filter(p => p.estado === 'activo')

  // Per-project stats using the same reliable approach as AdminClientDashboard:
  // filter registros by client IDs linked to each project via unidades
  const byProject = new Map<string, ProyectoStats>()

  for (const p of activeProyectos) {
    const clienteIds = new Set(
      unidades
        .filter(u => u.project_id === p.id && u.cliente_id)
        .map(u => u.cliente_id as string)
    )
    const regs = mesActual.filter(r =>
      r.project_id
        ? r.project_id === p.id
        : clienteIds.has(r.cliente_id)
    )
    if (regs.length === 0) continue

    const stats: ProyectoStats = { totalM3: 0, totalMonto: 0, byTipo: new Map() }
    for (const r of regs) {
      const consumo = parseFloat(String(r.consumo)) || 0
      const monto = r.monto_calculado ?? 0
      const tipo: TipoAgua = (r.contador_id ? contadorTipoMap.get(r.contador_id) : undefined) ?? 'potable'
      stats.totalM3 += consumo
      stats.totalMonto += monto
      stats.byTipo.set(tipo, (stats.byTipo.get(tipo) ?? 0) + consumo)
    }
    byProject.set(p.id, stats)
  }

  const proyectosConDatos = activeProyectos.filter(p => byProject.has(p.id))
  if (proyectosConDatos.length < 2) return null

  // Dynamic columns: tipologías with data in any project
  const activeTipos = Array.from(
    new Set(proyectosConDatos.flatMap(p => Array.from(byProject.get(p.id)!.byTipo.keys())))
  ) as TipoAgua[]

  // Totals row
  const totals: ProyectoStats = { totalM3: 0, totalMonto: 0, byTipo: new Map() }
  for (const p of proyectosConDatos) {
    const ps = byProject.get(p.id)!
    totals.totalM3 += ps.totalM3
    totals.totalMonto += ps.totalMonto
    for (const [tipo, m3] of ps.byTipo) {
      totals.byTipo.set(tipo, (totals.byTipo.get(tipo) ?? 0) + m3)
    }
  }

  const fmtDate = (s?: string) => s ? new Date(s + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const rangoLabel = fechaDesde && fechaHasta
    ? `${fmtDate(fechaDesde)} — ${fmtDate(fechaHasta)}`
    : hoy.toLocaleString('es', { month: 'long', year: 'numeric' })

  const th = (color?: string, center = true) => ({
    padding: '10px 12px',
    textAlign: center ? ('center' as const) : ('left' as const),
    fontWeight: 700,
    color: color ?? '#475569',
    borderBottom: '2px solid #e2e8f0',
    whiteSpace: 'nowrap' as const,
    fontSize: '12px',
    background: '#f8fafc',
  })

  const tdVal = (val: number | undefined, color?: string) => ({
    padding: '10px 12px',
    textAlign: 'center' as const,
    borderBottom: '1px solid #f1f5f9',
    fontWeight: val && val > 0 ? 600 : 400,
    color: val && val > 0 ? (color ?? '#0f172a') : '#cbd5e1',
    fontSize: '12px',
  })

  return (
    <div style={{ marginBottom: '28px' }}>
      <h3 style={{
        fontSize: '13px',
        fontWeight: 700,
        color: '#94a3b8',
        marginBottom: '12px',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        📋 Consumo por Proyecto — {rangoLabel.charAt(0).toUpperCase() + rangoLabel.slice(1)}
      </h3>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr>
              <th style={th(undefined, false)}>Proyecto</th>
              <th style={th('#0ea5e9')}>💧 Total m³</th>
              {activeTipos.map(tipo => {
                const meta = TIPOLOGIA_META[tipo]
                return (
                  <th key={tipo} style={th(meta?.color)}>
                    {meta?.icon} {meta?.label ?? tipo} m³
                  </th>
                )
              })}
              <th style={th('#059669')}>Recaudo {moneda}</th>
            </tr>
          </thead>
          <tbody>
            {proyectosConDatos.map((p, i) => {
              const ps = byProject.get(p.id)!
              return (
                <tr
                  key={p.id}
                  style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}
                  onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = '#eff6ff'}
                  onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'white' : '#f8fafc'}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                    {p.nombre}
                  </td>
                  <td style={tdVal(ps.totalM3, '#0ea5e9')}>
                    {ps.totalM3 > 0 ? ps.totalM3.toFixed(1) : '—'}
                  </td>
                  {activeTipos.map(tipo => {
                    const m3 = ps.byTipo.get(tipo)
                    const meta = TIPOLOGIA_META[tipo]
                    return (
                      <td key={tipo} style={tdVal(m3, meta?.color)}>
                        {m3 && m3 > 0 ? m3.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  <td style={tdVal(ps.totalMonto, '#059669')}>
                    {ps.totalMonto > 0
                      ? ps.totalMonto.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : '—'}
                  </td>
                </tr>
              )
            })}

            {/* Totals row */}
            <tr style={{ background: '#f1f5f9', borderTop: '2px solid #e2e8f0' }}>
              <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a', fontSize: '13px' }}>
                Total
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: '#0ea5e9', fontSize: '13px' }}>
                {totals.totalM3.toFixed(1)}
              </td>
              {activeTipos.map(tipo => {
                const m3 = totals.byTipo.get(tipo)
                const meta = TIPOLOGIA_META[tipo]
                return (
                  <td key={tipo} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: meta?.color ?? '#0f172a', fontSize: '12px' }}>
                    {m3 && m3 > 0 ? m3.toFixed(1) : '—'}
                  </td>
                )
              })}
              <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                {totals.totalMonto.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
