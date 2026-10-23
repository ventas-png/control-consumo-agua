// Detalle de una ronda en ventana: cuándo, cuánto duró, su ruta y, punto por
// punto, cómo se cerró (con las notas y las fotos de evidencia), más las
// novedades que se le vincularon. Antes la lista de rondas sólo daba conteos
// (✅ 5 · ⚠️ 1) y no había dónde ver qué se encontró en cada punto.
import type { ReactNode } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { SecureFileLink } from '../../../shared/SecureFileLink'
import { duracionRondaMin } from '../../../../lib/seguridadReglas'
import type { SeguridadCtx } from './ctx'
import { ESTADO_RONDA, PRIORIDAD_CONFIG, TIPO_NOVEDAD_CONFIG, VISITA_CONFIG } from './ui'

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

export function RondaDetalleModal({ ctx }: { ctx: SeguridadCtx }) {
  const {
    rondaDetalle: r, setRondaDetalle, rutas, puntosControl, visitasControl, novedades,
    canEdit, finalizando, finalizarRonda, setNovedadDetalle,
  } = ctx

  if (!r) return null

  const ec = ESTADO_RONDA[r.estado]
  const rutaNombre = r.ruta_id ? rutas.find(rt => rt.id === r.ruta_id)?.nombre ?? r.ruta_nombre : null
  const cerrando = finalizando === r.id
  const cerrar = () => { if (!cerrando) setRondaDetalle(null) }

  const porPunto = new Map(puntosControl.map(p => [p.id, p]))
  const visitas = visitasControl
    .filter(v => v.ronda_id === r.id)
    .map(v => {
      const p = porPunto.get(v.punto_id)
      return {
        v,
        orden: p?.orden ?? v.punto_orden ?? 0,
        nombre: p?.punto_nombre ?? p?.area_nombre ?? v.area_nombre ?? 'Punto de control',
        area: p?.punto_nombre ? (p.area_nombre ?? null) : null,
        icono: p?.area_icono ?? v.area_icono ?? '📍',
      }
    })
    .sort((a, b) => a.orden - b.orden)
  const novedadesRonda = novedades.filter(n => n.ronda_id === r.id)

  const fila = (label: string, valor: ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: '14px' }}>
      <span style={{ color: 'var(--at-ink-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{valor}</span>
    </div>
  )

  return (
    <EditModal
      title={`🛡️ Ronda del ${new Date(r.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}`}
      subtitle={
        <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
          {rutaNombre && <span>🗺 {rutaNombre}</span>}
        </span>
      }
      maxWidth="560px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!cerrando}
      closeOnEscape={!cerrando}
      footer={
        <>
          {canEdit && r.estado === 'en_curso' && (
            <Button variant="success" onClick={() => void finalizarRonda(r.id, 'completada')} loading={cerrando} loadingText="Cerrando…" disabled={finalizando !== null && !cerrando}>
              ✓ Completar
            </Button>
          )}
          <Button variant="secondary" onClick={cerrar} disabled={cerrando}>Cerrar</Button>
        </>
      }
    >
      {fila('Inicio', hora(r.inicio))}
      {fila('Fin', r.fin ? hora(r.fin) : 'En curso')}
      {fila('Duración', `${duracionRondaMin(r.inicio, r.fin, Date.now())} min`)}
      {r.notas && fila('Notas', r.notas)}

      <div style={{ marginTop: '16px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '6px' }}>
          Puntos de control{visitas.length > 0 ? ` (${visitas.filter(x => x.v.estado !== 'pendiente').length}/${visitas.length})` : ''}
        </div>
        {visitas.length === 0 ? (
          <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Ronda sin ruta: no tiene checklist de puntos.</div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '6px' }}>
            {visitas.map(({ v, nombre, area, icono }, i) => {
              const vc = VISITA_CONFIG[v.estado]
              return (
                <li key={v.id} style={{ padding: '8px 10px', background: vc.bg, borderRadius: '9px', border: '1px solid var(--at-line)' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--at-accent)', minWidth: '16px' }}>{i + 1}</span>
                    <span aria-hidden>{icono}</span>
                    <span style={{ flex: '1 1 140px', minWidth: 0, fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>
                      {nombre}
                      {area && <span style={{ display: 'block', fontSize: '11px', fontWeight: 400, color: 'var(--at-ink-3)' }}>{area}</span>}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: vc.color, whiteSpace: 'nowrap' }}>
                      {vc.icon} {vc.label}{v.visitado_en ? ` · ${hora(v.visitado_en)}` : ''}
                    </span>
                  </div>
                  {v.notas && <p style={{ margin: '4px 0 0 24px', fontSize: '12.5px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{v.notas}</p>}
                  {v.foto_urls.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '6px 0 0 24px' }}>
                      {v.foto_urls.map((url, j) => (
                        <SecureFileLink key={j} src={url} aria-label={`Foto ${j + 1} de ${nombre}`}>
                          {signed => <img src={signed} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--at-line)', display: 'block' }} />}
                        </SecureFileLink>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {novedadesRonda.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Novedades vinculadas ({novedadesRonda.length})</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '4px' }}>
            {novedadesRonda.map(n => {
              const tc = TIPO_NOVEDAD_CONFIG[n.tipo]
              const pc = PRIORIDAD_CONFIG[n.prioridad]
              return (
                <li key={n.id}>
                  <button type="button" className="cond-barra-fila" onClick={() => setNovedadDetalle(n)}
                    style={{ width: '100%', display: 'flex', gap: '8px', alignItems: 'center', textAlign: 'left', background: 'none', border: 'none', borderRadius: '6px', padding: '6px 8px', font: 'inherit', fontSize: '13px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                    <span aria-hidden>{tc.icon}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.descripcion}</span>
                    <span style={{ padding: '1px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: pc.bg, color: pc.color, flexShrink: 0 }}>{pc.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </EditModal>
  )
}
