import { memo } from 'react'
import type { Registro, Contador, Proyecto, TipoAgua } from '../../types'
import { formatFechaCalendario } from '../../lib/format'

interface Props {
  registros: Registro[]
  contadores: Contador[]
  proyectos: Proyecto[]
  moneda: string
  selectedProjectId: string
  unidades: any[]
  fechaDesde?: string
  fechaHasta?: string
}

interface TipologiaStat {
  consumo: number
  monto: number
}

const TIPOLOGIA_META: Record<TipoAgua, { label: string; icon: string; from: string; to: string }> = {
  potable:             { label: 'Potable',             icon: '💧', from: 'var(--at-primary)', to: 'var(--at-primary-hover)' },
  rehuso:              { label: 'Rehúso',              icon: '♻️', from: 'var(--at-accent-2)', to: 'var(--at-ink-2)' },
  piscina:             { label: 'Piscina',             icon: '🏊', from: '#1F6F73', to: '#134E51' },
  desalinada:          { label: 'Desalinada',          icon: '🌊', from: 'var(--at-accent)', to: 'var(--at-accent-hover)' },
  riego:               { label: 'Riego',               icon: '🌿', from: '#0E9E6E', to: '#067352' },
  jacuzzi:             { label: 'Jacuzzi',             icon: '🛁', from: '#A87E1E', to: '#7E5E12' },
  consumo_humano:      { label: 'Consumo Humano',      icon: '🚰', from: '#5E6B2E', to: '#44501F' },
  desmineralizada:     { label: 'Desmineralizada',     icon: '🧪', from: '#45607A', to: '#2E4257' },
  residuales_tratadas: { label: 'Residuales Tratadas', icon: '🔄', from: '#E2620E', to: '#B84E08' },
}

