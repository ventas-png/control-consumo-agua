// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { VisitantesCtx } from './ctx'
import { SecureImage } from '../../../shared/SecureImage'
import { SecureFileLink } from '../../../shared/SecureFileLink'

export function VisitanteDetalle({ ctx }: { ctx: VisitantesCtx }) {
  const { visitantes, visitanteDetalle, setVisitanteDetalle, hoy, iniciarSalida } = ctx
  if (!visitanteDetalle) return null
  return (
        <div onClick={() => setVisitanteDetalle(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '500px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 20px', borderBottom: '1px solid var(--at-chip)' }}>
              {visitanteDetalle.foto_url
                ? <SecureImage src={visitanteDetalle.foto_url} alt={visitanteDetalle.nombre} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--at-line)', flexShrink: 0 }} />
                : <div style={{ width: 52, height: 52, borderRadius: '50%', background: !visitanteDetalle.hora_salida ? 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))' : 'var(--at-line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: !visitanteDetalle.hora_salida ? 'white' : 'var(--at-ink-3)', fontWeight: 800, fontSize: '20px', flexShrink: 0 }}>
                    {visitanteDetalle.es_menor ? '👶' : visitanteDetalle.nombre.charAt(0).toUpperCase()}
                  </div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '17px', fontWeight: 800, color: 'var(--at-ink)' }}>{visitanteDetalle.nombre}</span>
                  {visitanteDetalle.es_menor && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>
                  )}
                  {visitanteDetalle.visitante_principal_id && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Acompañante</span>
                  )}
                  {visitanteDetalle.reserva_str_id && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>STR</span>
                  )}
                  {visitanteDetalle.solicitud_mudanza_id && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Mudanza</span>
                  )}
                </div>
                {visitanteDetalle.unidad_nombre && <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '2px' }}>📍 {visitanteDetalle.unidad_nombre}</div>}
              </div>
              <button onClick={() => setVisitanteDetalle(null)}
                style={{ background: 'var(--at-chip)', border: 'none', borderRadius: '8px', color: 'var(--at-ink-3)', cursor: 'pointer', fontSize: '18px', padding: '6px 10px', flexShrink: 0 }}>
                ✕
              </button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[
                  { label: 'Entrada', value: new Date(visitanteDetalle.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
                  { label: 'Salida', value: visitanteDetalle.hora_salida ? new Date(visitanteDetalle.hora_salida).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '— En premisas' },
                  ...(visitanteDetalle.es_menor
                    ? [{ label: 'Tipo', value: 'Menor de edad' }]
                    : visitanteDetalle.identificacion ? [{ label: 'DPI / ID', value: visitanteDetalle.identificacion }] : []),
                  ...(visitanteDetalle.fecha_nacimiento ? [{ label: 'Fecha nac.', value: visitanteDetalle.fecha_nacimiento }] : []),
                  ...(visitanteDetalle.placa_vehiculo ? [{ label: 'Vehículo', value: `🚗 ${visitanteDetalle.placa_vehiculo}` }] : []),
                  ...(visitanteDetalle.motivo ? [{ label: 'Motivo', value: visitanteDetalle.motivo }] : []),
                  ...(visitanteDetalle.notas ? [{ label: 'Notas', value: visitanteDetalle.notas }] : []),
                  ...(visitanteDetalle.visitante_principal_id ? (() => {
                    const p = visitantes.find(x => x.id === visitanteDetalle.visitante_principal_id)
                    return p ? [{ label: 'Acompañante de', value: p.nombre }] : []
                  })() : []),
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '10px 12px', border: '1px solid var(--at-line)' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>{label}</div>
                    <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', fontWeight: 600, wordBreak: 'break-word' }}>{value}</div>
                  </div>
                ))}
              </div>
              {(visitanteDetalle.foto_url || visitanteDetalle.foto_documento_url || visitanteDetalle.foto_vehiculo_url) && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Fotografías registradas</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { url: visitanteDetalle.foto_url, label: 'Persona' },
                      { url: visitanteDetalle.foto_documento_url, label: 'DPI' },
                      { url: visitanteDetalle.foto_vehiculo_url, label: 'Vehículo' },
                    ].filter(f => f.url).map(f => (
                      <SecureFileLink key={f.label} src={f.url} style={{ textDecoration: 'none' }}>
                        {signed => (
                          <>
                            <img src={signed} alt={f.label} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
                            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', textAlign: 'center', marginTop: '3px' }}>{f.label}</div>
                          </>
                        )}
                      </SecureFileLink>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px', borderTop: '1px solid var(--at-chip)' }}>
                {!visitanteDetalle.hora_salida && (() => {
                  const esSTR = visitanteDetalle.motivo?.startsWith('Renta corta')
                  const fechaSalidaSTR = (esSTR && !visitanteDetalle.reserva_str_id) ? (visitanteDetalle.notas?.match(/Salida: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
                  const salidaHabilitada = !fechaSalidaSTR || hoy >= fechaSalidaSTR
                  return salidaHabilitada ? (
                    <button onClick={() => { setVisitanteDetalle(null); iniciarSalida(visitanteDetalle) }}
                      style={{ padding: '9px 18px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                      Registrar salida
                    </button>
                  ) : null
                })()}
                <button onClick={() => setVisitanteDetalle(null)}
                  style={{ padding: '9px 20px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
  )
}
