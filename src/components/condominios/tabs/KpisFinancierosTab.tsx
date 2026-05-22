import { useState, useMemo } from 'react'
import { CuotaCondominio, GastoCondominio, HistorialSaldoUnidad, RecargoMora, Unidad } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  historialSaldos: HistorialSaldoUnidad[] // reserved for future saldo trend
  recargosMora: RecargoMora[] // reserved for mora amount KPIs
  unidades: Unidad[]
  moneda: string
}

function pct(num: number, denom: number) {
  if (denom === 0) return 0
  return parseFloat(((num / denom) * 100).toFixed(1))
}

export default function KpisFinancierosTab({ cuotas, gastos, unidades, moneda }: Props) {
  const [filtroPeriodo, setFiltroPeriodo] = useState('')

  const periodos = useMemo(() => [...new Set(cuotas.map(c => c.periodo).filter(Boolean))].sort().reverse(), [cuotas])

  const cuotasFiltradas = filtroPeriodo ? cuotas.filter(c => c.periodo === filtroPeriodo) : cuotas
  const gastosFiltrados = filtroPeriodo ? gastos.filter(g => g.fecha?.startsWith(filtroPeriodo.slice(0, 7))) : gastos

  // Core KPIs
  const totalGenerado = cuotasFiltradas.reduce((s, c) => s + c.monto, 0)
  const totalCobrado = cuotasFiltradas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const totalPendiente = cuotasFiltradas.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0)
  const totalMoroso = cuotasFiltradas.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)
  const totalEgreso = gastosFiltrados.reduce((s, g) => s + g.monto, 0)
  const saldoOperativo = totalCobrado - totalEgreso

  const tasaRecaudacion = pct(totalCobrado, totalGenerado)
  const tasaMorosidad = pct(totalMoroso, totalGenerado)

  const unidadesMorosas = [...new Set(cuotasFiltradas.filter(c => c.estado === 'moroso').map(c => c.unidad_id))].length
  const unidadesAlDia = [...new Set(cuotasFiltradas.filter(c => c.estado === 'pagado').map(c => c.unidad_id))].length

  // Aging analysis (días vencidos) — uses cuotas morosas with fecha_vencimiento
  const hoy = new Date()
  const aging = cuotas.filter(c => c.estado === 'moroso' && c.fecha_vencimiento).map(c => {
    const dias = Math.floor((hoy.getTime() - new Date(c.fecha_vencimiento!).getTime()) / 86400000)
    return { ...c, diasVencido: Math.max(0, dias) }
  })
  const aging30 = aging.filter(c => c.diasVencido <= 30)
  const aging60 = aging.filter(c => c.diasVencido > 30 && c.diasVencido <= 60)
  const aging90 = aging.filter(c => c.diasVencido > 60 && c.diasVencido <= 90)
  const aging90plus = aging.filter(c => c.diasVencido > 90)

  // Trend by period (last 6 periods)
  const periodosTrend = periodos.slice(0, 6).reverse()
  const trend = periodosTrend.map(p => {
    const cP = cuotas.filter(c => c.periodo === p)
    const cobrado = cP.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
    const generado = cP.reduce((s, c) => s + c.monto, 0)
    const egreso = gastos.filter(g => g.fecha?.startsWith(p.slice(0, 7))).reduce((s, g) => s + g.monto, 0)
    return { periodo: p, cobrado, generado, egreso, tasa: pct(cobrado, generado) }
  })
  const maxVal = Math.max(...trend.map(t => Math.max(t.cobrado, t.generado, t.egreso)), 1)

  // Top deudores
  const deudoresList = unidades.map(u => {
    const deuda = cuotasFiltradas.filter(c => c.unidad_id === u.id && c.estado === 'moroso').reduce((s, c) => s + c.monto, 0)
    const cuotasVenc = cuotasFiltradas.filter(c => c.unidad_id === u.id && c.estado === 'moroso').length
    return { unidad: u, deuda, cuotasVenc }
  }).filter(d => d.deuda > 0).sort((a, b) => b.deuda - a.deuda).slice(0, 5)

  const barColor = (v: number, max: number, color: string) => (
    <div style={{ width: '100%', background: 'var(--at-chip)', borderRadius: 4, height: 6, marginTop: 4 }}>
      <div style={{ height: '100%', background: color, width: `${(v / max) * 100}%`, borderRadius: 4 }} />
    </div>
  )

  const kpiCard = (label: string, val: string, sub: string, bg: string, color: string) => (
    <div style={{ background: bg, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{val}</div>
      <div style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ padding: 16 }}>
      {/* Filtro período */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <select value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
          <option value="">Todos los períodos</option>
          {periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {kpiCard('Tasa de recaudación', `${tasaRecaudacion}%`, `${moneda} ${totalCobrado.toFixed(2)} / ${totalGenerado.toFixed(2)}`, tasaRecaudacion >= 80 ? 'var(--at-success-tint)' : tasaRecaudacion >= 60 ? 'var(--at-warning-tint)' : 'var(--at-danger-tint)', tasaRecaudacion >= 80 ? 'var(--at-success)' : tasaRecaudacion >= 60 ? 'var(--at-warning)' : 'var(--at-danger)')}
        {kpiCard('Tasa de morosidad', `${tasaMorosidad}%`, `${moneda} ${totalMoroso.toFixed(2)} en mora`, 'var(--at-danger-tint)', 'var(--at-danger)')}
        {kpiCard('Saldo operativo', `${moneda} ${Math.abs(saldoOperativo).toFixed(2)}`, saldoOperativo >= 0 ? 'Superávit' : 'Déficit', saldoOperativo >= 0 ? 'var(--at-primary-tint)' : 'var(--at-danger-tint)', saldoOperativo >= 0 ? 'var(--at-primary)' : 'var(--at-danger)')}
        {kpiCard('Unidades morosas', String(unidadesMorosas), `de ${unidades.length} unidades (${unidadesAlDia} al día)`, 'var(--at-warning-tint)', 'var(--at-warning)')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Aging */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Antigüedad de deuda</div>
          {[
            { label: '0–30 días', items: aging30, color: 'var(--at-warning)' },
            { label: '31–60 días', items: aging60, color: 'var(--at-warning)' },
            { label: '61–90 días', items: aging90, color: 'var(--at-danger)' },
            { label: '+90 días', items: aging90plus, color: 'var(--at-danger-strong)' },
          ].map(({ label, items, color }) => {
            const monto = items.reduce((s, c) => s + c.monto, 0)
            const totalMor = aging.reduce((s, c) => s + c.monto, 0) || 1
            return (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--at-ink-2)' }}>{label}</span>
                  <span style={{ fontWeight: 600, color }}>{moneda} {monto.toFixed(2)} <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}>({items.length} cuotas)</span></span>
                </div>
                {barColor(monto, totalMor, color)}
              </div>
            )
          })}
          {aging.length === 0 && <div style={{ color: 'var(--at-ink-3)', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>Sin cuotas morosas con fecha de vencimiento</div>}
        </div>

        {/* Top deudores */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Top 5 deudores</div>
          {deudoresList.length === 0
            ? <div style={{ color: 'var(--at-ink-3)', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>Sin deudores</div>
            : deudoresList.map((d, i) => (
              <div key={d.unidad.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--at-danger-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--at-danger)', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.unidad.nombre}</div>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.cuotasVenc} cuota(s) vencida(s)</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-danger)', whiteSpace: 'nowrap' }}>{moneda} {d.deuda.toFixed(2)}</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* Tendencia mensual */}
      {trend.length > 0 && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Tendencia últimos {trend.length} períodos</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 120, marginBottom: 8 }}>
            {trend.map(t => (
              <div key={t.periodo} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: 100 }}>
                  <div style={{ flex: 1, background: 'var(--at-success-border)', borderRadius: '3px 3px 0 0', height: `${(t.cobrado / maxVal) * 100}%`, minHeight: 2 }} title={`Cobrado: ${t.cobrado.toFixed(2)}`} />
                  <div style={{ flex: 1, background: 'var(--at-danger-border)', borderRadius: '3px 3px 0 0', height: `${(t.egreso / maxVal) * 100}%`, minHeight: 2 }} title={`Egreso: ${t.egreso.toFixed(2)}`} />
                </div>
                <div style={{ fontSize: 9, color: 'var(--at-ink-3)', textAlign: 'center', lineHeight: 1.1 }}>{t.periodo.slice(2)}</div>
                <div style={{ fontSize: 9, fontWeight: 600, color: t.tasa >= 80 ? 'var(--at-success)' : 'var(--at-danger)' }}>{t.tasa}%</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--at-ink-3)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-success-border)', borderRadius: 2, marginRight: 4 }} />Cobrado</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--at-danger-border)', borderRadius: 2, marginRight: 4 }} />Egresos</span>
            <span style={{ marginLeft: 'auto' }}>Porcentaje = tasa de recaudación del período</span>
          </div>
        </div>
      )}

      {/* Resumen cuotas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 16 }}>
        {[
          { label: 'Pagadas', val: cuotasFiltradas.filter(c => c.estado === 'pagado').length, monto: totalCobrado, bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
          { label: 'Pendientes', val: cuotasFiltradas.filter(c => c.estado === 'pendiente').length, monto: totalPendiente, bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
          { label: 'Morosas', val: cuotasFiltradas.filter(c => c.estado === 'moroso').length, monto: totalMoroso, bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: k.color }}>{k.label}</div>
            <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{moneda} {k.monto.toFixed(2)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
