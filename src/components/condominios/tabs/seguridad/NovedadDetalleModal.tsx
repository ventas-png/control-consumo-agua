// Detalle de una novedad de seguridad, en ventana (pantalla completa en el
// teléfono, Esc la cierra). Eliminar pregunta primero y la ventana sólo se
// cierra si de verdad se eliminó: antes se cerraba antes de preguntar, y al
// cancelar o fallar el detalle ya no estaba.
import { useState } from 'react'
import { SecureFileLink } from '../../../shared/SecureFileLink'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import type { SeguridadCtx } from './ctx'
import { separarDescripcionNovedad } from '../../../../lib/seguridadReglas'
import { accentPrioridad, PRIORIDAD_CONFIG, TIPO_NOVEDAD_CONFIG } from './ui'
import { tint } from '../../../shared/statusTone'

const titulo = { fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } as const

export function NovedadDetalleModal({ ctx }: { ctx: SeguridadCtx }) {
  const { rondas, canDelete, novedadDetalle, setNovedadDetalle, setRondaDetalle, eliminarNovedad } = ctx
  const [eliminando, setEliminando] = useState(false)

  if (!novedadDetalle) return null

  const pc = PRIORIDAD_CONFIG[novedadDetalle.prioridad]
  const tc = TIPO_NOVEDAD_CONFIG[novedadDetalle.tipo]
  const rondaVinculada = novedadDetalle.ronda_id ? rondas.find(r => r.id === novedadDetalle.ronda_id) : null
  const accentColor = accentPrioridad(novedadDetalle.prioridad)
  const cerrar = () => { if (!eliminando) setNovedadDetalle(null) }

  async function eliminar() {
    if (!novedadDetalle) return
    setEliminando(true)
    const ok = await eliminarNovedad(novedadDetalle.id)
    setEliminando(false)
    if (ok) setNovedadDetalle(null)
  }

  const fotos = novedadDetalle.fotos && novedadDetalle.fotos.length > 0
    ? novedadDetalle.fotos
    : novedadDetalle.foto_url ? [novedadDetalle.foto_url] : []
  const { datosRegistro, comentario } = separarDescripcionNovedad(novedadDetalle.descripcion)

  return (
    <EditModal
      title={`${tc.icon} ${tc.label}`}
      subtitle={
        <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
          <span>{new Date(novedadDetalle.created_at).toLocaleString('es', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </span>
      }
      maxWidth="560px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!eliminando}
      closeOnEscape={!eliminando}
      footer={
        <>
          {canDelete && (
            <Button variant="outline-danger" onClick={() => void eliminar()} loading={eliminando} loadingText="Eliminando…">🗑 Eliminar</Button>
          )}
          <Button variant="secondary" onClick={cerrar} disabled={eliminando}>Cerrar</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', borderTop: `4px solid ${accentColor}`, paddingTop: '14px' }}>
        {/* Fotos de evidencia */}
        {fotos.length > 0 && (
          <div>
            <div style={titulo}>Evidencia fotográfica ({fotos.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: fotos.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(min(100%, 140px), 1fr))', gap: '8px' }}>
              {fotos.map((url, i) => (
                <SecureFileLink key={i} src={url}>
                  {signed => (
                    <img src={signed} alt={`Evidencia ${i + 1}`}
                      style={{ width: '100%', height: fotos.length === 1 ? '200px' : '100px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
                  )}
                </SecureFileLink>
              ))}
            </div>
          </div>
        )}

        {/* Descripción: separar datos del registro vs comentario del guardia */}
        {datosRegistro && (
          <div>
            <div style={titulo}>Datos del registro</div>
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
          <div style={titulo}>Comentarios</div>
          <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--at-ink)', lineHeight: 1.6, background: 'var(--at-warning-tint)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--at-warning-border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {comentario}
          </p>
        </div>

        {/* Metadatos */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '12px' }}>
          {novedadDetalle.ubicacion && (
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-line)' }}>
              <div style={{ ...titulo, marginBottom: '4px' }}>Ubicación</div>
              <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600, overflowWrap: 'anywhere' }}>📍 {novedadDetalle.ubicacion}</div>
            </div>
          )}
          {rondaVinculada && (
            // Abre la ronda: sus puntos y sus otras novedades.
            <button type="button" className="cond-kpi-link" onClick={() => { setNovedadDetalle(null); setRondaDetalle(rondaVinculada) }}
              style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', background: 'var(--at-primary-tint)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-primary-soft-2)' }}>
              <div style={{ ...titulo, color: 'var(--at-primary)', marginBottom: '4px' }}>Ronda vinculada</div>
              <div style={{ fontSize: '13.5px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                🛡 {new Date(rondaVinculada.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short' })} · {new Date(rondaVinculada.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })} →
              </div>
            </button>
          )}
          <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-line)' }}>
            <div style={{ ...titulo, marginBottom: '4px' }}>Tipo</div>
            <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>{tc.icon} {tc.label}</div>
          </div>
          <div style={{ background: pc.bg, borderRadius: '10px', padding: '12px', border: `1px solid ${tint(accentColor, 19)}` }}>
            <div style={{ ...titulo, color: pc.color, marginBottom: '4px' }}>Prioridad</div>
            <div style={{ fontSize: '13.5px', color: pc.color, fontWeight: 700 }}>{pc.label}</div>
          </div>
        </div>
      </div>
    </EditModal>
  )
}
