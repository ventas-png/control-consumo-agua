import type { CuotaCondominio, TicketMantenimiento, Visitante, Amenidad } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  amenidades: Amenidad[]
  moneda: string
}

export function PanelGeneralTab({ cuotas, tickets, visitantes, amenidades, moneda }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)

  const cuotasPendientes = cuotas.filter(c => c.estado === 'pendiente')
  const cuotasMorosas = cuotas.filter(c => c.estado === 'moroso')
  const montoPendiente = cuotasPendientes.reduce((s, c) => s + c.monto, 0)
  const ticketsAbiertos = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso')
  const ticketsUrgentes = tickets.filter(t => t.prioridad === 'urgente' && t.estado !== 'cerrado')
  const visitantesHoy = visitantes.filter(v => v.hora_entrada.startsWith(hoy))
  const amenidadesActivas = amenidades.filter(a => a.activo)

  const kpis = [
    { label: 'Cuotas pendientes', value: cuotasPendientes.length, sub: `${moneda} ${montoPendiente.toFixed(2)}`, color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', icon: '💳' },
    { label: 'Cuotas en mora', value: cuotasMorosas.length, sub: 'unidades morosas', color: '#ef4444', bg: 'rgba(239,68,68,0.1)', icon: '⚠️' },
    { label: 'Tickets abiertos', value: ticketsAbiertos.length, sub: `${ticketsUrgentes.length} urgentes`, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '🔧' },
    { label: 'Visitas hoy', value: visitantesHoy.length, sub: 'registradas', color: '#10b981', bg: 'rgba(16,185,129,0.1)', icon: '🚪' },
    { label: 'Amenidades', value: amenidadesActivas.length, sub: 'disponibles', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: '🏊' },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
        Panel General — Condominios
      </h2>
      <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: '14px' }}>
        Resumen de actividad del condominio
      </p>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {kpis.map(k => (
          <div key={k.label} style={{
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '16px',
            padding: '20px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: 36, height: 36, borderRadius: '10px', background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                {k.icon}
              </div>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', margin: '4px 0 2px' }}>{k.label}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent tickets */}
      {ticketsAbiertos.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
            🔧 Tickets abiertos recientes
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {ticketsAbiertos.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: '#f8fafc', borderRadius: '10px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                  background: t.prioridad === 'urgente' ? '#fef2f2' : t.prioridad === 'alta' ? '#fff7ed' : '#f0fdf4',
                  color: t.prioridad === 'urgente' ? '#dc2626' : t.prioridad === 'alta' ? '#ea580c' : '#16a34a',
                }}>
                  {t.prioridad}
                </span>
                <span style={{ flex: 1, fontSize: '13.5px', color: '#374151', fontWeight: 500 }}>{t.titulo}</span>
                {t.unidad_nombre && <span style={{ fontSize: '12px', color: '#94a3b8' }}>{t.unidad_nombre}</span>}
                <span style={{
                  padding: '2px 8px', borderRadius: '20px', fontSize: '11px',
                  background: t.estado === 'en_proceso' ? '#eff6ff' : '#f8fafc',
                  color: t.estado === 'en_proceso' ? '#2563eb' : '#64748b',
                }}>
                  {t.estado.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent visitors */}
      {visitantesHoy.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
            🚪 Visitas de hoy
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {visitantesHoy.slice(0, 5).map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', background: '#f8fafc', borderRadius: '10px' }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '13px', flexShrink: 0 }}>
                  {v.nombre.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#374151' }}>{v.nombre}</div>
                  {v.motivo && <div style={{ fontSize: '12px', color: '#94a3b8' }}>{v.motivo}</div>}
                </div>
                {v.unidad_nombre && <span style={{ fontSize: '12px', color: '#64748b' }}>{v.unidad_nombre}</span>}
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  {new Date(v.hora_entrada).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {!v.hora_salida && (
                  <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>
                    Activo
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {cuotas.length === 0 && tickets.length === 0 && visitantes.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
          <p style={{ fontSize: '16px', fontWeight: 600, color: '#64748b' }}>El módulo Condominios está listo</p>
          <p style={{ fontSize: '13px' }}>Comienza registrando cuotas, visitantes o tickets de mantenimiento</p>
        </div>
      )}
    </div>
  )
}
