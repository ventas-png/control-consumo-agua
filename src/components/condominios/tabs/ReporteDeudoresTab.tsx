import { hoyLocalISO } from '../../../lib/format'
import { useMemo } from 'react'
import { CuotaCondominio, Unidad } from '../../../types'
import { exportarExcel, exportarPDFCartaCobro } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { ROLES_RESPONSABLE_CUOTA } from './CuotasUi'

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

  // Deuda pendiente desglosada por rol responsable (cuotas diferenciadas). Solo se
  // muestra cuando hay al menos una cuota etiquetada; si no, el reporte queda igual.
  const deudaPorResponsable = useMemo(() => {
    const montos: Record<string, number> = {}
    let hayDiferenciadas = false
    cuotas
      .filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
      .forEach(c => {
        const key = c.rol_responsable ?? ''
        if (c.rol_responsable) hayDiferenciadas = true
        montos[key] = (montos[key] ?? 0) + c.monto
      })
    const filas = [
      ...ROLES_RESPONSABLE_CUOTA.map(r => ({ key: r.value as string, label: r.label, monto: montos[r.value] ?? 0 })),
      { key: '', label: 'Sin diferenciar', monto: montos[''] ?? 0 },
    ].filter(f => f.monto > 0)
    return { filas, hayDiferenciadas }
  }, [cuotas])

  function exportarExcelDeudores() {
    const sheets = [{
      name: 'Deudores',
      headers: ['Unidad', '0–30 días', '31–60 días', '61–90 días', '+90 días', 'Total', 'Cuotas pendientes'],
      rows: deudores.map(d => [d.unidadNombre, d.t0_30, d.t31_60, d.t61_90, d.t90plus, d.total, d.cuotasCount] as (string | number)[]),
    }]
    if (deudaPorResponsable.hayDiferenciadas) {
      sheets.push({
        name: 'Por responsable',
        headers: ['Responsable', 'Deuda pendiente'],
        rows: deudaPorResponsable.filas.map(f => [f.label, f.monto] as (string | number)[]),
      })
    }
    exportarExcel(`deudores-${hoyLocalISO()}`, sheets)
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
    a.download = `deudores-${hoyLocalISO()}.csv`
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

      {/* Deuda por responsable (cuotas diferenciadas) — solo si hay etiquetadas */}
      {deudaPorResponsable.hayDiferenciadas && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 8, fontWeight: 600 }}>Deuda pendiente por responsable</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {deudaPorResponsable.filas.map(f => (
              <div key={f.key} style={{ flex: '1 1 120px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 8, padding: '8px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{f.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--at-ink-2)', marginTop: 2 }}>{moneda} {f.monto.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabla — F3.9: migrado a <DataTable> shared (totales en KPIs arriba) */}
      <DataTable<DeudorRow>
        data={deudores}
        rowKey="unidadId"
        pageSize={50}
        defaultSort={{ key: 'total', direction: 'desc' }}
        emptyState={{ icon: '✅', title: 'No hay unidades con saldo pendiente', description: '¡Excelente nivel de cobro!' }}
        rowStyle={(d) => d.t90plus > 0 ? { background: 'var(--at-danger-tint)' } : {}}
        columns={[
          { key: 'unidadNombre', header: 'Unidad', sortable: true,
            render: (d) => <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{d.unidadNombre}</span> },
          { key: 't0_30', header: '0–30 días', align: 'right', sortable: true, hideOnMobile: true,
            render: (d) => <span style={{ color: d.t0_30 > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
              {d.t0_30 > 0 ? `${moneda} ${d.t0_30.toFixed(2)}` : '—'}
            </span> },
          { key: 't31_60', header: '31–60 días', align: 'right', sortable: true, hideOnMobile: true,
            render: (d) => <span style={{ color: d.t31_60 > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>
              {d.t31_60 > 0 ? `${moneda} ${d.t31_60.toFixed(2)}` : '—'}
            </span> },
          { key: 't61_90', header: '61–90 días', align: 'right', sortable: true, hideOnMobile: true,
            render: (d) => <span style={{ color: d.t61_90 > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
              {d.t61_90 > 0 ? `${moneda} ${d.t61_90.toFixed(2)}` : '—'}
            </span> },
          { key: 't90plus', header: '+90 días', align: 'right', sortable: true,
            render: (d) => <span style={{ fontWeight: d.t90plus > 0 ? 700 : 400, color: d.t90plus > 0 ? 'var(--at-danger-strong)' : 'var(--at-ink-3)' }}>
              {d.t90plus > 0 ? `${moneda} ${d.t90plus.toFixed(2)}` : '—'}
            </span> },
          { key: 'total', header: 'Total', align: 'right', sortable: true,
            render: (d) => <span style={{ fontWeight: 800, color: 'var(--at-danger)' }}>{moneda} {d.total.toFixed(2)}</span> },
          { key: 'cuotasCount', header: 'Cuotas', align: 'center', sortable: true, hideOnMobile: true,
            render: (d) => <span style={{ color: 'var(--at-ink-3)' }}>{d.cuotasCount}</span> },
          { key: 'actions', header: '', align: 'right',
            render: (d) => (
              <button onClick={(e) => { e.stopPropagation(); cartaCobro(d) }}
                style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--at-primary)', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', cursor: 'pointer', fontWeight: 600 }}>
                🖨️ Carta
              </button>
            ) },
        ] satisfies DataTableColumn<DeudorRow>[]}
      />
    </div>
  )
}
