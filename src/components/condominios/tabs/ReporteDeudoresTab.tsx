import { useMemo } from 'react'
import { CuotaCondominio, Unidad } from '../../../types'
import { exportarExcel, exportarPDFCartaCobro } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  moneda: string
  proyectoNombre?: string
}

interface DeudorRow {
  unidadId: string
  unidadNombre: string
  t0_30: number
  t31_60: number
  t61_90: number
  t90plus: number
  total: number
  cuotasCount: number
}

function diasVencido(fechaVenc: string | null | undefined): number {
  if (!fechaVenc) return 0
  const diff = new Date().getTime() - new Date(fechaVenc).getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

export default function ReporteDeudoresTab({ cuotas, unidades, moneda, proyectoNombre }: Props) {
  const deudores: DeudorRow[] = useMemo(() => {
    const map: Record<string, DeudorRow> = {}
    cuotas
      .filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
      .forEach(c => {
        if (!c.unidad_id) return
        const dias = diasVencido(c.fecha_vencimiento ?? (c.periodo + '-01'))
        if (!map[c.unidad_id]) {
          const u = unidades.find(u => u.id === c.unidad_id)
          map[c.unidad_id] = {
            unidadId: c.unidad_id,
            unidadNombre: u?.nombre ?? c.unidad_id,
            t0_30: 0, t31_60: 0, t61_90: 0, t90plus: 0,
            total: 0, cuotasCount: 0,
          }
        }
        const row = map[c.unidad_id]
        row.total += c.monto
        row.cuotasCount++
        if (dias <= 30)       row.t0_30   += c.monto
        else if (dias <= 60)  row.t31_60  += c.monto
        else if (dias <= 90)  row.t61_90  += c.monto
        else                  row.t90plus += c.monto
      })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [cuotas, unidades])

  const totales = useMemo(() => deudores.reduce((acc, d) => ({
    t0_30:   acc.t0_30   + d.t0_30,
    t31_60:  acc.t31_60  + d.t31_60,
    t61_90:  acc.t61_90  + d.t61_90,
    t90plus: acc.t90plus + d.t90plus,
    total:   acc.total   + d.total,
  }), { t0_30: 0, t31_60: 0, t61_90: 0, t90plus: 0, total: 0 }), [deudores])

  function exportarExcelDeudores() {
    exportarExcel(`deudores-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Deudores',
      headers: ['Unidad', '0–30 días', '31–60 días', '61–90 días', '+90 días', 'Total', 'Cuotas pendientes'],
      rows: deudores.map(d => [d.unidadNombre, d.t0_30, d.t31_60, d.t61_90, d.t90plus, d.total, d.cuotasCount]),
    }])
  }

  function cartaCobro(row: DeudorRow) {
    exportarPDFCartaCobro(
      { unidadNombre: row.unidadNombre, t0_30: row.t0_30, t31_60: row.t31_60, t61_90: row.t61_90, t90plus: row.t90plus, total: row.total, cuotasCount: row.cuotasCount },
      moneda,
      proyectoNombre
    )
  }

  function exportarCSV() {
    const header = 'Unidad,0-30 días,31-60 días,61-90 días,+90 días,Total,Cuotas pendientes'
    const rows = deudores.map(d =>
      `"${d.unidadNombre}",${d.t0_30.toFixed(2)},${d.t31_60.toFixed(2)},${d.t61_90.toFixed(2)},${d.t90plus.toFixed(2)},${d.total.toFixed(2)},${d.cuotasCount}`
    )
    const csv = [header, ...rows].join('\n')
    const a = document.createElement('a')
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    a.download = `deudores-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  type TotalesKey = 't0_30' | 't31_60' | 't61_90' | 't90plus'
  const columnasBarra: { key: TotalesKey; label: string; color: string }[] = [
    { key: 't0_30',   label: '0–30 días',   color: '#d97706' },
    { key: 't31_60',  label: '31–60 días',  color: '#ea580c' },
    { key: 't61_90',  label: '61–90 días',  color: '#dc2626' },
    { key: 't90plus', label: '+90 días',    color: '#991b1b' },
  ]

  const columns: DataTableColumn<DeudorRow>[] = [
    {
      key: 'unidadNombre',
      header: 'Unidad',
      sortable: true,
      render: row => <span style={{ fontWeight: 600, color: '#0f172a' }}>{row.unidadNombre}</span>,
    },
    {
      key: 't0_30',
      header: '0–30 días',
      sortable: true,
      align: 'right',
      accessor: row => row.t0_30,
      render: row => (
        <span style={{ color: row.t0_30 > 0 ? '#d97706' : '#9ca3af' }}>
          {row.t0_30 > 0 ? `${moneda} ${row.t0_30.toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 't31_60',
      header: '31–60 días',
      sortable: true,
      align: 'right',
      accessor: row => row.t31_60,
      render: row => (
        <span style={{ color: row.t31_60 > 0 ? '#ea580c' : '#9ca3af' }}>
          {row.t31_60 > 0 ? `${moneda} ${row.t31_60.toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 't61_90',
      header: '61–90 días',
      sortable: true,
      align: 'right',
      accessor: row => row.t61_90,
      render: row => (
        <span style={{ color: row.t61_90 > 0 ? '#dc2626' : '#9ca3af' }}>
          {row.t61_90 > 0 ? `${moneda} ${row.t61_90.toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 't90plus',
      header: '+90 días',
      sortable: true,
      align: 'right',
      accessor: row => row.t90plus,
      render: row => (
        <span style={{ fontWeight: row.t90plus > 0 ? 700 : 400, color: row.t90plus > 0 ? '#991b1b' : '#9ca3af' }}>
          {row.t90plus > 0 ? `${moneda} ${row.t90plus.toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      sortable: true,
      align: 'right',
      accessor: row => row.total,
      render: row => <span style={{ fontWeight: 800, color: '#ef4444' }}>{moneda} {row.total.toFixed(2)}</span>,
    },
    {
      key: 'cuotasCount',
      header: 'Cuotas',
      sortable: true,
      align: 'center',
      accessor: row => row.cuotasCount,
      render: row => <span style={{ color: '#64748b' }}>{row.cuotasCount}</span>,
    },
    {
      key: 'acciones',
      header: '',
      align: 'right',
      render: row => (
        <button onClick={() => cartaCobro(row)}
          style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>
          🖨️ Carta
        </button>
      ),
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Reporte de Deudores — Antigüedad de Saldos</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{deudores.length} unidades con saldo pendiente</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={exportarExcelDeudores}
            style={{ padding: '6px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            📊 Excel
          </button>
          <button onClick={exportarCSV}
            style={{ padding: '6px 14px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
            CSV
          </button>
        </div>
      </div>

      {/* KPIs por tramo */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total deuda', val: `${moneda} ${totales.total.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#ef4444', bg: '#fef2f2' },
          { label: '0–30 días', val: `${moneda} ${totales.t0_30.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#d97706', bg: '#fef3c7' },
          { label: '31–60 días', val: `${moneda} ${totales.t31_60.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#ea580c', bg: '#fff7ed' },
          { label: '61–90 días', val: `${moneda} ${totales.t61_90.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#dc2626', bg: '#fef2f2' },
          { label: '+90 días', val: `${moneda} ${totales.t90plus.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: '#991b1b', bg: '#fef2f2' },
          { label: 'Unidades deudoras', val: String(deudores.length), color: '#374151', bg: '#f8fafc' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 120px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#6b7280' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Barra proporcional por tramo */}
      {totales.total > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>Distribución de deuda por antigüedad</div>
          <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', gap: 1 }}>
            {columnasBarra.map(col => {
              const val = totales[col.key] as number
              const pct = (val / totales.total) * 100
              return pct > 0 ? (
                <div key={col.key} title={`${col.label}: ${pct.toFixed(1)}%`}
                  style={{ width: `${pct}%`, background: col.color }} />
              ) : null
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {columnasBarra.map(col => {
              const val = totales[col.key] as number
              const pct = totales.total > 0 ? (val / totales.total) * 100 : 0
              return (
                <span key={col.key} style={{ fontSize: 10, color: col.color, fontWeight: 600 }}>
                  {col.label}: {pct.toFixed(1)}%
                </span>
              )
            })}
          </div>
        </div>
      )}

      <DataTable
        data={deudores}
        columns={columns}
        rowKey="unidadId"
        searchableKeys={['unidadNombre']}
        searchPlaceholder="Buscar unidad…"
        defaultSort={{ key: 'total', direction: 'desc' }}
        emptyState={{ icon: '✅', title: '¡Excelente! No hay unidades con saldo pendiente' }}
        footerRow={rows => {
          const tot = rows.reduce((acc, d) => ({
            t0_30: acc.t0_30 + d.t0_30,
            t31_60: acc.t31_60 + d.t31_60,
            t61_90: acc.t61_90 + d.t61_90,
            t90plus: acc.t90plus + d.t90plus,
            total: acc.total + d.total,
            cuotas: acc.cuotas + d.cuotasCount,
          }), { t0_30: 0, t31_60: 0, t61_90: 0, t90plus: 0, total: 0, cuotas: 0 })
          const tdStyle = { padding: '10px 14px', borderTop: '2px solid #e5e7eb', background: '#f8fafc', fontWeight: 700 }
          return (
            <tr>
              <td style={{ ...tdStyle }}>TOTAL</td>
              <td style={{ ...tdStyle, textAlign: 'right' as const, color: '#d97706' }}>{moneda} {tot.t0_30.toFixed(2)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' as const, color: '#ea580c' }}>{moneda} {tot.t31_60.toFixed(2)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' as const, color: '#dc2626' }}>{moneda} {tot.t61_90.toFixed(2)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' as const, color: '#991b1b' }}>{moneda} {tot.t90plus.toFixed(2)}</td>
              <td style={{ ...tdStyle, textAlign: 'right' as const, fontWeight: 800, color: '#ef4444' }}>{moneda} {tot.total.toFixed(2)}</td>
              <td style={{ ...tdStyle, textAlign: 'center' as const, color: '#64748b' }}>{tot.cuotas}</td>
              <td style={tdStyle} />
            </tr>
          )
        }}
      />
    </div>
  )
}
