import { memo } from 'react'
import type { Registro, Contador, Proyecto, Unidad, TipoAgua } from '../../types'
import { DataTable, type DataTableColumn } from '../shared/DataTable'
import { formatFechaCalendario } from '../../lib/format'

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
  potable:             { label: 'Potable',             icon: '💧', color: 'var(--at-primary)' },
  rehuso:              { label: 'Rehúso',              icon: '♻️', color: 'var(--at-accent-2)' },
  piscina:             { label: 'Piscina',             icon: '🏊', color: 'var(--at-accent-2)' },
  desalinada:          { label: 'Desalinada',          icon: '🌊', color: 'var(--at-accent)' },
  riego:               { label: 'Riego',               icon: '🌿', color: 'var(--at-success)' },
  jacuzzi:             { label: 'Jacuzzi',             icon: '🛁', color: 'var(--at-accent)' },
  consumo_humano:      { label: 'Consumo Humano',      icon: '🚰', color: 'var(--at-accent-2)' },
  desmineralizada:     { label: 'Desmineralizada',     icon: '🧪', color: 'var(--at-accent)' },
  residuales_tratadas: { label: 'Residuales Tratadas', icon: '🔄', color: 'var(--at-warning)' },
}

interface ProyectoStats {
  totalM3: number
  totalMonto: number
  byTipo: Map<TipoAgua, number>
}

function AdminResumenProyectosImpl({ registros, contadores, proyectos, unidades, moneda, fechaDesde, fechaHasta }: Props) {
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

  const fmtDate = (s?: string) => formatFechaCalendario(s, { day: 'numeric', month: 'short', year: 'numeric' }, 'es')
  const rangoLabel = fechaDesde && fechaHasta
    ? `${fmtDate(fechaDesde)} — ${fmtDate(fechaHasta)}`
    : hoy.toLocaleString('es', { month: 'long', year: 'numeric' })

  const renderVal = (val: number | undefined, color?: string, decimals = 1) => (
    <span style={{
      fontWeight: val && val > 0 ? 600 : 400,
      color: val && val > 0 ? (color ?? 'var(--at-ink)') : 'var(--at-line-strong)',
    }}>
      {val && val > 0 ? val.toFixed(decimals) : '—'}
    </span>
  )

  const columns: DataTableColumn<Proyecto>[] = [
    {
      key: 'nombre', header: 'Proyecto', sortable: true,
      accessor: p => p.nombre,
      render: p => <span style={{ fontWeight: 600, color: 'var(--at-ink)', whiteSpace: 'nowrap' }}>{p.nombre}</span>,
    },
    {
      key: 'totalM3', header: '💧 Total m³', sortable: true, align: 'center',
      accessor: p => byProject.get(p.id)?.totalM3 ?? 0,
      render: p => renderVal(byProject.get(p.id)?.totalM3, 'var(--at-primary)'),
    },
    ...activeTipos.map<DataTableColumn<Proyecto>>(tipo => {
      const meta = TIPOLOGIA_META[tipo]
      return {
        key: `tipo-${tipo}`,
        header: <span style={{ color: meta?.color }}>{meta?.icon} {meta?.label ?? tipo} m³</span>,
        sortable: true,
        align: 'center',
        accessor: p => byProject.get(p.id)?.byTipo.get(tipo) ?? 0,
        render: p => renderVal(byProject.get(p.id)?.byTipo.get(tipo), meta?.color),
        hideOnMobile: true,
      }
    }),
    {
      key: 'totalMonto', header: `Recaudo ${moneda}`, sortable: true, align: 'center',
      accessor: p => byProject.get(p.id)?.totalMonto ?? 0,
      render: p => {
        const v = byProject.get(p.id)?.totalMonto
        return (
          <span style={{
            fontWeight: v && v > 0 ? 600 : 400,
            color: v && v > 0 ? 'var(--at-success-strong)' : 'var(--at-line-strong)',
          }}>
            {v && v > 0 ? v.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          </span>
        )
      },
    },
  ]

  return (
    <div style={{ marginBottom: '28px' }}>
      <h3 style={{
        fontSize: '13px',
        fontWeight: 700,
        color: 'var(--at-ink-3)',
        marginBottom: '12px',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        📋 Consumo por Proyecto — {rangoLabel.charAt(0).toUpperCase() + rangoLabel.slice(1)}
      </h3>

      <DataTable<Proyecto>
        data={proyectosConDatos}
        columns={columns}
        rowKey="id"
        pageSize={0}
        defaultSort={{ key: 'totalM3', direction: 'desc' }}
        footer={
          <tr>
            <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--at-ink)', fontSize: '13px' }}>
              Total
            </td>
            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--at-primary)', fontSize: '13px' }}>
              {totals.totalM3.toFixed(1)}
            </td>
            {activeTipos.map(tipo => {
              const m3 = totals.byTipo.get(tipo)
              const meta = TIPOLOGIA_META[tipo]
              return (
                <td key={tipo} style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: meta?.color ?? 'var(--at-ink)', fontSize: '12px' }}>
                  {m3 && m3 > 0 ? m3.toFixed(1) : '—'}
                </td>
              )
            })}
            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--at-success-strong)', fontSize: '13px' }}>
              {totals.totalMonto.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
          </tr>
        }
      />
    </div>
  )
}

export const AdminResumenProyectos = memo(AdminResumenProyectosImpl)
