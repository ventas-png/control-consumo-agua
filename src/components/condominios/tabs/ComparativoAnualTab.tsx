import { useState, useMemo } from 'react'
import { CuotaCondominio, GastoCondominio } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  moneda: string
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

interface MesData {
  mes: number
  ingresos: number
  egresos: number
  superavit: number
}

function datosAnio(cuotas: CuotaCondominio[], gastos: GastoCondominio[], anio: number): MesData[] {
  return Array.from({ length: 12 }, (_, i) => {
    const mesStr = `${anio}-${String(i + 1).padStart(2, '0')}`
    const ingresos = cuotas
      .filter(c => c.periodo === mesStr && c.estado === 'pagado')
      .reduce((s, c) => s + c.monto, 0)
    const egresos = gastos
      .filter(g => g.fecha?.startsWith(mesStr) && g.estado !== 'anulado')
      .reduce((s, g) => s + g.monto, 0)
    return { mes: i, ingresos, egresos, superavit: ingresos - egresos }
  })
}

function variacion(a: number, b: number): { pct: number; dir: 'up' | 'down' | 'eq' } {
  if (b === 0 && a === 0) return { pct: 0, dir: 'eq' }
  if (b === 0) return { pct: 100, dir: 'up' }
  const pct = ((a - b) / b) * 100
  return { pct, dir: pct > 0 ? 'up' : pct < 0 ? 'down' : 'eq' }
}

function Badge({ v, invertido = false }: { v: ReturnType<typeof variacion>; invertido?: boolean }) {
  if (v.dir === 'eq') return <span style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>—</span>
  const isGood = invertido ? v.dir === 'down' : v.dir === 'up'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 20,
      background: isGood ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
      color: isGood ? 'var(--at-success)' : 'var(--at-danger)' }}>
      {v.dir === 'up' ? '▲' : '▼'} {Math.abs(v.pct).toFixed(1)}%
    </span>
  )
}

