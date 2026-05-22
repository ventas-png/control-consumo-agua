import { useMemo } from 'react'
import { CuotaCondominio, Unidad } from '../../../types'
import { StatTile } from '../../shared/StatTile'
import type { Tone } from '../../shared/statusTone'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  moneda: string
}

const MESES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function ultimosMeses(n: number): string[] {
  const result: string[] = []
  const hoy = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

function labelMes(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MESES_LABEL[parseInt(m) - 1]} ${y.slice(2)}`
}

type EstadoCelda = 'pagado' | 'pendiente' | 'moroso' | 'sin_cuota'

const CELDA_CFG: Record<EstadoCelda, { bg: string; color: string; label: string; order: number }> = {
  pagado:    { bg: 'var(--at-success)', color: 'var(--at-on-status)', label: '✓', order: 0 },
  pendiente: { bg: 'var(--at-warning)', color: 'var(--at-on-status)', label: '!', order: 2 },
  moroso:    { bg: 'var(--at-danger)',  color: 'var(--at-on-status)', label: '✗', order: 3 },
  sin_cuota: { bg: 'var(--at-chip)', color: 'var(--at-line-strong)', label: '·', order: 1 },
}

export default function MapaCalorCuotasTab({ cuotas, unidades, moneda }: Props) {
  const meses = useMemo(() => ultimosMeses(12), [])

  const matriz = useMemo(() => {
    return unidades.map(u => {
      const celdas = meses.map(mes => {
        const cuota = cuotas.find(c => c.unidad_id === u.id && c.periodo === mes)
        if (!cuota) return { mes, estado: 'sin_cuota' as EstadoCelda, monto: 0 }
        return { mes, estado: cuota.estado as EstadoCelda, monto: cuota.monto }
      })
      const pagadas  = celdas.filter(c => c.estado === 'pagado').length
      const morosas  = celdas.filter(c => c.estado === 'moroso').length
      const pend     = celdas.filter(c => c.estado === 'pendiente').length
      const conCuota = celdas.filter(c => c.estado !== 'sin_cuota').length
      const tasaCobro = conCuota > 0 ? pagadas / conCuota : 1
      const deudaTotal = cuotas
        .filter(c => c.unidad_id === u.id && (c.estado === 'pendiente' || c.estado === 'moroso'))
        .reduce((s, c) => s + c.monto, 0)
      return { unidad: u, celdas, pagadas, morosas, pend, tasaCobro, deudaTotal, conCuota }
    }).sort((a, b) => a.tasaCobro - b.tasaCobro) // peores primero
  }, [cuotas, unidades, meses])

  // Totales por mes
  const totalesMes = useMemo(() =>
    meses.map(mes => {
      const conCuota = cuotas.filter(c => c.periodo === mes)
      const pagadas  = conCuota.filter(c => c.estado === 'pagado').length
      const total    = conCuota.length
      return { mes, pct: total > 0 ? pagadas / total : 0, pagadas, total }
    })
  , [cuotas, meses])

  const globalTasaCobro = matriz.reduce((s, r) => s + r.tasaCobro, 0) / (matriz.length || 1)
  const unidadesAlDia   = matriz.filter(r => r.deudaTotal === 0).length
  const deudaTotal      = matriz.reduce((s, r) => s + r.deudaTotal, 0)
  const cronicas        = matriz.filter(r => r.morosas >= 3).length

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Mapa de Calor — Cumplimiento de Cuotas</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 14 }}>
        Últimos 12 meses · {unidades.length} unidades · peores pagadores arriba
      </div>

      {/* KPIs globales */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {([
          { label: 'Tasa cobro global', val: `${Math.round(globalTasaCobro * 100)}%`, tone: (globalTasaCobro >= 0.9 ? 'success' : globalTasaCobro >= 0.75 ? 'warning' : 'danger') as Tone },
          { label: 'Unidades al día', val: `${unidadesAlDia} / ${unidades.length}`, tone: 'success' as Tone },
          { label: 'Deuda total activa', val: `${moneda} ${deudaTotal.toLocaleString('es', { minimumFractionDigits: 2 })}`, tone: 'danger' as Tone },
          { label: 'Morosos crónicos (≥3m)', val: String(cronicas), tone: (cronicas > 0 ? 'danger' : 'success') as Tone },
        ]).map(k => (
          <StatTile key={k.label} label={k.label} value={k.val} tone={k.tone} style={{ flex: '1 1 130px', minWidth: 130 }} />
        ))}
      </div>

      {/* Leyenda */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        {(Object.entries(CELDA_CFG) as [EstadoCelda, typeof CELDA_CFG[EstadoCelda]][]).map(([est, cfg]) => (
          <span key={est} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 16, height: 16, borderRadius: 3, background: cfg.bg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: cfg.color, fontSize: 10, fontWeight: 800 }}>{cfg.label}</span>
            {est.replace('_', ' ')}
          </span>
        ))}
      </div>

      {/* Matriz */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 700 }}>
          <thead>
            <tr style={{ background: 'var(--at-surface-2)' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--at-ink-3)', fontWeight: 600, minWidth: 100, position: 'sticky', left: 0, background: 'var(--at-surface-2)', zIndex: 1 }}>Unidad</th>
              {meses.map(m => (
                <th key={m} style={{ padding: '8px 6px', textAlign: 'center', color: 'var(--at-ink-3)', fontWeight: 600, minWidth: 44 }}>
                  {labelMes(m)}
                  <div style={{ height: 3, borderRadius: 2, marginTop: 3, background: `hsl(${Math.round(totalesMes.find(t => t.mes === m)!.pct * 120)}, 70%, 50%)`, opacity: 0.7 }} />
                </th>
              ))}
              <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 600, minWidth: 60 }}>Tasa</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 600, minWidth: 80 }}>Deuda</th>
            </tr>
          </thead>
          <tbody>
            {matriz.map(row => (
              <tr key={row.unidad.id} style={{ borderTop: '1px solid var(--at-chip)' }}>
                <td style={{ padding: '6px 12px', fontWeight: 600, color: 'var(--at-ink-2)', position: 'sticky', left: 0, background: 'var(--at-surface)', zIndex: 1, borderRight: '1px solid var(--at-chip)' }}>
                  {row.unidad.nombre}
                </td>
                {row.celdas.map(c => {
                  const cfg = CELDA_CFG[c.estado]
                  return (
                    <td key={c.mes} style={{ padding: '4px 3px', textAlign: 'center' }}
                      title={`${row.unidad.nombre} · ${labelMes(c.mes)} · ${c.estado}${c.monto > 0 ? ` · ${moneda} ${c.monto.toFixed(2)}` : ''}`}>
                      <div style={{ width: 32, height: 22, borderRadius: 4, background: cfg.bg,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: cfg.color, fontSize: 10, fontWeight: 800, margin: 'auto' }}>
                        {cfg.label}
                      </div>
                    </td>
                  )
                })}
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700,
                  color: row.tasaCobro >= 0.9 ? 'var(--at-success)' : row.tasaCobro >= 0.7 ? 'var(--at-warning)' : 'var(--at-danger)' }}>
                  {Math.round(row.tasaCobro * 100)}%
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: row.deudaTotal > 0 ? 700 : 400,
                  color: row.deudaTotal > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>
                  {row.deudaTotal > 0 ? `${moneda} ${row.deudaTotal.toFixed(2)}` : '✓'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
              <td style={{ padding: '7px 12px', fontWeight: 700, position: 'sticky', left: 0, background: 'var(--at-surface-2)' }}>Tasa mes</td>
              {totalesMes.map(t => (
                <td key={t.mes} style={{ padding: '7px 3px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700,
                    color: t.pct >= 0.9 ? 'var(--at-success)' : t.pct >= 0.7 ? 'var(--at-warning)' : t.total === 0 ? 'var(--at-line-strong)' : 'var(--at-danger)' }}>
                    {t.total > 0 ? `${Math.round(t.pct * 100)}%` : '—'}
                  </div>
                </td>
              ))}
              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 800, color: globalTasaCobro >= 0.9 ? 'var(--at-success)' : 'var(--at-warning)' }}>
                {Math.round(globalTasaCobro * 100)}%
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 800, color: 'var(--at-danger)' }}>
                {moneda} {deudaTotal.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
