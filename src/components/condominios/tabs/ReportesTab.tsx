import type { ReactNode } from 'react'
import type { CuotaCondominio, TicketMantenimiento, Visitante, ContratoProveedor, GastoCondominio, PresupuestoCondominio } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  contratos: ContratoProveedor[]
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  moneda: string
  proyectoNombre?: string
}

function fmt(n: number) { return n.toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '28px', pageBreakInside: 'avoid' }}>
      <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 800, color: '#15291F', borderBottom: '2px solid var(--at-line)', paddingBottom: '6px' }}>{title}</h3>
      {children}
    </div>
  )
}

function KpiGrid({ items }: { items: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
      {items.map(k => (
        <div key={k.label} style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: k.color ?? '#15291F' }}>{k.value}</div>
          <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
        </div>
      ))}
    </div>
  )
}

export function ReportesTab({ cuotas, tickets, visitantes, contratos, gastos, presupuestos, moneda, proyectoNombre }: Props) {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0')
  const periodoActual = `${currentYear}-${currentMonth}`

  // Financiero — cuotas
  const cuotasPendientes = cuotas.filter(c => c.estado === 'pendiente').length
  const cuotasMorosas   = cuotas.filter(c => c.estado === 'moroso').length
  const cuotasPagadas   = cuotas.filter(c => c.estado === 'pagado').length
  const montoPendiente  = cuotas.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
  const montoRecaudado  = cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)

  // Gastos del año actual
  const gastosAnio = gastos.filter(g => g.fecha.startsWith(String(currentYear)))
  const totalGastosAnio = gastosAnio.reduce((s, g) => s + g.monto, 0)
  const totalPresupuesto = presupuestos.filter(p => p.anio === currentYear).reduce((s, p) => s + p.monto_presupuestado, 0)
  const pctEjec = totalPresupuesto > 0 ? Math.round((totalGastosAnio / totalPresupuesto) * 100) : 0

  // Gastos por categoría
  const gastosCat: Record<string, number> = {}
  for (const g of gastosAnio) gastosCat[g.categoria] = (gastosCat[g.categoria] ?? 0) + g.monto
  const topCategorias = Object.entries(gastosCat).sort((a, b) => b[1] - a[1]).slice(0, 5)

  // Mantenimiento
  const ticketsAbiertos   = tickets.filter(t => t.estado === 'abierto').length
  const ticketsEnProceso  = tickets.filter(t => t.estado === 'en_proceso').length
  const ticketsResueltos  = tickets.filter(t => t.estado === 'resuelto' || t.estado === 'cerrado').length
  const costoTickets      = tickets.reduce((s, t) => s + (t.costo_real ?? 0), 0)
  const ticketsUrgentes   = tickets.filter(t => t.prioridad === 'urgente' && (t.estado === 'abierto' || t.estado === 'en_proceso')).length

  // Visitantes del mes
  const visitantesMes = visitantes.filter(v => v.hora_entrada.startsWith(`${currentYear}-${currentMonth}`))
  const visitantesTotal = visitantes.length

  // Contratos activos
  const contratosActivos = contratos.filter(c => c.estado === 'activo').length
  const contratosPorVencer = contratos.filter(c => {
    if (!c.fecha_fin) return false
    const d = Math.ceil((new Date(c.fecha_fin).getTime() - Date.now()) / 86400000)
    return d >= 0 && d <= 30
  }).length

  const printDate = now.toLocaleDateString('es-CR', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header — print trigger */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Reportes Ejecutivos</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#7E9389' }}>Generado: {printDate}</p>
        </div>
        <button onClick={() => window.print()}
          style={{ padding: '8px 20px', background: '#15291F', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          🖨️ Imprimir / PDF
        </button>
      </div>

      {/* Print header (hidden on screen) */}
      <div className="print-only" style={{ display: 'none', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>{proyectoNombre ?? 'Condominio'} — Reporte Ejecutivo</h1>
        <p style={{ margin: '4px 0 0', color: '#7E9389', fontSize: '13px' }}>{printDate}</p>
      </div>

      {/* 1. Resumen General */}
      <Section title="1. Resumen General">
        <KpiGrid items={[
          { label: 'Período',          value: periodoActual,                              color: '#1B3B36' },
          { label: 'Cuotas pendientes',value: String(cuotasPendientes),                  color: '#f59e0b' },
          { label: 'Cuotas morosas',   value: String(cuotasMorosas),                     color: '#ef4444' },
          { label: 'Tickets abiertos', value: String(ticketsAbiertos + ticketsEnProceso), color: ticketsUrgentes > 0 ? '#ef4444' : '#15291F' },
          { label: 'Contratos activos',value: String(contratosActivos),                  color: '#10b981' },
        ]} />
      </Section>

      {/* 2. Financiero */}
      <Section title="2. Financiero">
        <KpiGrid items={[
          { label: 'Recaudado (cuotas)', value: `${moneda} ${fmt(montoRecaudado)}`,  color: '#10b981' },
          { label: 'Por cobrar',         value: `${moneda} ${fmt(montoPendiente)}`,   color: '#f59e0b' },
          { label: 'Cuotas pagadas',     value: String(cuotasPagadas),                color: '#10b981' },
          { label: `Gastos ${currentYear}`, value: `${moneda} ${fmt(totalGastosAnio)}`, color: '#ef4444' },
          { label: 'Presupuesto anual',  value: `${moneda} ${fmt(totalPresupuesto)}`, color: '#1B3B36' },
          { label: '% Ejecución ppto.',  value: `${pctEjec}%`,                        color: pctEjec >= 100 ? '#ef4444' : pctEjec >= 80 ? '#f59e0b' : '#10b981' },
        ]} />

        {topCategorias.length > 0 && (
          <div style={{ marginTop: '14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#FAF7EF' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#7E9389', borderBottom: '1px solid var(--at-line)' }}>Categoría</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#7E9389', borderBottom: '1px solid var(--at-line)' }}>Gasto {currentYear}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#7E9389', borderBottom: '1px solid var(--at-line)' }}>% del Total</th>
                </tr>
              </thead>
              <tbody>
                {topCategorias.map(([cat, monto], i) => (
                  <tr key={cat} style={{ background: i % 2 === 0 ? 'white' : '#FAF7EF' }}>
                    <td style={{ padding: '8px 12px', color: '#15291F', textTransform: 'capitalize' }}>{cat}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{moneda} {fmt(monto)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#7E9389' }}>
                      {totalGastosAnio > 0 ? `${Math.round((monto / totalGastosAnio) * 100)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 3. Mantenimiento */}
      <Section title="3. Mantenimiento">
        <KpiGrid items={[
          { label: 'Abiertos',       value: String(ticketsAbiertos),   color: '#f59e0b' },
          { label: 'En proceso',     value: String(ticketsEnProceso),  color: '#1B3B36' },
          { label: 'Resueltos/Cerrados', value: String(ticketsResueltos), color: '#10b981' },
          { label: 'Urgentes activos',   value: String(ticketsUrgentes),  color: ticketsUrgentes > 0 ? '#ef4444' : '#10b981' },
          { label: 'Costo acumulado',    value: `${moneda} ${fmt(costoTickets)}`, color: '#B96A3F' },
        ]} />
      </Section>

      {/* 4. Ocupación y Visitas */}
      <Section title="4. Ocupación y Visitas">
        <KpiGrid items={[
          { label: 'Visitantes este mes',  value: String(visitantesMes.length),  color: '#1B3B36' },
          { label: 'Visitantes histórico', value: String(visitantesTotal),        color: '#7E9389' },
        ]} />
      </Section>

      {/* 5. Contratos y Vencimientos */}
      <Section title="5. Contratos y Vencimientos">
        <KpiGrid items={[
          { label: 'Contratos activos',     value: String(contratosActivos),   color: '#10b981' },
          { label: 'Vencen en 30 días',     value: String(contratosPorVencer), color: contratosPorVencer > 0 ? '#ef4444' : '#10b981' },
          { label: 'Contratos vencidos/term.', value: String(contratos.filter(c => c.estado !== 'activo').length), color: '#7E9389' },
        ]} />
      </Section>

      {/* Print styles injected inline via a style tag approach */}
      <style>{`
        @media print {
          .print-only { display: block !important; }
          button { display: none !important; }
        }
      `}</style>
    </div>
  )
}
