import { useMemo, useState } from 'react'
import { GastoCondominio, CuotaCondominio } from '../../../types'

interface Props {
  gastos: GastoCondominio[]
  cuotas: CuotaCondominio[]
  moneda: string
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const CAT_COLOR: Record<string, string> = {
  mantenimiento: '#2F5D4F', servicios: '#B96A3F', administracion: '#f59e0b',
  seguridad: '#ef4444', limpieza: '#10b981', mejoras: '#B96A3F', otro: '#7E9389',
}

export default function CentroCostosTab({ gastos, cuotas, moneda }: Props) {
  const anios = useMemo(() => {
    const set = new Set(gastos.map(g => g.fecha?.slice(0, 4)).filter(Boolean) as string[])
    set.add(new Date().getFullYear().toString())
    return [...set].sort().reverse()
  }, [gastos])

  const [anio, setAnio] = useState(() => anios[0] ?? new Date().getFullYear().toString())

  const gastosFiltrados = gastos.filter(g => g.fecha?.startsWith(anio))
  const gastoTotal = gastosFiltrados.reduce((s, g) => s + (g.monto ?? 0), 0)

  const ingresoAnio = cuotas
    .filter(c => c.estado === 'pagado' && c.periodo?.startsWith(anio))
    .reduce((s, c) => s + (c.monto ?? 0), 0)

  const porCategoria = useMemo(() => {
    const map: Record<string, number> = {}
    gastosFiltrados.forEach(g => {
      const cat = g.categoria ?? 'otro'
      map[cat] = (map[cat] ?? 0) + (g.monto ?? 0)
    })
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [gastosFiltrados])

  const maxCat = Math.max(...porCategoria.map(([, v]) => v), 1)

  const meses = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => {
      const k = `${anio}-${String(i + 1).padStart(2, '0')}`
      return { k, label: MESES[i], monto: gastos.filter(g => g.fecha?.startsWith(k)).reduce((s, g) => s + (g.monto ?? 0), 0) }
    }), [gastos, anio])

  const maxMes = Math.max(...meses.map(m => m.monto), 1)
  const superavit = ingresoAnio - gastoTotal

  return (
    <div style={{ padding: 16 }}>
      {/* Selector año */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#15291F' }}>Centro de costos</div>
        <select value={anio} onChange={e => setAnio(e.target.value)}
          style={{ padding: '7px 12px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#ef4444' }}>{moneda} {gastoTotal.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 600 }}>Total gastos {anio}</div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>{moneda} {ingresoAnio.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Ingresos cuotas {anio}</div>
        </div>
        <div style={{ background: superavit >= 0 ? '#f0fdf4' : '#fef2f2', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: superavit >= 0 ? '#16a34a' : '#ef4444' }}>
            {superavit >= 0 ? '+' : ''}{moneda} {Math.abs(superavit).toLocaleString('es', { minimumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 11, color: superavit >= 0 ? '#16a34a' : '#ef4444', fontWeight: 600 }}>
            {superavit >= 0 ? 'Superávit' : 'Déficit'}
          </div>
        </div>
        <div style={{ background: '#FAF1EA', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#9C5733' }}>
            {ingresoAnio > 0 ? Math.round((gastoTotal / ingresoAnio) * 100) : 0}%
          </div>
          <div style={{ fontSize: 11, color: '#9C5733', fontWeight: 600 }}>Ratio gasto/ingreso</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Por categoría */}
        <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Distribución por categoría</div>
          {porCategoria.length === 0 ? (
            <div style={{ color: '#7E9389', fontSize: 12, textAlign: 'center', padding: '24px 0' }}>Sin gastos en {anio}</div>
          ) : porCategoria.map(([cat, monto]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span style={{ textTransform: 'capitalize', color: '#3E5A4C' }}>{cat}</span>
                <span style={{ fontWeight: 600, color: CAT_COLOR[cat] ?? '#7E9389' }}>
                  {moneda} {monto.toLocaleString('es', { minimumFractionDigits: 2 })}
                  <span style={{ color: '#7E9389', fontWeight: 400, marginLeft: 4 }}>
                    ({gastoTotal > 0 ? Math.round((monto / gastoTotal) * 100) : 0}%)
                  </span>
                </span>
              </div>
              <div style={{ background: '#EAE6D8', borderRadius: 4, height: 7 }}>
                <div style={{ height: '100%', background: CAT_COLOR[cat] ?? '#7E9389', width: `${(monto / maxCat) * 100}%`, borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Tendencia mensual */}
        <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Gastos mensuales {anio}</div>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 120, marginBottom: 6 }}>
            {meses.map(m => (
              <div key={m.k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div
                  style={{ width: '100%', background: '#D9E2DC', borderRadius: '3px 3px 0 0', height: `${(m.monto / maxMes) * 100}%`, minHeight: m.monto > 0 ? 3 : 0 }}
                  title={`${m.label}: ${moneda} ${m.monto.toFixed(2)}`}
                />
                <div style={{ fontSize: 8, color: '#7E9389' }}>{m.label}</div>
              </div>
            ))}
          </div>
          {gastoTotal > 0 && (
            <div style={{ padding: '8px 12px', background: '#FAF7EF', borderRadius: 8, fontSize: 11, color: '#7E9389', textAlign: 'center' }}>
              Promedio mensual: <strong style={{ color: '#3E5A4C' }}>{moneda} {(gastoTotal / 12).toLocaleString('es', { minimumFractionDigits: 2 })}</strong>
              {' · '}Mes más alto: <strong style={{ color: '#ef4444' }}>{moneda} {Math.max(...meses.map(m => m.monto)).toLocaleString('es', { minimumFractionDigits: 2 })}</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
