import type {
  CuotaCondominio, TicketMantenimiento, Visitante, GastoCondominio,
  PresupuestoCondominio, SancionCondominio, PlanMantenimiento,
  InfraccionCondominio, Unidad,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  sanciones: SancionCondominio[]
  planesMantenimiento: PlanMantenimiento[]
  infracciones: InfraccionCondominio[]
  unidades: Unidad[]
  moneda: string
  proyectoNombre?: string
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px 16px' }}>
      <div style={{ fontSize: '22px', fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink)', marginTop: '2px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0
  return (
    <div style={{ height: '8px', background: 'var(--at-chip)', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '4px', transition: 'width 0.4s' }} />
    </div>
  )
}

function MiniBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round(value / total * 100) : 0
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
        <span style={{ color: 'var(--at-ink-2)', fontWeight: 500 }}>{label}</span>
        <span style={{ color: 'var(--at-ink-3)' }}>{value} · {pct}%</span>
      </div>
      <ProgressBar value={value} max={total} color={color} />
    </div>
  )
}

export function DashboardEjecutivoTab({ cuotas, tickets, visitantes, gastos, presupuestos, sanciones, planesMantenimiento, infracciones, unidades, moneda, proyectoNombre }: Props) {
  const today = new Date()
  const periodoActual = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  // ── Financiero ────────────────────────────────────────────────────────────
  const cuotasMes    = cuotas.filter(c => c.periodo === periodoActual)
  const totalEmitido = cuotasMes.reduce((s, c) => s + c.monto, 0)
  const totalCobrado = cuotasMes.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const tasaCobranza = totalEmitido > 0 ? Math.round(totalCobrado / totalEmitido * 100) : 0
  const morosos      = new Set(cuotasMes.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size

  const gastosAnio   = gastos.filter(g => g.fecha.startsWith(String(today.getFullYear())))
  const totalGastos  = gastosAnio.reduce((s, g) => s + g.monto, 0)
  const presupuestoActual = presupuestos.find(p => p.anio === today.getFullYear())
  const presupuestoTotal  = presupuestoActual?.monto_presupuestado ?? 0
  const ejecucionPpto     = presupuestoTotal > 0 ? Math.round(totalGastos / presupuestoTotal * 100) : 0

  // Monthly trend (last 6 months)
  const trend: { label: string; cobrado: number; emitido: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const cs = cuotas.filter(c => c.periodo === p)
    trend.push({
      label: d.toLocaleString('es', { month: 'short' }),
      emitido: cs.reduce((s, c) => s + c.monto, 0),
      cobrado: cs.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
    })
  }
  const maxTrend = Math.max(...trend.map(t => t.emitido), 1)

  // ── Mantenimiento ─────────────────────────────────────────────────────────
  const ticketsAbiertos = tickets.filter(t => t.estado === 'abierto').length
  const ticketsTotal    = tickets.length
  const ticketsPorPrio  = [
    { label: 'Urgente', count: tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado').length, color: '#ef4444' },
    { label: 'Alta',    count: tickets.filter(t => t.prioridad === 'alta'    && t.estado !== 'cerrado').length, color: '#f59e0b' },
    { label: 'Media',   count: tickets.filter(t => t.prioridad === 'media'   && t.estado !== 'cerrado').length, color: 'var(--at-primary)' },
    { label: 'Baja',    count: tickets.filter(t => t.prioridad === 'baja'    && t.estado !== 'cerrado').length, color: 'var(--at-ink-3)' },
  ]
  const planesVencidos = planesMantenimiento.filter(p => p.activo && p.proxima_ejecucion && p.proxima_ejecucion < periodoActual + '-01').length

  // ── Seguridad / Convivencia ───────────────────────────────────────────────
  const visitantesEsteMes = visitantes.filter(v => v.hora_entrada?.startsWith(periodoActual.slice(0, 7))).length
  const infraccionesAbiertas = infracciones.filter(i => i.estado === 'emitida' || i.estado === 'notificada' || i.estado === 'en_descargo').length
  const sancionesPendientes  = sanciones.filter(s => s.estado === 'pendiente')
  const montoSanciones       = sancionesPendientes.reduce((s, x) => s + x.monto, 0)

  // ── Unidades ──────────────────────────────────────────────────────────────
  const totalUnidades = unidades.length
  const conDeuda = new Set(cuotas.filter(c => c.estado !== 'pagado').map(c => c.unidad_id)).size

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Dashboard Ejecutivo</h2>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{proyectoNombre ?? 'Proyecto'} · {periodoActual}</p>
      </div>

      {/* Financiero */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>💰 Financiero</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          <KpiCard label="Cobranza del mes" value={`${tasaCobranza}%`}
            sub={`${moneda} ${totalCobrado.toFixed(0)} / ${totalEmitido.toFixed(0)}`}
            color={tasaCobranza >= 80 ? '#10b981' : tasaCobranza >= 60 ? '#f59e0b' : '#ef4444'} />
          <KpiCard label="Morosos" value={String(morosos)} sub="unidades" color={morosos > 0 ? '#ef4444' : '#10b981'} />
          <KpiCard label="Gastos del año" value={`${moneda} ${(totalGastos / 1000).toFixed(1)}k`}
            sub={presupuestoTotal > 0 ? `${ejecucionPpto}% del ppto.` : 'Sin presupuesto'} color='#B96A3F' />
          <KpiCard label="Sanciones pend." value={`${moneda} ${montoSanciones.toFixed(0)}`}
            sub={`${sancionesPendientes.length} sanciones`} color={montoSanciones > 0 ? '#f59e0b' : '#10b981'} />
        </div>

        {/* Trend chart */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '12px' }}>Tendencia de cuotas (últimos 6 meses)</div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end', height: '80px' }}>
            {trend.map(t => {
              const hEmitido = maxTrend > 0 ? Math.round(t.emitido / maxTrend * 72) : 0
              const hCobrado = maxTrend > 0 ? Math.round(t.cobrado / maxTrend * 72) : 0
              return (
                <div key={t.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: '72px' }}>
                    <div title={`Emitido: ${moneda} ${t.emitido.toFixed(0)}`}
                      style={{ width: '14px', height: `${hEmitido}px`, background: 'var(--at-primary-soft)', borderRadius: '3px 3px 0 0', minHeight: '2px' }} />
                    <div title={`Cobrado: ${moneda} ${t.cobrado.toFixed(0)}`}
                      style={{ width: '14px', height: `${hCobrado}px`, background: 'var(--at-primary)', borderRadius: '3px 3px 0 0', minHeight: '2px' }} />
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{t.label}</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '11px', color: 'var(--at-ink-3)' }}>
              <div style={{ width: '10px', height: '10px', background: 'var(--at-primary-soft)', borderRadius: '2px' }} /> Emitido
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', fontSize: '11px', color: 'var(--at-ink-3)' }}>
              <div style={{ width: '10px', height: '10px', background: 'var(--at-primary)', borderRadius: '2px' }} /> Cobrado
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {/* Mantenimiento */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '12px' }}>🔧 Mantenimiento</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: ticketsAbiertos > 0 ? '#f59e0b' : '#10b981' }}>{ticketsAbiertos}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>tickets abiertos</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: planesVencidos > 0 ? '#ef4444' : '#10b981' }}>{planesVencidos}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>planes vencidos</div>
            </div>
          </div>
          {ticketsTotal > 0 && (
            <>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px' }}>Tickets abiertos por prioridad</div>
              {ticketsPorPrio.filter(p => p.count > 0).map(p => (
                <MiniBar key={p.label} label={p.label} value={p.count} total={ticketsAbiertos || 1} color={p.color} />
              ))}
            </>
          )}
        </div>

        {/* Convivencia */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '12px' }}>👥 Convivencia</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
            <div style={{ textAlign: 'center', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--at-primary)' }}>{visitantesEsteMes}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>visitas este mes</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px' }}>
              <div style={{ fontSize: '20px', fontWeight: 800, color: infraccionesAbiertas > 0 ? '#f59e0b' : '#10b981' }}>{infraccionesAbiertas}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>infracciones abiertas</div>
            </div>
          </div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px' }}>Unidades ({totalUnidades} total)</div>
          <MiniBar label="Con deuda" value={conDeuda} total={totalUnidades} color="#ef4444" />
          <MiniBar label="Al día" value={totalUnidades - conDeuda} total={totalUnidades} color="#10b981" />
        </div>

        {/* Resumen ejecutivo */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '12px' }}>📋 Resumen ejecutivo</div>
          {[
            { label: `Cobranza ${periodoActual}`, pct: tasaCobranza, color: tasaCobranza >= 80 ? '#10b981' : '#f59e0b' },
            { label: 'Ejecución presupuesto', pct: ejecucionPpto, color: ejecucionPpto <= 90 ? 'var(--at-primary)' : '#ef4444' },
            { label: 'Tickets resueltos', pct: ticketsTotal > 0 ? Math.round((ticketsTotal - ticketsAbiertos) / ticketsTotal * 100) : 100, color: 'var(--at-accent)' },
          ].map(r => (
            <div key={r.label} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: 'var(--at-ink-2)' }}>{r.label}</span>
                <span style={{ fontWeight: 700, color: r.color }}>{r.pct}%</span>
              </div>
              <ProgressBar value={r.pct} max={100} color={r.color} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
