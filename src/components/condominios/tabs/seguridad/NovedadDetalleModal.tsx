// Modal de detalle de una novedad de seguridad (P1 #3, extraído de
// SeguridadTab con el JSX intacto).
import { SecureFileLink } from '../../../shared/SecureFileLink'
import type { SeguridadCtx } from './ctx'
import { separarDescripcionNovedad } from '../../../../lib/seguridadReglas'
import { accentPrioridad, PRIORIDAD_CONFIG, TIPO_NOVEDAD_CONFIG } from './ui'
import { ModalPortal } from '../../../shared/ModalPortal'

export function NovedadDetalleModal({ ctx }: { ctx: SeguridadCtx }) {
  const { rondas, canEdit, novedadDetalle, setNovedadDetalle, eliminarNovedad } = ctx

  if (!novedadDetalle) return null

  const pc = PRIORIDAD_CONFIG[novedadDetalle.prioridad]
  const tc = TIPO_NOVEDAD_CONFIG[novedadDetalle.tipo]
  const rondaVinculada = novedadDetalle.ronda_id ? rondas.find(r => r.id === novedadDetalle.ronda_id) : null
  const accentColor = accentPrioridad(novedadDetalle.prioridad)
  return (
    <ModalPortal>
    <div onClick={() => setNovedadDetalle(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '520px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header con color de prioridad */}
        <div style={{ height: '6px', background: accentColor }} />
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--at-chip)', display: 'flex', alignItems: 'flex-start', gap: '12px', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span style={{ fontSize: '28px', lineHeight: 1 }}>{tc.icon}</span>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--at-ink)' }}>{tc.label}</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  {new Date(novedadDetalle.created_at).toLocaleString('es', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
          <button onClick={() => setNovedadDetalle(null)}
            style={{ background: 'var(--at-chip)', border: 'none', borderRadius: '8px', color: 'var(--at-ink-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '6px 10px', flexShrink: 0 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
          {/* Fotos de evidencia */}
          {((novedadDetalle.fotos && novedadDetalle.fotos.length > 0) || novedadDetalle.foto_url) && (() => {
            const todas = novedadDetalle.fotos && novedadDetalle.fotos.length > 0
              ? novedadDetalle.fotos
              : [novedadDetalle.foto_url!]
            return (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                  Evidencia fotográfica ({todas.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: todas.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                  {todas.map((url, i) => (
                    <SecureFileLink key={i} src={url}>
                      {signed => (
                        <img src={signed} alt={`Evidencia ${i + 1}`}
                          style={{ width: '100%', height: todas.length === 1 ? '200px' : '100px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
                      )}
                    </SecureFileLink>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Descripción: separar datos del registro vs comentario del guardia */}
          {(() => {
            const { datosRegistro, comentario } = separarDescripcionNovedad(novedadDetalle.descripcion)
            return (
              <>
                {datosRegistro && (
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Datos del registro</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--at-line)', lineHeight: 1.7 }}>
                      {datosRegistro.split(' | ').map((item, i) => (
                        <span key={i} style={{ display: 'inline-block', marginRight: '6px' }}>
                          {i > 0 && <span style={{ color: 'var(--at-line-strong)', marginRight: '6px' }}>·</span>}
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Comentarios</div>
                  <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--at-ink)', lineHeight: 1.6, background: 'var(--at-warning-tint)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--at-warning-border)', whiteSpace: 'pre-wrap' }}>
                    {comentario}
                  </p>
                </div>
              </>
            )
          })()}

          {/* Metadatos en grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {novedadDetalle.ubicacion && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-line)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Ubicación</div>
                <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>📍 {novedadDetalle.ubicacion}</div>
              </div>
            )}
            {rondaVinculada && (
              <div style={{ background: 'var(--at-primary-tint)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-primary-soft-2)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Ronda vinculada</div>
                <div style={{ fontSize: '13.5px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                  🛡 {new Date(rondaVinculada.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short' })} · {new Date(rondaVinculada.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-line)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Tipo</div>
              <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>{tc.icon} {tc.label}</div>
            </div>
            <div style={{ background: pc.bg, borderRadius: '10px', padding: '12px', border: `1px solid ${accentColor}30` }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: pc.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Prioridad</div>
              <div style={{ fontSize: '13.5px', color: pc.color, fontWeight: 700 }}>{pc.label}</div>
            </div>
          </div>

          {/* Acciones */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px', borderTop: '1px solid var(--at-chip)' }}>
            {canEdit && (
              <button onClick={async () => { setNovedadDetalle(null); await eliminarNovedad(novedadDetalle.id) }}
                style={{ padding: '9px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1.5px solid var(--at-danger-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                🗑 Eliminar
              </button>
            )}
            <button onClick={() => setNovedadDetalle(null)}
              style={{ padding: '9px 20px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
