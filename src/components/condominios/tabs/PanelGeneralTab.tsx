import type {
  CuotaCondominio, TicketMantenimiento, Visitante, Amenidad,
  ReservaAmenidad, PolizaSeguro, InspeccionNormativa, GastoCondominio,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  amenidades: Amenidad[]
  reservas: ReservaAmenidad[]
  polizas: PolizaSeguro[]
  inspecciones: InspeccionNormativa[]
  gastos: GastoCondominio[]
  moneda: string
  proyectoNombre?: string
}

interface Alerta {
  nivel: 'error' | 'warning' | 'info'
  icon: string
  titulo: string
  desc: string
}

function diasHasta(fecha: string): number {
  return Math.floor((new Date(fecha).getTime() - Date.now()) / 86400000)
}

function mesLabel(periodo: string): string {
  const [, m] = periodo.split('-')
  return ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][parseInt(m) - 1]
}

export function PanelGeneralTab({ cuotas, tickets, visitantes, amenidades, reservas, polizas, inspecciones, gastos, moneda, proyectoNombre }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)

  // ── KPI base ─────────────────────────────────────────────────────────────────
  const cuotasPendientes  = cuotas.filter(c => c.estado === 'pendiente')
  const cuotasMorosas     = cuotas.filter(c => c.estado === 'moroso')
  const montoPendiente    = cuotasPendientes.reduce((s, c) => s + c.monto, 0)
  const ticketsAbiertos   = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso')
  const ticketsUrgentes   = tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado')
  const visitantesHoy     = visitantes.filter(v => v.hora_entrada.startsWith(hoy))
  const amenidadesActivas = amenidades.filter(a => a.activo)
  const reservasHoy       = reservas.filter(r => r.fecha === hoy && r.estado !== 'cancelada')

  // ── Alertas inteligentes ──────────────────────────────────────────────────────
  const alertas: Alerta[] = []

  // Pólizas vencidas
  polizas.filter(p => p.fecha_vencimiento < hoy && p.estado !== 'cancelada').forEach(p => {
    alertas.push({ nivel: 'error', icon: '📋', titulo: 'Póliza vencida', desc: `${p.tipo} — ${p.aseguradora} (venció ${p.fecha_vencimiento})` })
  })

  // Pólizas que vencen en ≤30 días
  polizas.filter(p => {
    const d = diasHasta(p.fecha_vencimiento)
    return d >= 0 && d <= 30 && p.estado !== 'cancelada'
  }).forEach(p => {
    const d = diasHasta(p.fecha_vencimiento)
    alertas.push({ nivel: 'warning', icon: '📋', titulo: 'Póliza próxima a vencer', desc: `${p.tipo} — ${p.aseguradora} · ${d} día${d !== 1 ? 's' : ''}` })
  })

  // Inspecciones próximas ≤30 días
  inspecciones.filter(i => i.fecha_proxima && diasHasta(i.fecha_proxima) >= 0 && diasHasta(i.fecha_proxima) <= 30).forEach(i => {
    const d = diasHasta(i.fecha_proxima!)
    alertas.push({ nivel: 'warning', icon: '🔍', titulo: 'Inspección próxima', desc: `${i.tipo}${i.entidad_inspectora ? ` — ${i.entidad_inspectora}` : ''} · ${d} día${d !== 1 ? 's' : ''}` })
  })

  // Tickets urgentes
  if (ticketsUrgentes.length > 0) {
    alertas.push({ nivel: 'error', icon: '🚨', titulo: `${ticketsUrgentes.length} ticket${ticketsUrgentes.length > 1 ? 's' : ''} urgente${ticketsUrgentes.length > 1 ? 's' : ''} sin cerrar`, desc: ticketsUrgentes.slice(0, 2).map(t => t.titulo).join(' · ') + (ticketsUrgentes.length > 2 ? ` +${ticketsUrgentes.length - 2} más` : '') })
  }

  // Cuotas que vencen hoy
  const vencenHoy = cuotas.filter(c => c.fecha_vencimiento === hoy && c.estado === 'pendiente')
  if (vencenHoy.length > 0) {
    alertas.push({ nivel: 'info', icon: '💳', titulo: `${vencenHoy.length} cuota${vencenHoy.length > 1 ? 's' : ''} vence${vencenHoy.length === 1 ? '' : 'n'} hoy`, desc: `Total: ${moneda} ${vencenHoy.reduce((s, c) => s + c.monto, 0).toFixed(2)}` })
  }

  // Reservas de hoy
  if (reservasHoy.length > 0) {
    alertas.push({ nivel: 'info', icon: '🏊', titulo: `${reservasHoy.length} reserva${reservasHoy.length > 1 ? 's' : ''} de amenidades hoy`, desc: reservasHoy.slice(0, 2).map(r => `${r.hora_inicio}–${r.hora_fin}`).join(', ') })
  }

  const nivelColor: Record<Alerta['nivel'], { bg: string; border: string; color: string; dot: string }> = {
    error:   { bg: 'var(--at-danger-tint)', border: 'var(--at-danger-border)', color: 'var(--at-danger)', dot: 'var(--at-danger)' },
    warning: { bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', dot: 'var(--at-warning)' },
    info:    { bg: 'var(--at-primary-tint)', border: 'var(--at-primary-soft-2)', color: 'var(--at-ink-deep)', dot: 'var(--at-primary-2)' },
  }

  // ── Mini gráfica de recaudación — últimos 6 meses ─────────────────────────────
  const meses: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const datosMeses = meses.map(m => {
    const cuotasMes = cuotas.filter(c => c.periodo === m)
    const gastosMes = gastos.filter(g => g.fecha.startsWith(m) && g.estado === 'pagado')
    return {
      mes: mesLabel(m),
      emitido: cuotasMes.reduce((s, c) => s + c.monto, 0),
      cobrado: cuotasMes.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
      gastado: gastosMes.reduce((s, g) => s + g.monto, 0),
    }
  })

  const maxVal = Math.max(...datosMeses.flatMap(d => [d.emitido, d.cobrado, d.gastado]), 1)
  const chartH = 80
  const barW = 18
  const gap = 8
  const groupW = barW * 3 + gap * 2
  const chartW = meses.length * (groupW + 16) + 20

  // ── Ejecución presupuestal (mes actual) ──────────────────────────────────────
  const mesActual = hoy.slice(0, 7)
  const gastadoMes = gastos.filter(g => g.fecha.startsWith(mesActual) && g.estado === 'pagado').reduce((s, g) => s + g.monto, 0)
  const recaudadoMes = cuotas.filter(c => c.periodo === mesActual && c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const saldoMes = recaudadoMes - gastadoMes

  const kpis = [
    { label: 'Cuotas pendientes', value: cuotasPendientes.length, sub: `${moneda} ${montoPendiente.toFixed(2)}`, color: 'var(--at-primary)', bg: 'rgba(27, 59, 54,0.1)', icon: '💳' },
    { label: 'Cuotas en mora',    value: cuotasMorosas.length,   sub: 'unidades morosas',                   color: 'var(--at-danger)', bg: 'rgba(239,68,68,0.1)',    icon: '⚠️' },
    { label: 'Tickets abiertos',  value: ticketsAbiertos.length, sub: `${ticketsUrgentes.length} urgentes`, color: 'var(--at-warning)', bg: 'rgba(245,158,11,0.1)',    icon: '🔧' },
    { label: 'Visitas hoy',       value: visitantesHoy.length,   sub: 'registradas',                        color: 'var(--at-success)', bg: 'rgba(16,185,129,0.1)',    icon: '🚪' },
    { label: 'Amenidades',        value: amenidadesActivas.length, sub: 'disponibles',                      color: 'var(--at-accent)', bg: 'rgba(185, 106, 63,0.1)',    icon: '🏊' },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>
          Panel General{proyectoNombre ? ` — ${proyectoNombre}` : ''}
        </h2>
        <p style={{ margin: 0, color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
          {new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
          {alertas.map((a, i) => {
            const s = nivelColor[a.nivel]
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10 }}>
                <span style={{ fontSize: 16 }}>{a.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{a.titulo}</span>
                  {a.desc && <span style={{ fontSize: 11, color: s.color, opacity: 0.8, marginLeft: 8 }}>{a.desc}</span>}
                </div>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
              </div>
            )
          })}
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        {kpis.map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <div style={{ width: 34, height: 34, borderRadius: '10px', background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', marginBottom: '10px' }}>
              {k.icon}
            </div>
            <div style={{ fontSize: '26px', fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', margin: '4px 0 2px' }}>{k.label}</div>
            <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Gráfica de recaudación */}
      <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>📊 Recaudación — últimos 6 meses</h3>
          <div style={{ display: 'flex', gap: 14, fontSize: '11px', color: 'var(--at-ink-3)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--at-primary-soft-2)', marginRight: 4 }} />Emitido</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#34d399', marginRight: 4 }} />Cobrado</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--at-danger-border)', marginRight: 4 }} />Gastos</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <svg width={chartW} height={chartH + 28} style={{ display: 'block' }}>
            {datosMeses.map((d, i) => {
              const x = 10 + i * (groupW + 16)
              const hE = d.emitido > 0 ? Math.max(4, (d.emitido / maxVal) * chartH) : 0
              const hC = d.cobrado > 0 ? Math.max(4, (d.cobrado / maxVal) * chartH) : 0
              const hG = d.gastado > 0 ? Math.max(4, (d.gastado / maxVal) * chartH) : 0
              return (
                <g key={d.mes}>
                  {/* Emitido */}
                  <rect x={x} y={chartH - hE} width={barW} height={hE} rx={3} fill="#C2D2CA" />
                  {/* Cobrado */}
                  <rect x={x + barW + gap} y={chartH - hC} width={barW} height={hC} rx={3} fill="#34d399" />
                  {/* Gastos */}
                  <rect x={x + (barW + gap) * 2} y={chartH - hG} width={barW} height={hG} rx={3} fill="var(--at-danger-border)" />
                  {/* Mes label */}
                  <text x={x + groupW / 2} y={chartH + 16} textAnchor="middle" fontSize={11} fill="var(--at-ink-3)">{d.mes}</text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Saldo del mes */}
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          {[
            { label: 'Cobrado este mes', val: recaudadoMes, color: 'var(--at-success)' },
            { label: 'Gastado este mes',  val: gastadoMes,   color: 'var(--at-danger)' },
            { label: 'Saldo neto',        val: saldoMes,     color: saldoMes >= 0 ? 'var(--at-success)' : 'var(--at-danger)' },
          ].map(k => (
            <div key={k.label} style={{ flex: 1, minWidth: 120, background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 14px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: k.color }}>{saldoMes !== 0 && k.label === 'Saldo neto' && saldoMes > 0 ? '+' : ''}{moneda} {k.val.toFixed(2)}</div>
              <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{k.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Tickets abiertos */}
        {ticketsAbiertos.length > 0 && (
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px', padding: '18px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>🔧 Tickets abiertos</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {ticketsAbiertos.slice(0, 5).map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--at-surface-2)', borderRadius: '9px' }}>
                  <span style={{ padding: '2px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
                    background: t.prioridad === 'urgente' ? 'var(--at-danger-tint)' : t.prioridad === 'alta' ? 'var(--at-warning-tint)' : 'var(--at-success-tint)',
                    color: t.prioridad === 'urgente' ? 'var(--at-danger)' : t.prioridad === 'alta' ? 'var(--at-warning)' : 'var(--at-success)' }}>
                    {t.prioridad}
                  </span>
                  <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--at-ink-2)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titulo}</span>
                  <span style={{ padding: '2px 7px', borderRadius: '20px', fontSize: '10px',
                    background: t.estado === 'en_proceso' ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
                    color: t.estado === 'en_proceso' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
                    {t.estado.replace('_', ' ')}
                  </span>
                </div>
              ))}
              {ticketsAbiertos.length > 5 && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', textAlign: 'center', paddingTop: 4 }}>+{ticketsAbiertos.length - 5} más</div>
              )}
            </div>
          </div>
        )}

        {/* Visitas de hoy */}
        {visitantesHoy.length > 0 && (
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px', padding: '18px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>🚪 Visitas de hoy</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {visitantesHoy.slice(0, 5).map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--at-surface-2)', borderRadius: '9px' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '12px', flexShrink: 0 }}>
                    {v.nombre.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nombre}</div>
                    {v.unidad_nombre && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{v.unidad_nombre}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{new Date(v.hora_entrada).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</div>
                    {!v.hora_salida && <div style={{ fontSize: '10px', color: 'var(--at-success)', fontWeight: 600 }}>Activo</div>}
                  </div>
                </div>
              ))}
              {visitantesHoy.length > 5 && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', textAlign: 'center', paddingTop: 4 }}>+{visitantesHoy.length - 5} más</div>
              )}
            </div>
          </div>
        )}

        {/* Reservas de hoy */}
        {reservasHoy.length > 0 && (
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '14px', padding: '18px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>🏊 Reservas de hoy</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {reservasHoy.map(r => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--at-surface-2)', borderRadius: '9px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{r.unidad_nombre ?? '—'}</div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{r.hora_inicio} – {r.hora_fin}</div>
                  </div>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: '10px', fontWeight: 700,
                    background: r.estado === 'confirmada' ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
                    color: r.estado === 'confirmada' ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
                    {r.estado}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {cuotas.length === 0 && tickets.length === 0 && visitantes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
          <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--at-ink-3)' }}>El módulo Condominios está listo</p>
          <p style={{ fontSize: '13px' }}>Comienza registrando cuotas, visitantes o tickets de mantenimiento</p>
        </div>
      )}
    </div>
  )
}
