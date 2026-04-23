import { useMemo } from 'react'
import {
  CuotaCondominio, TicketMantenimiento, Visitante, GastoCondominio,
  PresupuestoCondominio, IncidenteSeguridad, SugerenciaCondominio,
  PolizaSeguro, ContratoProveedor, InspeccionNormativa, VencimientoExtra,
  Encuesta,
} from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  visitantes: Visitante[]
  gastos: GastoCondominio[]
  presupuestos: PresupuestoCondominio[]
  incidentes: IncidenteSeguridad[]
  sugerencias: SugerenciaCondominio[]
  polizas: PolizaSeguro[]
  contratosProveedores: ContratoProveedor[]
  inspecciones: InspeccionNormativa[]
  vencimientosExtra: VencimientoExtra[]
  encuestas: Encuesta[]
  moneda: string
}

function semaforo(val: number, verde: number, amarillo: number) {
  return val <= verde ? '#16a34a' : val <= amarillo ? '#d97706' : '#ef4444'
}

function semaforoInv(val: number, verde: number, amarillo: number) {
  return val >= verde ? '#16a34a' : val >= amarillo ? '#d97706' : '#ef4444'
}

interface KpiCard { label: string; val: string | number; color: string; sub?: string; icon: string }

function KpiBox({ k }: { k: KpiCard }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${k.color}33`, borderRadius: 10, padding: '12px 14px', borderTop: `3px solid ${k.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: k.color }}>{k.val}</div>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{k.label}</div>
          {k.sub && <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>{k.sub}</div>}
        </div>
        <div style={{ fontSize: 20 }}>{k.icon}</div>
      </div>
    </div>
  )
}

