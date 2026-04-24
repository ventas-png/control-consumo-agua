import { useMemo, useState } from 'react'
import { GastoCondominio, PresupuestoCondominio, CategoriaGasto } from '../../../types'

interface Props {
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  moneda: string
}

const CATEGORIAS: CategoriaGasto[] = ['mantenimiento', 'servicios', 'administrativo', 'seguridad', 'limpieza', 'obras', 'otros']
const CAT_LABEL: Record<CategoriaGasto, string> = {
  mantenimiento: 'Mantenimiento', servicios: 'Servicios', administrativo: 'Administrativo',
  seguridad: 'Seguridad', limpieza: 'Limpieza', obras: 'Obras', otros: 'Otros',
}

const MES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function semaforo(pct: number): { bg: string; color: string; label: string } {
  if (pct <= 85)  return { bg: '#dcfce7', color: '#16a34a', label: 'OK' }
  if (pct <= 100) return { bg: '#fef3c7', color: '#d97706', label: 'Alerta' }
  return { bg: '#fef2f2', color: '#ef4444', label: 'Excedido' }
}

function fmt(n: number, moneda: string) {
  return `${moneda} ${n.toLocaleString('es', { maximumFractionDigits: 0 })}`
}

export default function ComparativoPresupuestoTab({ gastos, presupuestos, moneda }: Props) {
  const anioActual = new Date().getFullYear()
  const [anio, setAnio] = useState(anioActual)
  const [vista, setVista] = useState<'categorias' | 'meses'>('categorias')

  const aniosDisponibles = useMemo(() => {
    const set = new Set<number>()
    set.add(anioActual)
    presupuestos.forEach(p => set.add(p.anio))
    gastos.forEach(g => { if (g.fecha) set.add(new Date(g.fecha).getFullYear()) })
    return Array.from(set).sort((a, b) => b - a)
  }, [gastos, presupuestos, anioActual])

  const gastosAnio = useMemo(() =>
    gastos.filter(g => g.fecha?.startsWith(String(anio)) && g.estado !== 'anulado'),
    [gastos, anio]
  )

  const presupuestosAnio = useMemo(() =>
    presupuestos.filter(p => p.anio === anio),
    [presupuestos, anio]
  )

  // Vista por categorías
  const filasCat = useMemo(() => CATEGORIAS.map(cat => {
    const presup = presupuestosAnio.filter(p => p.categoria === cat).reduce((s, p) => s + p.monto_presupuestado, 0)
    const real = gastosAnio.filter(g => g.categoria === cat).reduce((s, g) => s + g.monto, 0)
    const pct = presup > 0 ? Math.round((real / presup) * 100) : (real > 0 ? 999 : 0)
    return { cat, presup, real, variacion: real - presup, pct }
  }), [gastosAnio, presupuestosAnio])

  const totalPresup = filasCat.reduce((s, f) => s + f.presup, 0)
  const totalReal = filasCat.reduce((s, f) => s + f.real, 0)
  const totalPct = totalPresup > 0 ? Math.round((totalReal / totalPresup) * 100) : 0

  // Vista por meses
  const filasMes = useMemo(() => Array.from({ length: 12 }, (_, i) => {
    const mesStr = `${anio}-${String(i + 1).padStart(2, '0')}`
    const real = gastosAnio.filter(g => g.fecha?.startsWith(mesStr)).reduce((s, g) => s + g.monto, 0)
    const presupMes = totalPresup / 12
    const pct = presupMes > 0 ? Math.round((real / presupMes) * 100) : 0
    return { mes: i, label: MES_LABEL[i], real, presup: presupMes, pct }
  }), [gastosAnio, totalPresup, anio])

  const maxBarMes = Math.max(...filasMes.map(f => Math.max(f.real, f.presup)), 1)

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Comparativo Presupuesto vs. Real</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff' }}>
            {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, overflow: 'hidden' }}>
            {(['categorias', 'meses'] as const).map(v => (
              <button key={v} onClick={() => setVista(v)}
                style={{ padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
                  background: vista === v ? '#2563eb' : 'transparent', color: vista === v ? '#fff' : '#374151', fontWeight: vista === v ? 700 : 400 }}>
                {v === 'categorias' ? 'Por categoría' : 'Por mes'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Presupuesto anual', val: fmt(totalPresup, moneda), color: '#2563eb', bg: '#eff6ff' },
          { label: 'Ejecutado', val: fmt(totalReal, moneda), color: totalReal > totalPresup ? '#ef4444' : '#16a34a', bg: totalReal > totalPresup ? '#fef2f2' : '#dcfce7' },
          { label: 'Variación', val: fmt(totalReal - totalPresup, moneda), color: totalReal <= totalPresup ? '#16a34a' : '#ef4444', bg: '#f8fafc' },
          { ...semaforo(totalPct), label: 'Ejecución', val: `${totalPct}%` },
        ].map(k => (
          <div key={k.label} style={{ flex: '1 1 130px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      {vista === 'categorias' ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Categoría', 'Presupuestado', 'Ejecutado', 'Variación', '% Ejec.', 'Estado', 'Barra'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Categoría' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasCat.map((f, idx) => {
                const sem = f.presup === 0 && f.real === 0 ? { bg: '#f8fafc', color: '#9ca3af', label: '—' } : semaforo(f.pct)
                const barPct = f.presup > 0 ? Math.min((f.real / f.presup) * 100, 150) : 0
                return (
                  <tr key={f.cat} style={{ borderTop: idx > 0 ? '1px solid #f1f5f9' : undefined }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>{CAT_LABEL[f.cat]}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>{fmt(f.presup, moneda)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{fmt(f.real, moneda)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: f.variacion > 0 ? '#ef4444' : '#16a34a', fontWeight: 600 }}>
                      {f.variacion > 0 ? '+' : ''}{fmt(f.variacion, moneda)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: sem.color }}>{f.pct === 999 ? 'N/A' : `${f.pct}%`}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 20, background: sem.bg, color: sem.color, fontSize: 10, fontWeight: 600 }}>{sem.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px', width: 100 }}>
                      <div style={{ background: '#f1f5f9', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ height: 8, borderRadius: 4, width: `${barPct}%`, background: sem.color, transition: 'width 0.3s' }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid #e5e7eb', background: '#f8fafc' }}>
                <td style={{ padding: '10px 12px', fontWeight: 700, color: '#0f172a' }}>TOTAL</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{fmt(totalPresup, moneda)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{fmt(totalReal, moneda)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: (totalReal - totalPresup) > 0 ? '#ef4444' : '#16a34a' }}>
                  {(totalReal - totalPresup) > 0 ? '+' : ''}{fmt(totalReal - totalPresup, moneda)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: semaforo(totalPct).color }}>{totalPct}%</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 20, background: semaforo(totalPct).bg, color: semaforo(totalPct).color, fontSize: 10, fontWeight: 700 }}>{semaforo(totalPct).label}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
            Línea base mensual: presupuesto prorrateado ({fmt(totalPresup / 12, moneda)}/mes)
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, marginBottom: 8 }}>
            {filasMes.map(f => {
              const hPresup = (f.presup / maxBarMes) * 100
              const hReal = (f.real / maxBarMes) * 100
              const sem = semaforo(f.pct)
              return (
                <div key={f.mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 100 }}>
                    <div title={`Presupuesto: ${fmt(f.presup, moneda)}`}
                      style={{ width: 10, height: `${hPresup}%`, background: '#bfdbfe', borderRadius: '3px 3px 0 0', minHeight: 2 }} />
                    <div title={`Real: ${fmt(f.real, moneda)}`}
                      style={{ width: 10, height: `${hReal}%`, background: sem.color, borderRadius: '3px 3px 0 0', minHeight: f.real > 0 ? 2 : 0 }} />
                  </div>
                  <div style={{ fontSize: 9, color: '#9ca3af' }}>{f.label}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#6b7280' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#bfdbfe', borderRadius: 2, marginRight: 4 }} />Presupuesto</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', borderRadius: 2, marginRight: 4 }} />Real (OK)</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef4444', borderRadius: 2, marginRight: 4 }} />Real (excedido)</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 16 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Mes','Presup.','Real','Var.','% Ejec.'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Mes' ? 'left' : 'right', color: '#64748b', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasMes.map((f, i) => {
                const sem = semaforo(f.pct)
                return (
                  <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '7px 10px', fontWeight: 500 }}>{f.label}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{fmt(f.presup, moneda)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{fmt(f.real, moneda)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: f.real - f.presup > 0 ? '#ef4444' : '#16a34a' }}>
                      {f.real - f.presup > 0 ? '+' : ''}{fmt(f.real - f.presup, moneda)}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: sem.color }}>{f.pct}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPresup === 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
          ⚠️ No hay presupuesto configurado para {anio}. Agrega presupuestos en la pestaña <strong>Presupuesto</strong> para ver el comparativo.
        </div>
      )}
    </div>
  )
}