function AdminConsumoTipologiaImpl({ registros, contadores, proyectos, moneda, selectedProjectId, unidades, fechaDesde, fechaHasta }: Props) {
  const contadorMap = new Map<string, { tipo_agua: TipoAgua; project_id: string }>()
  for (const c of contadores) {
    contadorMap.set(c.id, { tipo_agua: c.tipo_agua, project_id: c.project_id })
  }

  // Build client→project map via unidades for registros without contador
  const clienteProyectoMap = new Map<string, string>()
  for (const u of unidades) {
    if (u.cliente_id && u.project_id) clienteProyectoMap.set(u.cliente_id, u.project_id)
  }

  const mesActual = registros.filter(r => {
    const f = r.fecha.slice(0, 10)
    return (!fechaDesde || f >= fechaDesde) && (!fechaHasta || f <= fechaHasta)
  })

  // Aggregate by tipología
  const byTipologia = new Map<TipoAgua, TipologiaStat>()
  // Aggregate by project → tipología
  const byProject = new Map<string, Map<TipoAgua, TipologiaStat>>()

  for (const r of mesActual) {
    const info = r.contador_id ? contadorMap.get(r.contador_id) : undefined
    const tipo: TipoAgua = info?.tipo_agua ?? 'potable'
    const projectId = info?.project_id ?? clienteProyectoMap.get(r.cliente_id) ?? ''

    const consumo = parseFloat(String(r.consumo)) || 0
    const monto = r.monto_calculado ?? 0

    const cur = byTipologia.get(tipo) ?? { consumo: 0, monto: 0 }
    byTipologia.set(tipo, { consumo: cur.consumo + consumo, monto: cur.monto + monto })

    if (!selectedProjectId && projectId) {
      if (!byProject.has(projectId)) byProject.set(projectId, new Map())
      const pMap = byProject.get(projectId)!
      const pcur = pMap.get(tipo) ?? { consumo: 0, monto: 0 }
      pMap.set(tipo, { consumo: pcur.consumo + consumo, monto: pcur.monto + monto })
    }
  }

  const activeTipos = Array.from(byTipologia.entries()).filter(([, s]) => s.consumo > 0 || s.monto > 0)

  const activeProjects = proyectos.filter(p => p.estado === 'activo' && byProject.has(p.id))
  const allTipos = Array.from(new Set(activeTipos.map(([t]) => t)))
  const showProjectTable = !selectedProjectId && activeProjects.length > 1

  const hoy = new Date()
  const fmtDate = (s?: string) => formatFechaCalendario(s, { day: 'numeric', month: 'short', year: 'numeric' }, 'es')
  const rangoLabel = fechaDesde && fechaHasta
    ? `${fmtDate(fechaDesde)} — ${fmtDate(fechaHasta)}`
    : hoy.toLocaleString('es', { month: 'long', year: 'numeric' })

  return (
    <div style={{ marginBottom: '32px' }}>
      <h3 style={{
        fontSize: '13px',
        fontWeight: 700,
        color: 'var(--at-ink-3)',
        marginBottom: '12px',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        💧 Consumo por Tipología — {rangoLabel.charAt(0).toUpperCase() + rangoLabel.slice(1)}
      </h3>

      {/* Cards por tipología */}
      {activeTipos.length === 0 ? (
        <div style={{ color: 'var(--at-ink-3)', fontSize: '13px', padding: '12px 0' }}>
          Sin consumo registrado este mes.
        </div>
      ) : (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '14px',
        marginBottom: showProjectTable ? '24px' : 0,
      }}>
        {activeTipos.map(([tipo, stat]) => {
          const meta = TIPOLOGIA_META[tipo] ?? { label: tipo, icon: '💧', from: 'var(--at-ink-3)', to: 'var(--at-ink-2)' }
          return (
            <div
              key={tipo}
              style={{
                background: `linear-gradient(135deg, ${meta.from}, ${meta.to})`,
                borderRadius: '14px',
                padding: '18px 20px',
                color: 'white',
                boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              }}
            >
              <div style={{ fontSize: '18px', marginBottom: '6px' }}>{meta.icon}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, opacity: 0.9, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {meta.label}
              </div>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>
                    {stat.consumo.toFixed(1)}
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>m³</div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.3)', paddingLeft: '16px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, lineHeight: 1 }}>
                    {stat.monto.toFixed(0)}
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>{moneda}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}

      {/* Desglose por proyecto cuando se ven todos */}
      {showProjectTable && (
        <div className="table-scroll-wrapper">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-2)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>
                  Proyecto
                </th>
                {allTipos.map(tipo => {
                  const meta = TIPOLOGIA_META[tipo]
                  return (
                    <th
                      key={tipo}
                      colSpan={2}
                      style={{ padding: '10px 8px', textAlign: 'center', fontWeight: 700, color: meta?.from ?? 'var(--at-ink-3)', borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}
                    >
                      {meta?.icon} {meta?.label ?? tipo}
                    </th>
                  )
                })}
              </tr>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                <th style={{ padding: '4px 14px', borderBottom: '2px solid var(--at-line)' }} />
                {allTipos.flatMap(tipo => [
                  <th key={`${tipo}-m3`} style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--at-ink-3)', borderBottom: '2px solid var(--at-line)', fontSize: '10px' }}>m³</th>,
                  <th key={`${tipo}-q`} style={{ padding: '4px 8px', textAlign: 'center', fontWeight: 600, color: 'var(--at-ink-3)', borderBottom: '2px solid var(--at-line)', fontSize: '10px' }}>{moneda}</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {activeProjects.map((p, i) => {
                const pMap = byProject.get(p.id)
                return (
                  <tr
                    key={p.id}
                    style={{ background: i % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)' }}
                  >
                    <td style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--at-ink)', borderBottom: '1px solid var(--at-chip)', whiteSpace: 'nowrap' }}>
                      {p.nombre}
                    </td>
                    {allTipos.flatMap(tipo => {
                      const s = pMap?.get(tipo)
                      return [
                        <td key={`${tipo}-m3`} style={{ padding: '9px 8px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', color: s?.consumo ? 'var(--at-ink)' : 'var(--at-line-strong)', fontWeight: s?.consumo ? 600 : 400 }}>
                          {s?.consumo ? s.consumo.toFixed(1) : '—'}
                        </td>,
                        <td key={`${tipo}-q`} style={{ padding: '9px 8px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', color: s?.monto ? 'var(--at-ink)' : 'var(--at-line-strong)', fontWeight: s?.monto ? 600 : 400 }}>
                          {s?.monto ? s.monto.toFixed(0) : '—'}
                        </td>,
                      ]
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export const AdminConsumoTipologia = memo(AdminConsumoTipologiaImpl)
