import type { Registro, Contador, Proyecto, TipoAgua } from '../../types'

interface Props {
  registros: Registro[]
  contadores: Contador[]
  proyectos: Proyecto[]
  unidades: any[]
  moneda: string
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

export function AdminResumenProyectos({ registros, contadores, proyectos, unidades, moneda }: Props) {
  const hoy = new Date()
  const mesActual = registros.filter(r => new Date(r.fecha).getMonth() === hoy.getMonth())

  const contadorMap = new Map<string, { tipo_agua: TipoAgua; project_id: string }>()
  for (const c of contadores) {
    contadorMap.set(c.id, { tipo_agua: c.tipo_agua, project_id: c.project_id })
  }

  const clienteProyectoMap = new Map<string, string>()
  for (const u of unidades) {
    if (u.cliente_id && u.project_id) clienteProyectoMap.set(u.cliente_id, u.project_id)
  }

  const byProject = new Map<string, ProyectoStats>()

  for (const r of mesActual) {
    const info = r.contador_id ? contadorMap.get(r.contador_id) : undefined
    const tipo: TipoAgua = info?.tipo_agua ?? 'potable'
    const projectId = info?.project_id ?? clienteProyectoMap.get(r.cliente_id) ?? ''
    if (!projectId) continue

    if (!byProject.has(projectId)) {
      byProject.set(projectId, { totalM3: 0, totalMonto: 0, byTipo: new Map() })
    }
    const ps = byProject.get(projectId)!
    const consumo = parseFloat(String(r.consumo)) || 0
    const monto = r.monto_calculado ?? 0
    ps.totalM3 += consumo
    ps.totalMonto += monto
    ps.byTipo.set(tipo, (ps.byTipo.get(tipo) ?? 0) + consumo)
  }

  const activeProjects = proyectos.filter(p => p.estado === 'activo' && byProject.has(p.id))
  if (activeProjects.length < 2) return null

  // Dynamic tipo columns: only tipos with any m³
  const activeTipos = Array.from(
    new Set(activeProjects.flatMap(p => Array.from(byProject.get(p.id)!.byTipo.keys())))
  ) as TipoAgua[]

  // Totals row
  const totals: ProyectoStats = { totalM3: 0, totalMonto: 0, byTipo: new Map() }
  for (const p of activeProjects) {
    const ps = byProject.get(p.id)!
    totals.totalM3 += ps.totalM3
    totals.totalMonto += ps.totalMonto
    for (const [tipo, m3] of ps.byTipo) {
      totals.byTipo.set(tipo, (totals.byTipo.get(tipo) ?? 0) + m3)
    }
  }

  const mesNombre = hoy.toLocaleString('es', { month: 'long', year: 'numeric' })

  const thStyle = (color?: string) => ({
    padding: '10px 10px',
    textAlign: 'center' as const,
    fontWeight: 700,
    color: color ?? '#475569',
    borderBottom: '2px solid #e2e8f0',
    whiteSpace: 'nowrap' as const,
    fontSize: '12px',
  })

  const tdNum = (val: number | undefined, bold?: boolean, color?: string) => ({
    padding: '9px 10px',
    textAlign: 'center' as const,
    borderBottom: '1px solid #f1f5f9',
    fontWeight: bold || (val && val > 0) ? 600 : 400,
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
        📋 Resumen por Proyecto — {mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1)}
      </h3>

      <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid #e2e8f0', background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              <th style={{ ...thStyle(), textAlign: 'left', padding: '10px 14px' }}>Proyecto</th>
              <th style={thStyle('#0f172a')}>Total m³</th>
              {activeTipos.map(tipo => {
                const meta = TIPOLOGIA_META[tipo]
                return (
                  <th key={tipo} style={thStyle(meta?.color)}>
                    {meta?.icon} {meta?.label ?? tipo} m³
                  </th>
                )
              })}
              <th style={thStyle('#059669')}>Recaudo {moneda}</th>
            </tr>
          </thead>
          <tbody>
            {activeProjects.map((p, i) => {
              const ps = byProject.get(p.id)!
              return (
                <tr
                  key={p.id}
                  style={{ background: i % 2 === 0 ? 'white' : '#f8fafc' }}
                >
                  <td style={{ padding: '9px 14px', fontWeight: 600, color: '#0f172a', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                    {p.nombre}
                  </td>
                  <td style={tdNum(ps.totalM3, true, '#0ea5e9')}>
                    {ps.totalM3 > 0 ? ps.totalM3.toFixed(1) : '—'}
                  </td>
                  {activeTipos.map(tipo => {
                    const m3 = ps.byTipo.get(tipo)
                    const meta = TIPOLOGIA_META[tipo]
                    return (
                      <td key={tipo} style={tdNum(m3, false, meta?.color)}>
                        {m3 && m3 > 0 ? m3.toFixed(1) : '—'}
                      </td>
                    )
                  })}
                  <td style={tdNum(ps.totalMonto, true, '#059669')}>
                    {ps.totalMonto > 0 ? ps.totalMonto.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                  </td>
                </tr>
              )
            })}

            {/* Fila de totales */}
            <tr style={{ background: '#f1f5f9', borderTop: '2px solid #e2e8f0' }}>
              <td style={{ padding: '10px 14px', fontWeight: 700, color: '#0f172a', fontSize: '12px' }}>
                Total
              </td>
              <td style={{ padding: '10px', textAlign: 'center', fontWeight: 800, color: '#0ea5e9', fontSize: '13px' }}>
                {totals.totalM3.toFixed(1)}
              </td>
              {activeTipos.map(tipo => {
                const m3 = totals.byTipo.get(tipo)
                const meta = TIPOLOGIA_META[tipo]
                return (
                  <td key={tipo} style={{ padding: '10px', textAlign: 'center', fontWeight: 700, color: meta?.color ?? '#0f172a', fontSize: '12px' }}>
                    {m3 && m3 > 0 ? m3.toFixed(1) : '—'}
                  </td>
                )
              })}
              <td style={{ padding: '10px', textAlign: 'center', fontWeight: 800, color: '#059669', fontSize: '13px' }}>
                {totals.totalMonto.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
