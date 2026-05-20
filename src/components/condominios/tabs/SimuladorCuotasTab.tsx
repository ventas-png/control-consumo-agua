import { useState, useMemo, type ReactElement} from 'react'
import { CuotaCondominio, GastoCondominio, Unidad } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  unidades: Unidad[]
  moneda: string
}

function addMes(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function labelMes(ym: string): string {
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const [, m] = ym.split('-')
  return MESES[parseInt(m) - 1]
}

export default function SimuladorCuotasTab({ cuotas, gastos, unidades, moneda }: Props) {
  const totalUnidades = unidades.length || 1

  // Cálculo de baseline
  const baseline = useMemo(() => {
    const mesActual = new Date().toISOString().slice(0, 7)
    const meses6: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      meses6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const ingProm = meses6.reduce((s, mes) =>
      s + cuotas.filter(c => c.periodo === mes && c.estado === 'pagado').reduce((a, c) => a + c.monto, 0)
    , 0) / 6
    const egProm = meses6.reduce((s, mes) =>
      s + gastos.filter(g => g.fecha?.startsWith(mes) && g.estado !== 'anulado').reduce((a, g) => a + g.monto, 0)
    , 0) / 6
    const cuotaPromedio = cuotas.length > 0
      ? cuotas.reduce((s, c) => s + c.monto, 0) / cuotas.length
      : 0
    const tasaCobro = meses6.reduce((s, mes) => {
      const total = cuotas.filter(c => c.periodo === mes).reduce((a, c) => a + c.monto, 0)
      const cobrado = cuotas.filter(c => c.periodo === mes && c.estado === 'pagado').reduce((a, c) => a + c.monto, 0)
      return s + (total > 0 ? cobrado / total : 0)
    }, 0) / 6
    void mesActual
    return { ingProm, egProm, cuotaPromedio, tasaCobro }
  }, [cuotas, gastos])

  const [cuotaMensual, setCuotaMensual] = useState<number>(() => Math.round(baseline.cuotaPromedio) || 500)
  const [pctCobro, setPctCobro] = useState<number>(Math.round(baseline.tasaCobro * 100) || 80)
  const [crecimientoEgresos, setCrecimientoEgresos] = useState<number>(2)
  const [mesesProyeccion, setMesesProyeccion] = useState<number>(12)

  const proyeccion = useMemo(() => {
    const mesActual = new Date().toISOString().slice(0, 7)
    return Array.from({ length: mesesProyeccion }, (_, i) => {
      const mes = addMes(mesActual, i + 1)
      const ingresos = cuotaMensual * totalUnidades * (pctCobro / 100)
      const egresos = baseline.egProm * Math.pow(1 + crecimientoEgresos / 100, i / 12)
      const superavit = ingresos - egresos
      return { mes, ingresos, egresos, superavit }
    })
  }, [cuotaMensual, pctCobro, crecimientoEgresos, mesesProyeccion, baseline, totalUnidades])

  const saldoAcumulado = proyeccion.reduce((s, p) => s + p.superavit, 0)
  const mesesNeg = proyeccion.filter(p => p.superavit < 0).length
  const puntoEquilibrio = Math.ceil(baseline.egProm / (totalUnidades * (pctCobro / 100))) || 0

  const maxBar = Math.max(...proyeccion.map(p => Math.max(p.ingresos, p.egresos)), 1)

  const INPUT_STYLE = {
    width: '100%', padding: '6px 10px', borderRadius: 8,
    border: '1px solid var(--at-line-strong)', fontSize: 13, background: 'var(--at-surface)',
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 2 }}>Simulador de Cuotas</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 16 }}>
        Ajusta los parámetros y visualiza el impacto financiero en tiempo real
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        {/* Panel de controles */}
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 14 }}>Parámetros</div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Cuota mensual por unidad — <span style={{ color: 'var(--at-primary)' }}>{moneda} {cuotaMensual.toLocaleString('es')}</span>
            </label>
            <input type="range" min={0} max={Math.max(cuotaMensual * 3, 5000)} step={50}
              value={cuotaMensual}
              onChange={e => setCuotaMensual(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--at-primary)' }} />
            <input type="number" value={cuotaMensual} onChange={e => setCuotaMensual(Number(e.target.value))}
              style={{ ...INPUT_STYLE, marginTop: 6 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Tasa de cobro — <span style={{ color: '#16a34a' }}>{pctCobro}%</span>
            </label>
            <input type="range" min={0} max={100} step={1}
              value={pctCobro}
              onChange={e => setPctCobro(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#16a34a' }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Crecimiento egresos/año — <span style={{ color: '#ef4444' }}>{crecimientoEgresos}%</span>
            </label>
            <input type="range" min={-10} max={30} step={0.5}
              value={crecimientoEgresos}
              onChange={e => setCrecimientoEgresos(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#ef4444' }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: 'var(--at-ink-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Meses a proyectar
            </label>
            {[6, 12, 24].map(n => (
              <button key={n} onClick={() => setMesesProyeccion(n)}
                style={{ marginRight: 6, padding: '4px 12px', borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 12, cursor: 'pointer',
                  background: mesesProyeccion === n ? 'var(--at-primary)' : '#fff',
                  color: mesesProyeccion === n ? '#fff' : 'var(--at-ink-2)', fontWeight: mesesProyeccion === n ? 700 : 400 }}>
                {n}m
              </button>
            ))}
          </div>

          {/* Baseline info */}
          <div style={{ marginTop: 16, padding: '10px 12px', background: 'var(--at-primary-tint)', borderRadius: 8, fontSize: 11, color: 'var(--at-primary-hover)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Datos históricos (últ. 6 meses)</div>
            <div>Ingreso prom.: {moneda} {Math.round(baseline.ingProm).toLocaleString('es')}/mes</div>
            <div>Egreso prom.: {moneda} {Math.round(baseline.egProm).toLocaleString('es')}/mes</div>
            <div>Tasa cobro: {Math.round(baseline.tasaCobro * 100)}%</div>
            <div>Unidades: {totalUnidades}</div>
          </div>
        </div>

        {/* Panel de resultados */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Ingreso proyectado/mes', val: `${moneda} ${Math.round(cuotaMensual * totalUnidades * (pctCobro / 100)).toLocaleString('es')}`, color: '#16a34a', bg: '#dcfce7' },
              { label: 'Saldo acumulado', val: `${saldoAcumulado >= 0 ? '+' : ''}${moneda} ${Math.round(saldoAcumulado).toLocaleString('es')}`, color: saldoAcumulado >= 0 ? '#16a34a' : '#ef4444', bg: saldoAcumulado >= 0 ? '#dcfce7' : '#fef2f2' },
              { label: 'Meses en déficit', val: String(mesesNeg), color: mesesNeg === 0 ? '#16a34a' : '#ef4444', bg: mesesNeg === 0 ? '#dcfce7' : '#fef2f2' },
              { label: 'Punto de equilibrio', val: `${moneda} ${puntoEquilibrio.toLocaleString('es')}/unidad`, color: 'var(--at-primary)', bg: 'var(--at-primary-tint)' },
              { label: 'Potencial máximo/mes', val: `${moneda} ${Math.round(cuotaMensual * totalUnidades).toLocaleString('es')}`, color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint-2)' },
            ].map(k => (
              <div key={k.label} style={{ flex: '1 1 130px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
              </div>
            ))}
          </div>

          {/* Gráfica */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--at-ink)', marginBottom: 12 }}>
              Proyección {mesesProyeccion} meses
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 140 }}>
              {proyeccion.map((p, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', height: 120 }}>
                    <div style={{ flex: 1, background: 'var(--at-primary)', opacity: 0.8, borderRadius: '3px 3px 0 0',
                      height: `${(p.ingresos / maxBar) * 100}%`, minHeight: 2 }} />
                    <div style={{ flex: 1, background: p.egresos > p.ingresos ? '#ef4444' : '#f97316', opacity: 0.8, borderRadius: '3px 3px 0 0',
                      height: `${(p.egresos / maxBar) * 100}%`, minHeight: 2 }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--at-ink-3)', transform: 'rotate(-30deg)', marginTop: 4, whiteSpace: 'nowrap' }}>
                    {labelMes(p.mes)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, background: 'var(--at-primary)', borderRadius: 2, display: 'inline-block' }} />
                Ingresos
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, background: '#f97316', borderRadius: 2, display: 'inline-block' }} />
                Egresos
              </span>
            </div>
          </div>

          {/* Tabla resumen */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)' }}>
                  {['Mes', 'Ingresos', 'Egresos', 'Superávit/Déficit', 'Acumulado'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Mes' ? 'left' : 'right', color: 'var(--at-ink-3)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {proyeccion.reduce<{ rows: ReactElement[]; acum: number }>((acc, p, i) => {
                  acc.acum += p.superavit
                  acc.rows.push(
                    <tr key={i} style={{ borderTop: '1px solid var(--at-chip)', background: p.superavit < 0 ? '#fef2f2' : undefined }}>
                      <td style={{ padding: '6px 10px', color: 'var(--at-ink-3)' }}>{labelMes(p.mes)} {p.mes.slice(0, 4)}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: '#16a34a' }}>{moneda} {Math.round(p.ingresos).toLocaleString('es')}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: '#ef4444' }}>{moneda} {Math.round(p.egresos).toLocaleString('es')}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: p.superavit >= 0 ? '#16a34a' : '#ef4444' }}>
                        {p.superavit >= 0 ? '+' : ''}{moneda} {Math.round(p.superavit).toLocaleString('es')}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: acc.acum >= 0 ? '#16a34a' : '#ef4444' }}>
                        {acc.acum >= 0 ? '+' : ''}{moneda} {Math.round(acc.acum).toLocaleString('es')}
                      </td>
                    </tr>
                  )
                  return acc
                }, { rows: [], acum: 0 }).rows}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: '8px 14px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 11, color: 'var(--at-ink-3)' }}>
        ⚠️ Simulación estimativa. Los ingresos proyectados = cuota × unidades × tasa cobro. Los egresos aplican el crecimiento compuesto mensual.
      </div>
    </div>
  )
}
