// Banner de la ronda en curso con su checklist de puntos (P1 #3, extraído de
// SeguridadTab con el JSX intacto).
import type { SeguridadCtx } from './ctx'
import { VISITA_CONFIG } from './ui'

export function RondaEnCursoBanner({ ctx }: { ctx: SeguridadCtx }) {
  const {
    rondaEnCurso, rutas, canEdit, finalizarRonda,
    puntosRondaActual, visitasRondaActual, puntosCompletados, progreso,
    marcarVisita, marcarVisitaConNovedad,
  } = ctx

  if (!rondaEnCurso) return null

  return (
    <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: puntosRondaActual.length > 0 ? '12px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🛡️</span>
          <div>
            <span style={{ fontSize: '13.5px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
              Ronda en curso desde {new Date(rondaEnCurso.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
            </span>
            {rondaEnCurso.ruta_id && rutas.find(r => r.id === rondaEnCurso.ruta_id) && (
              <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-primary-2)' }}>
                🗺 {rutas.find(r => r.id === rondaEnCurso.ruta_id)?.nombre}
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <button onClick={() => finalizarRonda(rondaEnCurso.id, 'incompleta')}
            style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
            Marcar incompleta
          </button>
        )}
      </div>

      {/* Checklist de puntos de la ronda */}
      {puntosRondaActual.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <div style={{ flex: 1, height: '8px', background: 'var(--at-primary-soft)', borderRadius: '99px', overflow: 'hidden' }}>
              <div style={{ width: `${progreso}%`, height: '100%', background: progreso === 100 ? 'var(--at-success)' : 'var(--at-primary-2)', borderRadius: '99px', transition: 'width .4s' }} />
            </div>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-primary-hover)', whiteSpace: 'nowrap' }}>{puntosCompletados}/{puntosRondaActual.length} puntos ({progreso}%)</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {puntosRondaActual.map((punto, idx) => {
              const visita = visitasRondaActual.find(v => v.punto_id === punto.id)
              const vc = visita ? VISITA_CONFIG[visita.estado] : VISITA_CONFIG['pendiente']
              const area = punto.area_nombre ?? punto.area_id
              const icono = punto.area_icono ?? '📍'
              return (
                <div key={punto.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', background: vc.bg, borderRadius: '9px', border: `1px solid ${visita?.estado === 'ok' ? 'var(--at-success-border)' : visita?.estado === 'novedad' ? 'var(--at-warning-border)' : 'var(--at-line)'}` }}>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--at-accent)', width: '16px', textAlign: 'center' }}>{idx + 1}</span>
                  <span style={{ fontSize: '18px' }}>{icono}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>{area}</div>
                    {punto.instrucciones && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{punto.instrucciones}</div>}
                    {visita?.notas && <div style={{ fontSize: '11.5px', color: 'var(--at-warning)' }}>⚠ {visita.notas}</div>}
                  </div>
                  <span style={{ fontSize: '14px' }}>{vc.icon}</span>
                  {canEdit && visita && visita.estado === 'pendiente' && (
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={() => marcarVisita(visita.id, 'ok')} title="OK" style={{ padding: '4px 9px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>✅</button>
                      <button onClick={() => marcarVisitaConNovedad(visita.id)} title="Novedad" style={{ padding: '4px 9px', background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>⚠️</button>
                      <button onClick={() => marcarVisita(visita.id, 'omitido')} title="Omitir" style={{ padding: '4px 9px', background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft-2)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>⏭</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
