import { useMemo } from 'react'
import { CuotaCondominio, Unidad } from '../../../types'
import { exportarExcel, exportarPDFCartaCobro } from '../exportUtils'

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
  const columnas: { key: TotalesKey; label: string; color: string }[] = [
    { key: 't0_30',   label: '0–30 días',   color: 'var(--at-warning)' },
    { key: 't31_60',  label: '31–60 días',  color: 'var(--at-warning)' },
    { key: 't61_90',  label: '61–90 días',  color: 'var(--at-danger)' },
    { key: 't90plus', label: '+90 días',    color: 'var(--at-danger-strong)' },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>Reporte de Deudores — Antigüedad de Saldos</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{deudores.length} unidades con saldo pendiente</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={exportarExcelDeudores}
            style={{ padding: '6px 14px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            📊 Excel
          </button>
          <button onClick={exportarCSV}
            style={{ padding: '6px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>
            CSV
          </button>
        </div>
      </div>

      {/* KPIs por tramo */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total deuda', val: `${moneda} ${totales.total.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
          { label: '0–30 días', val: `${moneda} ${totales.t0_30.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
          { label: '31–60 días', val: `${moneda} ${totales.t31_60.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
          { label: '61–90 días', val: `${moneda} ${totales.t61_90.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
          { label: '+90 días', val: `${moneda} ${totales.t90plus.toLocaleString('es', { minimumFractionDigits: 2 })}`, color: 'var(--at-danger-strong)', bg: 'var(--at-danger-tint)' },
          { label: 'Unidades deudoras', val: String(deudores.length), color: 'var(--at-ink-2)', bg: 'var(--at-surface-2)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 120px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Barra proporcional por tramo */}
      {totales.total > 0 && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 6, fontWeight: 600 }}>Distribución de deuda por antigüedad</div>
          <div style={{ display: 'flex', height: 16, borderRadius: 8, overflow: 'hidden', gap: 1 }}>
            {columnas.map(col => {
              const val = totales[col.key] as number
              const pct = (val / totales.total) * 100
              return pct > 0 ? (
                <div key={col.key} title={`${col.label}: ${pct.toFixed(1)}%`}
                  style={{ width: `${pct}%`, background: col.color }} />
              ) : null
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            {columnas.map(col => {
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

      {/* Tabla */}
      {deudores.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--at-ink-3)', fontSize: 13 }}>
          No hay unidades con saldo pendiente. ¡Excelente nivel de cobro!
        </div>
      ) : (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                <th style={{ padding: '9px 12px', textAlign: 'left', color: 'var(--at-ink-3)', fontWeight: 600 }}>Unidad</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--at-warning)', fontWeight: 600 }}>0–30 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--at-warning)', fontWeight: 600 }}>31–60 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--at-danger)', fontWeight: 600 }}>61–90 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--at-danger-strong)', fontWeight: 600 }}>+90 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: 'var(--at-ink-2)', fontWeight: 700 }}>Total</th>
                <th style={{ padding: '9px 12px', textAlign: 'center', color: 'var(--at-ink-3)', fontWeight: 600 }}>Cuotas</th>
                <th style={{ padding: '9px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {deudores.map((d, i) => (
                <tr key={d.unidadId} style={{ borderTop: i > 0 ? '1px solid var(--at-chip)' : undefined, background: d.t90plus > 0 ? 'var(--at-danger-tint)00' : undefined }}>
                  <td style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--at-ink)' }}>{d.unidadNombre}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: d.t0_30 > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
                    {d.t0_30 > 0 ? `${moneda} ${d.t0_30.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: d.t31_60 > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
                    {d.t31_60 > 0 ? `${moneda} ${d.t31_60.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: d.t61_90 > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                    {d.t61_90 > 0 ? `${moneda} ${d.t61_90.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: d.t90plus > 0 ? 700 : 400, color: d.t90plus > 0 ? 'var(--at-danger-strong)' : 'var(--at-ink-3)' }}>
                    {d.t90plus > 0 ? `${moneda} ${d.t90plus.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--at-danger)' }}>
                    {moneda} {d.total.toFixed(2)}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'center', color: 'var(--at-ink-3)' }}>{d.cuotasCount}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    <button onClick={() => cartaCobro(d)}
                      style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--at-primary)', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', cursor: 'pointer', fontWeight: 600 }}>
                      🖨️ Carta
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
                <td style={{ padding: '9px 12px', fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--at-warning)' }}>{moneda} {totales.t0_30.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--at-warning)' }}>{moneda} {totales.t31_60.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--at-danger)' }}>{moneda} {totales.t61_90.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--at-danger-strong)' }}>{moneda} {totales.t90plus.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: 'var(--at-danger)' }}>{moneda} {totales.total.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-ink-3)' }}>
                  {deudores.reduce((s, d) => s + d.cuotasCount, 0)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