export default function CuadroMandoTab({ cuotas, tickets, visitantes, gastos, presupuestos, incidentes, sugerencias, polizas, contratosProveedores, inspecciones, vencimientosExtra, encuestas, moneda }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const en30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const mes = hoy.slice(0, 7)

  const kpisFinanciero: KpiCard[] = useMemo(() => {
    const totalCuotas = cuotas.length
    const pagadas = cuotas.filter(c => c.estado === 'pagado').length
    const morosas = cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).length
    const tasaCobro = totalCuotas > 0 ? Math.round((pagadas / totalCuotas) * 100) : 100
    const montoPendiente = cuotas.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
    const gastosMes = gastos.filter(g => g.fecha?.startsWith(mes)).reduce((s, g) => s + g.monto, 0)
    const presupuestoMes = presupuestos.filter(p => String(p.anio) === mes.slice(0, 4)).reduce((s, p) => s + p.monto_presupuestado, 0)
    const ejecucion = presupuestoMes > 0 ? Math.round((gastosMes / presupuestoMes) * 100) : 0

    return [
      { label: 'Tasa de cobro', val: `${tasaCobro}%`, color: semaforoInv(tasaCobro, 90, 70), sub: `${pagadas}/${totalCuotas} cuotas`, icon: '💳' },
      { label: 'Cuotas morosas', val: morosas, color: semaforo(morosas, 0, 5), sub: 'Vencidas hoy', icon: '⚠️' },
      { label: 'Cartera vencida', val: `${moneda} ${montoPendiente.toLocaleString('es', { maximumFractionDigits: 0 })}`, color: semaforo(montoPendiente, 0, 5000), sub: 'Saldo por cobrar', icon: '📊' },
      { label: 'Ejecución presup.', val: `${ejecucion}%`, color: ejecucion > 100 ? '#ef4444' : ejecucion > 80 ? '#d97706' : '#16a34a', sub: `${moneda} ${gastosMes.toLocaleString('es', { maximumFractionDigits: 0 })} gastado`, icon: '💸' },
    ]
  }, [cuotas, gastos, presupuestos, hoy, mes, moneda])

  const kpisOperacion: KpiCard[] = useMemo(() => {
    const abiertos = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length
    const urgentes = tickets.filter(t => (t.prioridad === 'urgente' || t.prioridad === 'alta') && (t.estado === 'abierto' || t.estado === 'en_proceso')).length
    const visitantesMes = visitantes.filter(v => v.hora_entrada?.startsWith(mes)).length
    const incidentesMes = incidentes.filter(i => i.fecha?.startsWith(mes)).length
    const sugerPend = sugerencias.filter(s => s.estado === 'pendiente' || s.estado === 'en_revision').length
    const encuestasActivas = encuestas.filter(e => e.estado === 'activa').length

    return [
      { label: 'Tickets abiertos', val: abiertos, color: semaforo(abiertos, 5, 15), sub: `${urgentes} urgentes/alta`, icon: '🔧' },
      { label: 'Visitantes del mes', val: visitantesMes, color: '#2563eb', sub: mes, icon: '🚪' },
      { label: 'Incidentes del mes', val: incidentesMes, color: semaforo(incidentesMes, 0, 3), sub: 'Seguridad', icon: '🚨' },
      { label: 'Sugerencias pend.', val: sugerPend, color: semaforo(sugerPend, 3, 8), sub: `${encuestasActivas} encuestas activas`, icon: '💡' },
    ]
  }, [tickets, visitantes, incidentes, sugerencias, encuestas, mes])

  const vencimientos30 = useMemo(() => [
    ...polizas.filter(p => p.fecha_vencimiento && p.fecha_vencimiento >= hoy && p.fecha_vencimiento <= en30).map(p => ({ titulo: `Póliza: ${p.tipo}`, fecha: p.fecha_vencimiento, tipo: 'Seguro', color: '#7c3aed' })),
    ...contratosProveedores.filter(c => c.fecha_fin && c.fecha_fin >= hoy && c.fecha_fin <= en30).map(c => ({ titulo: `Contrato: ${c.proveedor_nombre}`, fecha: c.fecha_fin!, tipo: 'Contrato', color: '#0369a1' })),
    ...inspecciones.filter(i => i.fecha_proxima && i.fecha_proxima >= hoy && i.fecha_proxima <= en30).map(i => ({ titulo: `Inspección: ${i.tipo}`, fecha: i.fecha_proxima!, tipo: 'Inspección', color: '#d97706' })),
    ...vencimientosExtra.filter(v => !v.renovado && v.fecha_vencimiento >= hoy && v.fecha_vencimiento <= en30).map(v => ({ titulo: v.titulo, fecha: v.fecha_vencimiento, tipo: 'Extra', color: '#64748b' })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha)), [polizas, contratosProveedores, inspecciones, vencimientosExtra, hoy, en30])

  const diasRestantes = (fecha: string) => Math.ceil((new Date(fecha).getTime() - Date.now()) / 86400000)

  const ticketsPorPrioridad = useMemo(() => {
    const abiertos = tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso')
    return {
      urgente: abiertos.filter(t => t.prioridad === 'urgente').length,
      alta:    abiertos.filter(t => t.prioridad === 'alta').length,
      media:   abiertos.filter(t => t.prioridad === 'media').length,
      baja:    abiertos.filter(t => t.prioridad === 'baja').length,
    }
  }, [tickets])

  return (
    <div style={{ padding: 16 }}>
      {/* Sección financiera */}
      <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Finanzas y cobro</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {kpisFinanciero.map(k => <KpiBox key={k.label} k={k} />)}
      </div>

      {/* Sección operativa */}
      <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Operaciones</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        {kpisOperacion.map(k => <KpiBox key={k.label} k={k} />)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {/* Tickets por prioridad */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>🔧 Tickets abiertos por prioridad</div>
          {[
            { label: 'Urgente', val: ticketsPorPrioridad.urgente, color: '#ef4444', bg: '#fef2f2' },
            { label: 'Alta',    val: ticketsPorPrioridad.alta,    color: '#f97316', bg: '#fff7ed' },
            { label: 'Media',   val: ticketsPorPrioridad.media,   color: '#d97706', bg: '#fef3c7' },
            { label: 'Baja',    val: ticketsPorPrioridad.baja,    color: '#16a34a', bg: '#dcfce7' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 52, fontSize: 11, color: r.color, fontWeight: 600 }}>{r.label}</div>
              <div style={{ flex: 1, height: 12, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: r.color, width: `${Math.min((r.val / (Object.values(ticketsPorPrioridad).reduce((a, b) => a + b, 0) || 1)) * 100, 100)}%`, borderRadius: 6, transition: 'width 0.3s' }} />
              </div>
              <div style={{ width: 22, textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.color }}>{r.val}</div>
            </div>
          ))}
          {Object.values(ticketsPorPrioridad).every(v => v === 0) && (
            <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '16px 0' }}>Sin tickets abiertos ✓</div>
          )}
        </div>

        {/* Vencimientos próximos 30 días */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>⏳ Vencimientos próximos 30 días ({vencimientos30.length})</div>
          {vencimientos30.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9ca3af', textAlign: 'center', padding: '16px 0' }}>Sin vencimientos en los próximos 30 días ✓</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
              {vencimientos30.map((v, i) => {
                const dias = diasRestantes(v.fecha)
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: dias <= 7 ? '#fef2f2' : '#f9fafb', borderRadius: 7 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: v.color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: v.color }}>{dias}d</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.titulo}</div>
                      <div style={{ fontSize: 10, color: '#9ca3af' }}>{v.fecha} · {v.tipo}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Semáforo resumen */}
      <div style={{ marginTop: 16, background: '#f8fafc', borderRadius: 10, padding: '12px 16px', border: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', marginBottom: 8 }}>Estado general del condominio</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
          {[
            { area: 'Cobro', score: (() => { const p = cuotas.filter(c => c.estado === 'pagado').length; const t = cuotas.length; return t > 0 ? Math.round(p/t*100) : 100 })(), invert: true },
            { area: 'Mantenimiento', score: tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length, invert: false },
            { area: 'Seguridad', score: incidentes.filter(i => i.fecha?.startsWith(mes)).length, invert: false },
            { area: 'Vencimientos', score: vencimientos30.filter(v => diasRestantes(v.fecha) <= 7).length, invert: false },
            { area: 'Sugerencias', score: sugerencias.filter(s => s.estado === 'pendiente').length, invert: false },
          ].map(item => {
            const color = item.invert
              ? semaforoInv(item.score, 90, 70)
              : semaforo(item.score, 0, 3)
            const emoji = color === '#16a34a' ? '🟢' : color === '#d97706' ? '🟡' : '🔴'
            return (
              <div key={item.area} style={{ textAlign: 'center', padding: '8px 4px' }}>
                <div style={{ fontSize: 20 }}>{emoji}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginTop: 2 }}>{item.area}</div>
                <div style={{ fontSize: 10, color: '#9ca3af' }}>{item.score}{item.invert ? '%' : ''}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
