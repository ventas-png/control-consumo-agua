import type { CuotaCondominio, EstadoCuota } from '../../../types'

interface Props {
  cuotas: CuotaCondominio[]
  moneda: string
  unidadNombre: string
}

const ESTADO_CONFIG: Record<EstadoCuota, { label: string; bg: string; color: string; border: string }> = {
  pendiente: { label: 'Pendiente', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  pagado:    { label: 'Pagado',    bg: '#f0fdf4', color: '#15803d', border: '#86efac' },
  moroso:    { label: 'Vencida',   bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
}

export function PortalMiCuentaTab({ cuotas, moneda, unidadNombre }: Props) {
  const pendientes  = cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
  const pagadas     = cuotas.filter(c => c.estado === 'pagado')
  const totalDeuda  = pendientes.reduce((s, c) => s + c.monto, 0)
  const totalPagado = pagadas.reduce((s, c) => s + c.monto, 0)
  const hoy         = new Date().toISOString().slice(0, 10)
  const vencidas    = pendientes.filter(c => c.fecha_vencimiento && c.fecha_vencimiento < hoy)

  return (
    <div>
      <h3 style={{ margin: '0 0 18px', fontSize: '17px', fontWeight: 700, color: '#15291F' }}>Mi cuenta — {unidadNombre}</h3>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <div style={{ background: totalDeuda > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '14px', padding: '16px', border: `1.5px solid ${totalDeuda > 0 ? '#fecaca' : '#86efac'}` }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#7E9389', marginBottom: '4px' }}>SALDO PENDIENTE</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: totalDeuda > 0 ? '#dc2626' : '#16a34a' }}>{moneda} {totalDeuda.toFixed(2)}</div>
          {vencidas.length > 0 && <div style={{ fontSize: '11.5px', color: '#dc2626', marginTop: '3px' }}>{vencidas.length} cuota{vencidas.length > 1 ? 's' : ''} vencida{vencidas.length > 1 ? 's' : ''}</div>}
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: '14px', padding: '16px', border: '1.5px solid #86efac' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#7E9389', marginBottom: '4px' }}>TOTAL PAGADO</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a' }}>{moneda} {totalPagado.toFixed(2)}</div>
          <div style={{ fontSize: '11.5px', color: '#7E9389', marginTop: '3px' }}>{pagadas.length} pago{pagadas.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ background: '#EEF2EC', borderRadius: '14px', padding: '16px', border: '1.5px solid var(--at-primary-soft-2)' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#7E9389', marginBottom: '4px' }}>CUOTAS PENDIENTES</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: '#1B3B36' }}>{pendientes.length}</div>
          <div style={{ fontSize: '11.5px', color: '#7E9389', marginTop: '3px' }}>de {cuotas.length} en total</div>
        </div>
      </div>

      {/* Cuotas pendientes */}
      {pendientes.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: '#3E5A4C' }}>Cuotas por pagar</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pendientes.sort((a, b) => (a.periodo < b.periodo ? -1 : 1)).map(c => {
              const ec = ESTADO_CONFIG[c.estado]
              const esVencida = c.fecha_vencimiento && c.fecha_vencimiento < hoy
              return (
                <div key={c.id} style={{ background: 'white', border: `1.5px solid ${esVencida ? '#fecaca' : '#fde68a'}`, borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#15291F' }}>{c.concepto.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} — {c.periodo}</div>
                    {c.fecha_vencimiento && (
                      <div style={{ fontSize: '12.5px', color: esVencida ? '#dc2626' : '#7E9389', marginTop: '2px' }}>
                        {esVencida ? '⚠ Vencida el ' : 'Vence el '}{new Date(c.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                    )}
                    {c.notas && <div style={{ fontSize: '12px', color: '#7E9389', marginTop: '2px' }}>{c.notas}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '16px', color: '#15291F' }}>{moneda} {c.monto.toFixed(2)}</div>
                    <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Historial de pagos */}
      {pagadas.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: '#3E5A4C' }}>Historial de pagos</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {pagadas.sort((a, b) => (b.fecha_pago ?? b.created_at) < (a.fecha_pago ?? a.created_at) ? -1 : 1).map(c => (
              <div key={c.id} style={{ background: '#FAF7EF', border: '1px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>✅</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13.5px', color: '#3E5A4C' }}>{c.concepto.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} — {c.periodo}</div>
                  {c.fecha_pago && <div style={{ fontSize: '12px', color: '#7E9389' }}>Pagado el {new Date(c.fecha_pago + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}{c.metodo_pago ? ` · ${c.metodo_pago}` : ''}</div>}
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#16a34a', flexShrink: 0 }}>{moneda} {c.monto.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cuotas.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>💳</div>
          <p style={{ fontWeight: 600, color: '#7E9389' }}>No hay cuotas registradas para esta unidad</p>
        </div>
      )}
    </div>
  )
}
