import { mesLocalISO } from '../../../lib/format'
import { useMemo } from 'react'
import { CuotaCondominio, GastoCondominio } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  moneda: string
}

const MES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function addMeses(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const date = new Date(y, m - 1 + n, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function labelMes(ym: string): string {
  const [y, m] = ym.split('-')
  return `${MES_LABEL[parseInt(m) - 1]} ${y}`
}

function ultimosMeses(n: number): string[] {
  const result: string[] = []
  const hoy = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
}

export default function PronosticoFinancieroTab({ cuotas, gastos, moneda }: Props) {
  const mesActual = mesLocalISO()
  const historico = useMemo(() => ultimosMeses(6), [])

  // Promedio histórico de ingresos (cuotas pagadas) y egresos (gastos)
  const promedios = useMemo(() => {
    const ingresosPorMes = historico.map(mes => ({
      mes,
      ingresos: cuotas.filter(c => c.periodo === mes && c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
      cuotasTotal: cuotas.filter(c => c.periodo === mes).reduce((s, c) => s + c.monto, 0),
      egresos: gastos.filter(g => g.fecha?.startsWith(mes) && g.estado !== 'anulado').reduce((s, g) => s + g.monto, 0),
    }))

    const mesesConDatos = ingresosPorMes.filter(m => m.cuotasTotal > 0 || m.egresos > 0)
    const n = mesesConDatos.length || 1

    return {
      ingresos: mesesConDatos.reduce((s, m) => s + m.ingresos, 0) / n,
      cuotasTotal: mesesConDatos.reduce((s, m) => s + m.cuotasTotal, 0) / n,
      egresos: mesesConDatos.reduce((s, m) => s + m.egresos, 0) / n,
      tasaCobro: mesesConDatos.reduce((s, m) => s + (m.cuotasTotal > 0 ? m.ingresos / m.cuotasTotal : 0), 0) / n,
      historico: ingresosPorMes,
    }
  }, [cuotas, gastos, historico])

  const proyeccion = useMemo(() => {
    const meses6 = Array.from({ length: 6 }, (_, i) => addMeses(mesActual, i + 1))
    return meses6.map((mes, i) => {
      // Ajuste de tendencia lineal simple
      const tendenciaEgresos = promedios.historico.length > 1
        ? (promedios.historico[promedios.historico.length - 1].egresos - promedios.historico[0].egresos) / promedios.historico.length * 0.3
        : 0
      const ingresosProyectados = promedios.cuotasTotal * (0.9 + Math.random() * 0.0) // sin aleatoriedad real, baseline
      const egresosProyectados = Math.max(0, promedios.egresos + tendenciaEgresos * (i + 1))
      const superavit = ingresosProyectados - egresosProyectados
      return { mes, ingresos: ingresosProyectados, egresos: egresosProyectados, superavit }
    })
  }, [promedios, mesActual])

  const saldoAcumulado = proyeccion.reduce((s, p) => s + p.superavit, 0)
  const mesesEnRojo = proyeccion.filter(p => p.superavit < 0).length

  const maxVal = Math.max(
    ...promedios.historico.map(m => Math.max(m.cuotasTotal, m.egresos)),
    ...proyeccion.map(p => Math.max(p.ingresos, p.egresos)),
    1
  )

  function barra(val: number, color: string, opacity = 1) {
    const pct = (val / maxVal) * 100
    return (
      <div style={{ background: 'var(--at-chip)', borderRadius: 4, height: 8, marginTop: 2 }}>
        <div style={{ height: 8, borderRadius: 4, width: `${pct}%`, background: color, opacity }} />
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)', marginBottom: 4 }}>Pronóstico Financiero</div>
      <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 16 }}>
        Proyección a 6 meses basada en el promedio histórico de los últimos 6 meses
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Ingreso prom./mes', val: `${moneda} ${Math.round(promedios.ingresos).toLocaleString('es')}`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Egreso prom./mes',  val: `${moneda} ${Math.round(promedios.egresos).toLocaleString('es')}`,  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
          { label: 'Superávit prom.',   val: `${moneda} ${Math.round(promedios.ingresos - promedios.egresos).toLocaleString('es')}`, color: (promedios.ingresos - promedios.egresos) >= 0 ? 'var(--at-success)' : 'var(--at-danger)', bg: (promedios.ingresos - promedios.egresos) >= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)' },
          { label: 'Tasa cobro hist.',  val: `${Math.round(promedios.tasaCobro * 100)}%`,  color: promedios.tasaCobro >= 0.8 ? 'var(--at-success)' : 'var(--at-warning)', bg: promedios.tasaCobro >= 0.8 ? 'var(--at-success-tint)' : 'var(--at-warning-tint)' },
          { label: 'Proyectado 6m',     val: `${moneda} ${Math.round(saldoAcumulado).toLocaleString('es')}`, color: saldoAcumulado >= 0 ? 'var(--at-success)' : 'var(--at-danger)', bg: saldoAcumulado >= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)' },
          { label: 'Meses en rojo',     val: String(mesesEnRojo), color: mesesEnRojo === 0 ? 'var(--at-success)' : 'var(--at-danger)', bg: mesesEnRojo === 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)' },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 120px', background: k.bg, border: `1px solid ${k.color}33`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{k.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Histórico */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 12 }}>Histórico (últimos 6 meses)</div>
          {promedios.historico.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600, marginBottom: 3 }}>{labelMes(m.mes)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--at-success)', marginBottom: 1 }}>
                <span>Cobrado</span><span style={{ fontWeight: 700 }}>{moneda} {Math.round(m.ingresos).toLocaleString('es')}</span>
              </div>
              {barra(m.ingresos, 'var(--at-success)')}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--at-danger)', marginBottom: 1, marginTop: 4 }}>
                <span>Egresos</span><span style={{ fontWeight: 700 }}>{moneda} {Math.round(m.egresos).toLocaleString('es')}</span>
              </div>
              {barra(m.egresos, 'var(--at-danger)')}
            </div>
          ))}
        </div>

        {/* Proyección */}
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-ink)', marginBottom: 2 }}>Proyección (próximos 6 meses)</div>
          <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 12 }}>Basada en promedio histórico</div>
          {proyeccion.map((p, i) => {
            const balance = p.ingresos - p.egresos
            return (
              <div key={i} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>{labelMes(p.mes)}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: balance >= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
                    {balance >= 0 ? '+' : ''}{moneda} {Math.round(balance).toLocaleString('es')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--at-primary)', marginBottom: 1 }}>
                  <span>Ingresos</span><span>{moneda} {Math.round(p.ingresos).toLocaleString('es')}</span>
                </div>
                {barra(p.ingresos, 'var(--at-primary)', 0.7)}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--at-warning)', marginBottom: 1, marginTop: 4 }}>
                  <span>Egresos</span><span>{moneda} {Math.round(p.egresos).toLocaleString('es')}</span>
                </div>
                {barra(p.egresos, 'var(--at-warning)', 0.7)}
              </div>
            )
          })}

          <div style={{ marginTop: 12, padding: '8px 12px', background: saldoAcumulado >= 0 ? 'var(--at-success-tint)' : 'var(--at-danger-tint)', borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Balance proyectado 6 meses</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: saldoAcumulado >= 0 ? 'var(--at-success)' : 'var(--at-danger)' }}>
              {saldoAcumulado >= 0 ? '+' : ''}{moneda} {Math.round(saldoAcumulado).toLocaleString('es')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, padding: '8px 14px', background: 'var(--at-surface-2)', borderRadius: 8, fontSize: 11, color: 'var(--at-ink-3)' }}>
        ⚠️ El pronóstico es estimativo. Usa el promedio de ingresos cobrados y egresos de los últimos 6 meses. No incluye gastos extraordinarios ni variaciones estacionales.
      </div>
    </div>
  )
}
