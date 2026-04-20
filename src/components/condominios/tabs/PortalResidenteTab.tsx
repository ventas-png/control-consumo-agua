import { useState } from 'react'
import type { CuotaCondominio, TicketMantenimiento, ReservaAmenidad, ComunicadoCondominio, Unidad, SancionCondominio } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  tickets: TicketMantenimiento[]
  reservas: ReservaAmenidad[]
  comunicados: ComunicadoCondominio[]
  sanciones: SancionCondominio[]
  unidades: Unidad[]
  moneda: string
}

const TICKET_COLOR: Record<string, string> = {
  abierto: '#f59e0b', en_proceso: '#0ea5e9', resuelto: '#10b981', cerrado: '#94a3b8',
}

const CUOTA_COLOR: Record<string, { bg: string; color: string }> = {
  pendiente: { bg: '#fef3c7', color: '#92400e' },
  moroso:    { bg: '#fee2e2', color: '#ef4444' },
  pagado:    { bg: '#dcfce7', color: '#16a34a' },
}

export function PortalResidenteTab({ cuotas, tickets, reservas, comunicados, sanciones, unidades, moneda }: Props) {
  const [selectedUnidad, setSelectedUnidad] = useState('')

  const today = new Date().toISOString().slice(0, 10)

  const cuotasU     = selectedUnidad ? cuotas.filter(c => c.unidad_id === selectedUnidad && c.estado !== 'pagado') : []
  const ticketsU    = selectedUnidad ? tickets.filter(t => t.unidad_id === selectedUnidad && t.estado !== 'cerrado') : []
  const reservasU   = selectedUnidad ? reservas.filter(r => r.unidad_id === selectedUnidad && r.fecha >= today).slice(0, 5) : []
  const sancionesU  = selectedUnidad ? sanciones.filter(s => s.unidad_id === selectedUnidad && s.estado === 'pendiente') : []
  const comunicadosU = comunicados
    .filter(c => ['todos', 'propietarios', 'arrendatarios'].includes(c.destinatario) || c.unidad_id === selectedUnidad)
    .slice(0, 5)

  const deudaTotal    = cuotasU.reduce((s, c) => s + c.monto, 0)
  const sancionTotal  = sancionesU.reduce((s, x) => s + x.monto, 0)

  function handlePrint() {
    const unidad = unidades.find(u => u.id === selectedUnidad)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Estado de Cuenta – ${unidad?.nombre ?? ''}</title>
    <style>body{font-family:sans-serif;padding:32px;color:#0f172a}h1{font-size:18px}h2{font-size:14px;margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:6px 8px;border:1px solid #e2e8f0;text-align:left}th{background:#f8fafc}</style>
    </head><body>
    <h1>Portal del Residente — ${unidad?.nombre ?? ''}</h1>
    <p style="font-size:12px;color:#64748b">Generado: ${new Date().toLocaleString()}</p>
    <h2>Cuotas pendientes (${moneda} ${deudaTotal.toFixed(2)})</h2>
    <table><tr><th>Concepto</th><th>Período</th><th>Monto</th><th>Estado</th></tr>
    ${cuotasU.map(c => `<tr><td>${c.concepto}</td><td>${c.periodo}</td><td>${moneda} ${c.monto.toFixed(2)}</td><td>${c.estado}</td></tr>`).join('')}
    </table>
    <h2>Tickets abiertos</h2>
    <table><tr><th>Título</th><th>Prioridad</th><th>Estado</th></tr>
    ${ticketsU.map(t => `<tr><td>${t.titulo}</td><td>${t.prioridad}</td><td>${t.estado}</td></tr>`).join('')}
    </table>
    </body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close(); w.print() }
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Portal del Residente</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Vista consolidada por unidad</p>
        </div>
        {selectedUnidad && (
          <button onClick={handlePrint}
            style={{ padding: '7px 14px', background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: '#374151' }}>
            🖨️ Imprimir resumen
          </button>
        )}
      </div>

      {/* Unit selector */}
      <div style={{ background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
        <label style={{ fontSize: '12px', fontWeight: 700, color: '#0369a1', display: 'block', marginBottom: '8px' }}>Seleccionar unidad</label>
        <select value={selectedUnidad} onChange={e => setSelectedUnidad(e.target.value)}
          style={{ width: '100%', maxWidth: '300px', padding: '8px 10px', border: '1.5px solid #bae6fd', borderRadius: '8px', fontSize: '14px', background: 'white', color: '#0f172a', fontWeight: 600 }}>
          <option value="">— Elegir unidad —</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </div>

      {!selectedUnidad ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏠</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#64748b' }}>Selecciona una unidad para ver su estado</div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            {[
              { label: 'Deuda cuotas',   value: `${moneda} ${deudaTotal.toFixed(2)}`,  color: deudaTotal > 0 ? '#ef4444' : '#10b981' },
              { label: 'Sanciones pend.',value: `${moneda} ${sancionTotal.toFixed(2)}`,color: sancionTotal > 0 ? '#ef4444' : '#10b981' },
              { label: 'Tickets abiertos', value: String(ticketsU.length), color: ticketsU.length > 0 ? '#f59e0b' : '#10b981' },
              { label: 'Próx. reservas', value: String(reservasU.length), color: '#0ea5e9' },
            ].map(k => (
              <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
            {/* Cuotas */}
            <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>💳 Cuotas pendientes</div>
              {cuotasU.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>✓ Sin deuda pendiente</div>
              ) : (
                cuotasU.map(c => {
                  const ec = CUOTA_COLOR[c.estado] ?? { bg: '#f1f5f9', color: '#94a3b8' }
                  return (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>{c.concepto}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.periodo}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444' }}>{moneda} {c.monto.toFixed(2)}</div>
                        <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: ec.bg, color: ec.color }}>{c.estado}</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Tickets */}
            <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>🔧 Tickets abiertos</div>
              {ticketsU.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>✓ Sin tickets pendientes</div>
              ) : (
                ticketsU.map(t => (
                  <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px' }}>{t.titulo}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>Prioridad: {t.prioridad}</div>
                      </div>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '10px',
                        background: '#fef3c7', color: TICKET_COLOR[t.estado] ?? '#94a3b8', marginLeft: '8px', flexShrink: 0 }}>
                        {t.estado}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reservas */}
            <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>🏊 Próximas reservas</div>
              {reservasU.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Sin reservas próximas</div>
              ) : (
                reservasU.map(r => (
                  <div key={r.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{r.amenidad_nombre ?? 'Amenidad'}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{r.fecha} · {r.hora_inicio} – {r.hora_fin}</div>
                  </div>
                ))
              )}
            </div>

            {/* Sanciones */}
            {sancionesU.length > 0 && (
              <div style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: '12px', padding: '14px' }}>
                <div style={{ fontWeight: 700, fontSize: '13px', color: '#c2410c', marginBottom: '10px' }}>⚖️ Sanciones pendientes</div>
                {sancionesU.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #fed7aa' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#7c2d12' }}>{s.concepto}</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444' }}>{moneda} {s.monto.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Comunicados */}
            <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', marginBottom: '10px' }}>📢 Comunicados recientes</div>
              {comunicadosU.length === 0 ? (
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Sin comunicados</div>
              ) : (
                comunicadosU.map(c => (
                  <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '2px' }}>{c.titulo}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.fecha_envio?.slice(0, 10)} · {c.tipo}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
