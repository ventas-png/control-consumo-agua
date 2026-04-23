import { useMemo } from 'react'
import { CuotaCondominio, Unidad } from '../../../types'

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

  function cartaCobro(row: DeudorRow) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Carta de Cobro — ${row.unidadNombre}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:40px;max-width:700px;margin:auto;color:#0f172a;font-size:13px}
      .header{border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:24px}
      h1{font-size:22px;margin:0 0 4px}h2{font-size:13px;color:#64748b;font-weight:normal;margin:0}
      .box{background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin:20px 0}
      .amount{font-size:28px;font-weight:800;color:#ef4444}
      table{width:100%;border-collapse:collapse;margin:16px 0;font-size:12px}
      th{background:#f1f5f9;padding:8px 10px;text-align:left;color:#64748b}
      td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
      .footer{margin-top:32px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px}
    </style></head><body>
    <div class="header"><h1>${proyectoNombre ?? 'Administración'}</h1><h2>Carta de Cobro — ${new Date().toLocaleDateString('es')}</h2></div>
    <p>Estimado(a) residente de la unidad <strong>${row.unidadNombre}</strong>,</p>
    <p>Nos permitimos informarle que a la fecha presenta el siguiente saldo pendiente con la administración del condominio:</p>
    <div class="box">
      <div style="font-size:12px;color:#dc2626">Saldo total pendiente</div>
      <div class="amount">${moneda} ${row.total.toFixed(2)}</div>
    </div>
    <table>
      <thead><tr><th>Tramo de mora</th><th style="text-align:right">Monto</th></tr></thead>
      <tbody>
        ${row.t0_30   > 0 ? `<tr><td>0–30 días</td><td style="text-align:right">${moneda} ${row.t0_30.toFixed(2)}</td></tr>` : ''}
        ${row.t31_60  > 0 ? `<tr><td>31–60 días</td><td style="text-align:right">${moneda} ${row.t31_60.toFixed(2)}</td></tr>` : ''}
        ${row.t61_90  > 0 ? `<tr><td>61–90 días</td><td style="text-align:right">${moneda} ${row.t61_90.toFixed(2)}</td></tr>` : ''}
        ${row.t90plus > 0 ? `<tr style="color:#ef4444;font-weight:700"><td>+90 días (mora grave)</td><td style="text-align:right">${moneda} ${row.t90plus.toFixed(2)}</td></tr>` : ''}
      </tbody>
    </table>
    <p>Le solicitamos atender este pago a la brevedad para evitar recargos adicionales. Para regularizar su situación puede comunicarse con la administración o realizar su pago en los medios habilitados.</p>
    <p style="margin-top:24px">Atentamente,<br><strong>Administración del Condominio</strong><br>${proyectoNombre ?? ''}</p>
    <div class="footer">Este documento es de carácter informativo y no constituye acción legal.</div>
    </body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
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
    { key: 't0_30',   label: '0–30 días',   color: '#d97706' },
    { key: 't31_60',  label: '31–60 días',  color: '#ea580c' },
    { key: 't61_90',  label: '61–90 días',  color: '#dc2626' },
    { key: 't90plus', label: '+90 días',    color: '#991b1b' },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Reporte de Deudores — Antigüedad de Saldos</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{deudores.length} unidades con saldo pendiente</div>
        </div>
        <button onClick={exportarCSV}
          style={{ padding: '6px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          ⬇️ Exportar CSV
        </button>
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
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
          No hay unidades con saldo pendiente. ¡Excelente nivel de cobro!
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '9px 12px', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Unidad</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: '#d97706', fontWeight: 600 }}>0–30 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: '#ea580c', fontWeight: 600 }}>31–60 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>61–90 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: '#991b1b', fontWeight: 600 }}>+90 días</th>
                <th style={{ padding: '9px 12px', textAlign: 'right', color: '#374151', fontWeight: 700 }}>Total</th>
                <th style={{ padding: '9px 12px', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>Cuotas</th>
                <th style={{ padding: '9px 12px' }} />
              </tr>
            </thead>
            <tbody>
              {deudores.map((d, i) => (
                <tr key={d.unidadId} style={{ borderTop: i > 0 ? '1px solid #f1f5f9' : undefined, background: d.t90plus > 0 ? '#fef2f200' : undefined }}>
                  <td style={{ padding: '9px 12px', fontWeight: 600, color: '#0f172a' }}>{d.unidadNombre}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: d.t0_30 > 0 ? '#d97706' : '#9ca3af' }}>
                    {d.t0_30 > 0 ? `${moneda} ${d.t0_30.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: d.t31_60 > 0 ? '#ea580c' : '#9ca3af' }}>
                    {d.t31_60 > 0 ? `${moneda} ${d.t31_60.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', color: d.t61_90 > 0 ? '#dc2626' : '#9ca3af' }}>
                    {d.t61_90 > 0 ? `${moneda} ${d.t61_90.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: d.t90plus > 0 ? 700 : 400, color: d.t90plus > 0 ? '#991b1b' : '#9ca3af' }}>
                    {d.t90plus > 0 ? `${moneda} ${d.t90plus.toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: '#ef4444' }}>
                    {moneda} {d.total.toFixed(2)}
                  </td>
                  <td style={{ padding: '9px 12px', textAlign: 'center', color: '#64748b' }}>{d.cuotasCount}</td>
                  <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                    <button onClick={() => cartaCobro(d)}
                      style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>
                      🖨️ Carta
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f8fafc' }}>
                <td style={{ padding: '9px 12px', fontWeight: 700 }}>TOTAL</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#d97706' }}>{moneda} {totales.t0_30.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#ea580c' }}>{moneda} {totales.t31_60.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{moneda} {totales.t61_90.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: '#991b1b' }}>{moneda} {totales.t90plus.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: '#ef4444' }}>{moneda} {totales.total.toFixed(2)}</td>
                <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: '#64748b' }}>
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