export default function ComparativoAnualTab({ cuotas, gastos, moneda }: Props) {
  const anioActual = new Date().getFullYear()
  const aniosDisponibles = useMemo(() => {
    const set = new Set<number>([anioActual, anioActual - 1])
    cuotas.forEach(c => { if (c.periodo) set.add(parseInt(c.periodo.slice(0, 4))) })
    gastos.forEach(g => { if (g.fecha) set.add(parseInt(g.fecha.slice(0, 4))) })
    return Array.from(set).sort((a, b) => b - a)
  }, [cuotas, gastos, anioActual])

  const [anioA, setAnioA] = useState(anioActual)
  const [anioB, setAnioB] = useState(anioActual - 1)

  const datosA = useMemo(() => datosAnio(cuotas, gastos, anioA), [cuotas, gastos, anioA])
  const datosB = useMemo(() => datosAnio(cuotas, gastos, anioB), [cuotas, gastos, anioB])

  const totalesA = useMemo(() => datosA.reduce((acc, m) => ({
    ingresos: acc.ingresos + m.ingresos, egresos: acc.egresos + m.egresos, superavit: acc.superavit + m.superavit
  }), { ingresos: 0, egresos: 0, superavit: 0 }), [datosA])

  const totalesB = useMemo(() => datosB.reduce((acc, m) => ({
    ingresos: acc.ingresos + m.ingresos, egresos: acc.egresos + m.egresos, superavit: acc.superavit + m.superavit
  }), { ingresos: 0, egresos: 0, superavit: 0 }), [datosB])

  const maxVal = Math.max(
    ...datosA.map(m => Math.max(m.ingresos, m.egresos)),
    ...datosB.map(m => Math.max(m.ingresos, m.egresos)),
    1
  )

  const SEL = { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 13, background: 'var(--at-surface)', fontWeight: 600 }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Comparativo Anual</div>

      {/* Selectores */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={anioA} onChange={e => setAnioA(Number(e.target.value))} style={{ ...SEL, color: 'var(--at-primary)' }}>
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span style={{ fontWeight: 700, color: 'var(--at-ink-3)' }}>vs</span>
        <select value={anioB} onChange={e => setAnioB(Number(e.target.value))} style={{ ...SEL, color: 'var(--at-accent-hover)' }}>
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* KPIs anuales */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Ingresos totales', a: totalesA.ingresos, b: totalesB.ingresos, inv: false },
          { label: 'Egresos totales', a: totalesA.egresos, b: totalesB.egresos, inv: true },
          { label: 'Superávit anual', a: totalesA.superavit, b: totalesB.superavit, inv: false },
        ].map(k => {
          const v = variacion(k.a, k.b)
          return (
            <div key={k.label} style={{ flex: '1 1 150px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>{k.label}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 9, color: 'var(--at-primary)', fontWeight: 600 }}>{anioA}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--at-ink)' }}>{moneda} {Math.round(k.a).toLocaleString('es')}</div>
                </div>
                <Badge v={v} invertido={k.inv} />
              </div>
              <div style={{ fontSize: 10, color: 'var(--at-accent-hover)' }}>{anioB}: {moneda} {Math.round(k.b).toLocaleString('es')}</div>
            </div>
          )
        })}
      </div>

      {/* Gráfica lado a lado */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--at-ink)', marginBottom: 10 }}>Ingresos vs Egresos por mes</div>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 130 }}>
          {MESES.map((mes, i) => {
            const mA = datosA[i], mB = datosB[i]
            return (
              <div key={mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', height: 110 }}>
                  {/* Año A — ingresos */}
                  <div style={{ flex: 1, background: 'var(--at-primary)', opacity: 0.85, borderRadius: '2px 2px 0 0',
                    height: `${(mA.ingresos / maxVal) * 100}%`, minHeight: mA.ingresos > 0 ? 2 : 0 }} />
                  {/* Año A — egresos */}
                  <div style={{ flex: 1, background: 'var(--at-warning)', opacity: 0.85, borderRadius: '2px 2px 0 0',
                    height: `${(mA.egresos / maxVal) * 100}%`, minHeight: mA.egresos > 0 ? 2 : 0 }} />
                  {/* Año B — ingresos */}
                  <div style={{ flex: 1, background: 'var(--at-accent-hover)', opacity: 0.6, borderRadius: '2px 2px 0 0',
                    height: `${(mB.ingresos / maxVal) * 100}%`, minHeight: mB.ingresos > 0 ? 2 : 0 }} />
                  {/* Año B — egresos */}
                  <div style={{ flex: 1, background: 'var(--at-warning)', opacity: 0.4, borderRadius: '2px 2px 0 0',
                    height: `${(mB.egresos / maxVal) * 100}%`, minHeight: mB.egresos > 0 ? 2 : 0 }} />
                </div>
                <div style={{ fontSize: 8, color: 'var(--at-ink-3)' }}>{mes}</div>
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 10, flexWrap: 'wrap' }}>
          {[
            { color: 'var(--at-primary)', opacity: '0.85', label: `${anioA} Ingresos` },
            { color: 'var(--at-warning)', opacity: '0.85', label: `${anioA} Egresos` },
            { color: 'var(--at-accent-hover)', opacity: '0.6', label: `${anioB} Ingresos` },
            { color: 'var(--at-warning)', opacity: '0.4', label: `${anioB} Egresos` },
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 10, height: 10, background: l.color, opacity: parseFloat(l.opacity), borderRadius: 2, display: 'inline-block' }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Tabla mes a mes */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--at-surface-2)' }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--at-ink-3)', fontWeight: 600 }}>Mes</th>
              <th colSpan={3} style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--at-primary)', fontWeight: 700, borderRight: '2px solid var(--at-line)' }}>{anioA}</th>
              <th colSpan={3} style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--at-accent-hover)', fontWeight: 700, borderRight: '2px solid var(--at-line)' }}>{anioB}</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--at-ink-3)', fontWeight: 600 }}>Δ Ingresos</th>
            </tr>
            <tr style={{ background: 'var(--at-surface-2)', borderTop: '1px solid var(--at-chip)' }}>
              <th style={{ padding: '4px 10px' }} />
              <th style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 500, fontSize: 10 }}>Ingresos</th>
              <th style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 500, fontSize: 10 }}>Egresos</th>
              <th style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 500, fontSize: 10, borderRight: '2px solid var(--at-line)' }}>Saldo</th>
              <th style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 500, fontSize: 10 }}>Ingresos</th>
              <th style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 500, fontSize: 10 }}>Egresos</th>
              <th style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--at-ink-3)', fontWeight: 500, fontSize: 10, borderRight: '2px solid var(--at-line)' }}>Saldo</th>
              <th style={{ padding: '4px 10px' }} />
            </tr>
          </thead>
          <tbody>
            {MESES.map((mes, i) => {
              const mA = datosA[i], mB = datosB[i]
              const v = variacion(mA.ingresos, mB.ingresos)
              const noData = mA.ingresos === 0 && mA.egresos === 0 && mB.ingresos === 0 && mB.egresos === 0
              return (
                <tr key={mes} style={{ borderTop: '1px solid var(--at-chip)', opacity: noData ? 0.4 : 1 }}>
                  <td style={{ padding: '7px 10px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{mes}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--at-success)' }}>{mA.ingresos > 0 ? `${moneda} ${Math.round(mA.ingresos).toLocaleString('es')}` : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--at-danger)' }}>{mA.egresos > 0 ? `${moneda} ${Math.round(mA.egresos).toLocaleString('es')}` : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: mA.superavit >= 0 ? 'var(--at-success)' : 'var(--at-danger)', borderRight: '2px solid var(--at-line)' }}>
                    {(mA.ingresos > 0 || mA.egresos > 0) ? `${mA.superavit >= 0 ? '+' : ''}${moneda} ${Math.round(mA.superavit).toLocaleString('es')}` : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--at-accent-hover)' }}>{mB.ingresos > 0 ? `${moneda} ${Math.round(mB.ingresos).toLocaleString('es')}` : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--at-accent-hover)' }}>{mB.egresos > 0 ? `${moneda} ${Math.round(mB.egresos).toLocaleString('es')}` : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: mB.superavit >= 0 ? 'var(--at-accent-hover)' : 'var(--at-danger)', borderRight: '2px solid var(--at-line)' }}>
                    {(mB.ingresos > 0 || mB.egresos > 0) ? `${mB.superavit >= 0 ? '+' : ''}${moneda} ${Math.round(mB.superavit).toLocaleString('es')}` : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                    {!noData && <Badge v={v} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {Math.round(totalesA.ingresos).toLocaleString('es')}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--at-danger)' }}>{moneda} {Math.round(totalesA.egresos).toLocaleString('es')}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: totalesA.superavit >= 0 ? 'var(--at-success)' : 'var(--at-danger)', borderRight: '2px solid var(--at-line)' }}>
                {totalesA.superavit >= 0 ? '+' : ''}{moneda} {Math.round(totalesA.superavit).toLocaleString('es')}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--at-accent-hover)' }}>{moneda} {Math.round(totalesB.ingresos).toLocaleString('es')}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--at-accent-hover)' }}>{moneda} {Math.round(totalesB.egresos).toLocaleString('es')}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: totalesB.superavit >= 0 ? 'var(--at-accent-hover)' : 'var(--at-danger)', borderRight: '2px solid var(--at-line)' }}>
                {totalesB.superavit >= 0 ? '+' : ''}{moneda} {Math.round(totalesB.superavit).toLocaleString('es')}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                <Badge v={variacion(totalesA.ingresos, totalesB.ingresos)} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
