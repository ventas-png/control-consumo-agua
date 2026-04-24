import { useMemo } from 'react'
import {
  Visitante, TicketMantenimiento, TareaCondominio,
  ReservaAmenidad, PolizaSeguro, ContratoProveedor,
  InspeccionNormativa, VencimientoExtra, CuotaCondominio,
} from '../../../types'

interface Props {
  visitantes: Visitante[]
  tickets: TicketMantenimiento[]
  tareasCond: TareaCondominio[]
  reservas: ReservaAmenidad[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  vencimientosExtra: VencimientoExtra[]
  cuotas: CuotaCondominio[]
}

function semaforo(val: number, verde: number, amarillo: number): string {
  return val <= verde ? '#16a34a' : val <= amarillo ? '#d97706' : '#ef4444'
}

export default function PanelTurnoTab({ visitantes, tickets, tareasCond, reservas, polizas, contratosProveedores, inspecciones, vencimientosExtra, cuotas }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const en7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  const activos = visitantes.filter(v => !v.hora_salida)
  const ticketsUrgentes = tickets.filter(t => (t.prioridad === 'urgente' || t.prioridad === 'alta') && (t.estado === 'abierto' || t.estado === 'en_proceso'))
  const tareasHoy = tareasCond.filter(t => t.fecha_limite === hoy && t.estado !== 'completada' && t.estado !== 'cancelada')
  const reservasHoy = reservas.filter(r => r.fecha === hoy)
  const morosas = cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy)

  const vencProximos = useMemo(() => [
    ...polizas.filter(p => p.fecha_vencimiento && p.fecha_vencimiento >= hoy && p.fecha_vencimiento <= en7).map(p => ({ titulo: `Póliza: ${p.tipo}`, fecha: p.fecha_vencimiento, icon: '🛡️' })),
    ...contratosProveedores.filter(c => c.fecha_fin && c.fecha_fin >= hoy && c.fecha_fin <= en7).map(c => ({ titulo: `Contrato: ${c.proveedor_nombre}`, fecha: c.fecha_fin!, icon: '🤝' })),
    ...inspecciones.filter(i => i.fecha_proxima && i.fecha_proxima >= hoy && i.fecha_proxima <= en7).map(i => ({ titulo: `Inspección: ${i.tipo}`, fecha: i.fecha_proxima!, icon: '🏛️' })),
    ...vencimientosExtra.filter(v => !v.renovado && v.fecha_vencimiento >= hoy && v.fecha_vencimiento <= en7).map(v => ({ titulo: v.titulo, fecha: v.fecha_vencimiento, icon: '⏳' })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha)), [polizas, contratosProveedores, inspecciones, vencimientosExtra, hoy, en7])

  function Bloque({ titulo, icon, count, color, children }: { titulo: string; icon: string; count: number; color: string; children: React.ReactNode }) {
    return (
      <div style={{ background: '#fff', border: `1px solid ${color}33`, borderRadius: 12, padding: 14, borderLeft: `4px solid ${color}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{icon} {titulo}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color }}>{count}</div>
        </div>
        {children}
      </div>
    )
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Panel de turno — vista operativa en tiempo real</div>
        <div style={{ fontSize: 12, color: '#9ca3af' }}>📅 {hoy} · 🕐 {hora}</div>
      </div>

      {/* KPIs rápidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Dentro ahora', val: activos.length, color: semaforo(activos.length, 10, 30) },
          { label: 'Tickets urgentes', val: ticketsUrgentes.length, color: semaforo(ticketsUrgentes.length, 0, 2) },
          { label: 'Tareas de hoy', val: tareasHoy.length, color: semaforo(tareasHoy.length, 2, 5) },
          { label: 'Reservas hoy', val: reservasHoy.length, color: '#2563eb' },
          { label: 'Cuotas morosas', val: morosas.length, color: semaforo(morosas.length, 0, 5) },
        ].map(k => (
          <div key={k.label} style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 12px', textAlign: 'center', border: `1px solid ${k.color}22` }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Visitantes activos */}
        <Bloque titulo="Visitantes dentro" icon="🚪" count={activos.length} color={semaforo(activos.length, 10, 30)}>
          {activos.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Ningún visitante registrado actualmente</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {activos.slice(0, 8).map(v => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: '#f0fdf4', borderRadius: 6 }}>
                  <span style={{ fontWeight: 600 }}>{v.nombre}</span>
                  <span style={{ color: '#9ca3af' }}>{v.unidad_nombre} · {v.hora_entrada?.slice(11, 16)}</span>
                </div>
              ))}
              {activos.length > 8 && <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>+{activos.length - 8} más</div>}
            </div>
          )}
        </Bloque>

        {/* Tickets urgentes */}
        <Bloque titulo="Tickets urgentes / alta prioridad" icon="🔧" count={ticketsUrgentes.length} color={semaforo(ticketsUrgentes.length, 0, 2)}>
          {ticketsUrgentes.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Sin tickets pendientes de alta prioridad ✓</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {ticketsUrgentes.slice(0, 6).map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: '#fef2f2', borderRadius: 6 }}>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.titulo}</span>
                  <span style={{ color: t.prioridad === 'urgente' ? '#ef4444' : '#f97316', fontWeight: 700, marginLeft: 6, flexShrink: 0 }}>{t.prioridad}</span>
                </div>
              ))}
            </div>
          )}
        </Bloque>

        {/* Tareas de hoy */}
        <Bloque titulo="Tareas para hoy" icon="✅" count={tareasHoy.length} color={semaforo(tareasHoy.length, 2, 5)}>
          {tareasHoy.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>No hay tareas con vencimiento hoy</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {tareasHoy.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: '#fef3c7', borderRadius: 6 }}>
                  <span style={{ flex: 1 }}>{t.titulo}</span>
                  <span style={{ color: '#d97706', fontWeight: 700, flexShrink: 0, marginLeft: 6 }}>{t.estado}</span>
                </div>
              ))}
            </div>
          )}
        </Bloque>

        {/* Reservas hoy */}
        <Bloque titulo="Reservas de amenidades hoy" icon="🏊" count={reservasHoy.length} color="#2563eb">
          {reservasHoy.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Sin reservas para hoy</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
              {reservasHoy.map(r => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 8px', background: '#eff6ff', borderRadius: 6 }}>
                  <span style={{ fontWeight: 600 }}>{r.amenidad_nombre ?? '—'}</span>
                  <span style={{ color: '#2563eb' }}>{r.hora_inicio} – {r.hora_fin} · {r.unidad_nombre}</span>
                </div>
              ))}
            </div>
          )}
        </Bloque>
      </div>

      {/* Vencimientos próximos 7 días */}
      {vencProximos.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 14, marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#d97706' }}>⏳ Vencimientos en los próximos 7 días ({vencProximos.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {vencProximos.map((v, i) => (
              <div key={i} style={{ padding: '4px 10px', background: '#fff', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11 }}>
                <span style={{ marginRight: 4 }}>{v.icon}</span>
                <strong>{v.titulo}</strong>
                <span style={{ color: '#9ca3af', marginLeft: 6 }}>{v.fecha}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
