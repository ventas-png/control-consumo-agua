import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { EmptyState } from '../../shared/EmptyState'
import { StatTile } from '../../shared/StatTile'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { StatusBadge } from '../../shared/StatusBadge'
import type { FondoReserva, FondoReservaMovimiento, PresupuestoCondominio } from '../../../types'

// F3.12: Portal residente — Transparencia financiera.
// Cierra el gap B9 del design critique ("Portal residente subutilizado —
// sin transparencia financiera: fondo reserva, presupuesto").
//
// Read-only view de:
//   - Saldo actual del fondo de reserva
//   - Movimientos del fondo (aportes/retiros aprobados)
//   - Presupuesto anual vs. ejecución (por categoría)
// Diseñado para que cualquier residente pueda auditar las finanzas
// del condominio sin tener acceso a paneles administrativos.

interface Props {
  proyectoId: string
  moneda: string
}

interface KPIs {
  saldoFondo: number
  totalAportes: number
  totalRetiros: number
  ultimoAporte: string | null
  presupuestoAnual: number
  ejecutado: number
}

export function PortalTransparenciaTab({ proyectoId, moneda }: Props) {
  const [loading, setLoading] = useState(true)
  const [movimientos, setMovimientos] = useState<FondoReservaMovimiento[]>([])
  const [presupuestos, setPresupuestos] = useState<PresupuestoCondominio[]>([])
  const [kpis, setKpis] = useState<KPIs>({
    saldoFondo: 0, totalAportes: 0, totalRetiros: 0,
    ultimoAporte: null, presupuestoAnual: 0, ejecutado: 0,
  })

  useEffect(() => {
    void cargar()
  }, [proyectoId])

  async function cargar() {
    setLoading(true)

    // Fondo de reserva (legacy approvals model)
    const { data: fondo } = await supabase
      .from('fondo_reserva')
      .select('*')
      .eq('project_id', proyectoId)
      .eq('estado', 'aprobado')
      .order('fecha', { ascending: false })
      .limit(50)

    const fondoList = (fondo as FondoReserva[]) ?? []
    let saldoLegacy = 0
    let aportesL = 0, retirosL = 0
    let ultimoAporte: string | null = null
    fondoList.forEach(f => {
      if (f.tipo === 'aporte') { saldoLegacy += f.monto; aportesL += f.monto; ultimoAporte = ultimoAporte ?? f.fecha }
      else if (f.tipo === 'retiro') { saldoLegacy -= f.monto; retirosL += f.monto }
    })

    // Modern movimientos (fondo_reserva_movimientos table) — más reciente
    const { data: movs } = await supabase
      .from('fondo_reserva_movimientos')
      .select('*')
      .eq('project_id', proyectoId)
      .order('fecha', { ascending: false })
      .limit(50)
    const movsList = (movs as FondoReservaMovimiento[]) ?? []
    setMovimientos(movsList)

    let saldoModern = 0
    let aportesM = 0, retirosM = 0
    movsList.forEach(m => {
      if (m.tipo === 'aportacion') { saldoModern += m.monto; aportesM += m.monto }
      else if (m.tipo === 'retiro') { saldoModern -= m.monto; retirosM += m.monto }
    })

    // Presupuestos
    const yearActual = new Date().getFullYear()
    const { data: pres } = await supabase
      .from('presupuestos_condominio')
      .select('*')
      .eq('project_id', proyectoId)
      .eq('anio', yearActual)
      .order('categoria')
    const presList = (pres as PresupuestoCondominio[]) ?? []
    setPresupuestos(presList)

    const presupuestoAnual = presList.reduce((s, p) => s + (p.monto_presupuestado ?? 0), 0)
    // Ejecutado: sumar gastos del año por categoría (cuando exista la tabla)
    const { data: gastos } = await supabase
      .from('gastos_condominio')
      .select('monto')
      .eq('project_id', proyectoId)
      .gte('fecha', `${yearActual}-01-01`)
      .lte('fecha', `${yearActual}-12-31`)
    const ejecutado = (gastos as { monto: number }[] ?? []).reduce((s, g) => s + (g.monto ?? 0), 0)

    setKpis({
      saldoFondo: saldoLegacy + saldoModern,
      totalAportes: aportesL + aportesM,
      totalRetiros: retirosL + retirosM,
      ultimoAporte,
      presupuestoAnual,
      ejecutado,
    })

    setLoading(false)
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando finanzas…</div>
  }

  const pctEjecutado = kpis.presupuestoAnual > 0
    ? Math.min(100, Math.round((kpis.ejecutado / kpis.presupuestoAnual) * 100))
    : 0

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
          📊 Transparencia financiera
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Vista pública de las finanzas del condominio. Auditable por cualquier residente.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatTile
          label="💰 Saldo fondo reserva"
          value={`${moneda} ${kpis.saldoFondo.toLocaleString('es', { minimumFractionDigits: 2 })}`}
          tone={kpis.saldoFondo >= 0 ? 'success' : 'danger'}
        />
        <StatTile
          label="📈 Aportes acumulados"
          value={`${moneda} ${kpis.totalAportes.toLocaleString('es', { minimumFractionDigits: 2 })}`}
          tone="info"
          hint={kpis.ultimoAporte ? `Último: ${kpis.ultimoAporte}` : undefined}
        />
        <StatTile
          label="📉 Retiros ejecutados"
          value={`${moneda} ${kpis.totalRetiros.toLocaleString('es', { minimumFractionDigits: 2 })}`}
          tone="warning"
        />
        <StatTile
          label={`🎯 Ejecución ${new Date().getFullYear()}`}
          value={`${pctEjecutado}%`}
          hint={`${moneda} ${kpis.ejecutado.toLocaleString('es', { minimumFractionDigits: 2 })} / ${moneda} ${kpis.presupuestoAnual.toLocaleString('es', { minimumFractionDigits: 2 })}`}
          tone={pctEjecutado > 100 ? 'danger' : pctEjecutado > 80 ? 'warning' : 'success'}
        />
      </div>

      {/* Presupuesto por categoría */}
      <section style={{ marginBottom: '28px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
          💼 Presupuesto {new Date().getFullYear()} por categoría
        </h3>
        {presupuestos.length === 0 ? (
          <EmptyState
            icon="💼"
            title="Sin presupuesto registrado"
            description={`La administración aún no ha registrado el presupuesto del año ${new Date().getFullYear()}.`}
          />
        ) : (
          <DataTable<PresupuestoCondominio>
            data={presupuestos}
            rowKey="id"
            pageSize={20}
            emptyState={{ title: 'Sin partidas' }}
            columns={[
              { key: 'categoria', header: 'Categoría', sortable: true, render: (p) => <span style={{ fontWeight: 600 }}>{p.categoria}</span> },
              { key: 'monto_presupuestado', header: 'Presupuestado', align: 'right', sortable: true,
                render: (p) => <span style={{ fontWeight: 600 }}>{moneda} {(p.monto_presupuestado ?? 0).toFixed(2)}</span> },
              { key: 'notas', header: 'Notas', hideOnMobile: true, render: (p) => p.notas ?? '—' },
            ] satisfies DataTableColumn<PresupuestoCondominio>[]}
          />
        )}
      </section>

      {/* Movimientos del fondo */}
      <section>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
          🏦 Movimientos recientes del fondo de reserva
        </h3>
        {movimientos.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="Sin movimientos registrados"
            description="No hay aportes ni retiros del fondo de reserva en el historial."
          />
        ) : (
          <DataTable<FondoReservaMovimiento>
            data={movimientos}
            rowKey="id"
            pageSize={20}
            defaultSort={{ key: 'fecha', direction: 'desc' }}
            emptyState={{ title: 'Sin movimientos' }}
            columns={[
              { key: 'fecha', header: 'Fecha', sortable: true },
              { key: 'tipo', header: 'Tipo', sortable: true,
                render: (m) => (
                  <StatusBadge tone={m.tipo === 'aportacion' ? 'success' : 'warning'}>
                    {m.tipo === 'aportacion' ? '📈 Aporte' : '📉 Retiro'}
                  </StatusBadge>
                ),
              },
              { key: 'concepto', header: 'Concepto', sortable: true },
              { key: 'monto', header: 'Monto', align: 'right', sortable: true,
                render: (m) => <span style={{ fontWeight: 700, color: m.tipo === 'aportacion' ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
                  {m.tipo === 'aportacion' ? '+' : '−'} {moneda} {m.monto.toFixed(2)}
                </span>,
              },
              { key: 'referencia', header: 'Ref.', hideOnMobile: true, render: (m) => m.referencia ?? '—' },
            ] satisfies DataTableColumn<FondoReservaMovimiento>[]}
          />
        )}
      </section>

      <p style={{ marginTop: '24px', fontSize: '12px', color: 'var(--at-ink-3)', textAlign: 'center' }}>
        Los datos se actualizan en tiempo real conforme la administración registra movimientos.
      </p>
    </div>
  )
}
