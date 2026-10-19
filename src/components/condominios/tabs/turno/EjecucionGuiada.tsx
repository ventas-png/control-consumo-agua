// El turno en curso, una tarjeta por vez. Arriba, el recorrido por paradas
// (áreas); al llegar a una parada, qué se va a hacer en ella; después cada tarea
// con lo suyo (indicaciones, insumos, pasos, foto, comentario) y un solo botón
// para seguir, que es el que guarda. Al final, el resumen y el cierre del turno.
//
// No guarda nada por su cuenta: cada acción la resuelve TareasPersonalTab con
// la misma lógica de la lista (evidencia, RPC de cierre y consumo, novedad), y
// el panel de cada tarea lo pinta el mismo código que en la lista. Esto es sólo
// el orden en que se ve.
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { TareaBloque } from '../../../../types'
import {
  duracionLegible, paradaDe, tareaResuelta, type ParadaGuiada,
} from '../../../../domain/condominios/ejecucionGuiada'

interface Props {
  /** Las tareas del turno en orden, con el estado que ya se guardó aplicado. */
  tareas: TareaBloque[]
  paradas: ParadaGuiada[]
  /** null = no queda nada pendiente (o se eligió el resumen). */
  actualId: string | null
  paradaEmpezada: (clave: string) => boolean
  puedeEjecutar: boolean
  guardando: boolean
  /** Lo último que pasó, para lectores de pantalla y para quien no miró. */
  aviso: string
  onIr: (tareaId: string | null) => void
  onEmpezarParada: (clave: string) => void
  onListo: (t: TareaBloque) => void
  onObservacion: (t: TareaBloque) => void
  onOmitir: (t: TareaBloque) => void
  onCerrarTurno: () => void
  onVerLista: () => void
  /** Indicaciones, insumos, pasos, foto y comentario: el mismo panel de la lista. */
  panel: (t: TareaBloque) => ReactNode
}

const ESTADO: Record<TareaBloque['estado'], string> = {
  pendiente: '⏳ Pendiente',
  completada: '✅ Hecha',
  con_observacion: '⚠️ Hecha con observación',
  omitida: '⏭ Omitida',
}

const boton = (fondo: string, borde: string, color: string): CSSProperties => ({
  padding: '11px 14px', background: fondo, border: `1px solid ${borde}`, color, borderRadius: '10px',
  cursor: 'pointer', fontSize: '13.5px', fontWeight: 600,
})

export function EjecucionGuiada({
  tareas, paradas, actualId, paradaEmpezada, puedeEjecutar, guardando, aviso,
  onIr, onEmpezarParada, onListo, onObservacion, onOmitir, onCerrarTurno, onVerLista, panel,
}: Props) {
  const titulo = useRef<HTMLHeadingElement>(null)
  const resueltas = tareas.filter(t => tareaResuelta(t.estado)).length
  const actual = actualId ? tareas.find(t => t.id === actualId) ?? null : null
  const parada = actual ? paradaDe(paradas, actual.id) : undefined
  const nParada = parada ? paradas.indexOf(parada) : -1
  const enIntro = !!actual && !!parada && !tareaResuelta(actual.estado) && !paradaEmpezada(parada.clave)
  const i = actual ? tareas.indexOf(actual) : -1

  // El foco sigue a la tarjeta: quien navega con teclado o lector de pantalla
  // no tiene que buscar dónde quedó.
  useEffect(() => { titulo.current?.focus() }, [actualId, enIntro])

  const progreso = tareas.length ? Math.round((resueltas / tareas.length) * 100) : 0

  return (
    <div>
      {/* Avance y recorrido */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: '12.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>
            {resueltas} de {tareas.length} tareas · {progreso}%
          </div>
          <div style={{ marginTop: '4px', height: '6px', background: 'var(--at-line)', borderRadius: '99px', overflow: 'hidden' }}>
            <div style={{ width: `${progreso}%`, height: '100%', background: progreso === 100 ? 'var(--at-success)' : 'var(--at-warning)', transition: 'width .4s' }} />
          </div>
        </div>
        <button onClick={onVerLista} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)' }}>
          ☰ Ver lista completa
        </button>
      </div>

      {paradas.length > 1 && (
        <nav aria-label="Recorrido por áreas" style={{ display: 'flex', gap: '6px', overflowX: 'auto', padding: '2px 0 8px', marginBottom: '6px' }}>
          {paradas.map((p, n) => {
            const hechas = p.tareas.filter(t => tareaResuelta(t.estado)).length
            const completa = hechas === p.tareas.length
            const esActual = parada?.clave === p.clave
            const destino = p.tareas.find(t => !tareaResuelta(t.estado)) ?? p.tareas[0]
            return (
              <button key={p.clave} onClick={() => onIr(destino.id)} aria-current={esActual ? 'step' : undefined}
                aria-label={`Ir a ${p.nombre}: ${hechas} de ${p.tareas.length} resueltas`}
                style={{
                  flexShrink: 0, padding: '5px 10px', borderRadius: '99px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap',
                  fontWeight: esActual ? 700 : 500,
                  background: esActual ? 'var(--at-primary-tint)' : completa ? 'var(--at-success-tint)' : 'var(--at-surface)',
                  border: `1.5px solid ${esActual ? 'var(--at-primary)' : completa ? 'var(--at-success-border)' : 'var(--at-line)'}`,
                  color: completa && !esActual ? 'var(--at-success)' : 'var(--at-ink-2)',
                }}>
                {completa ? '✓' : `${n + 1}.`} {p.icono} {p.nombre} · {hechas}/{p.tareas.length}
              </button>
            )
          })}
        </nav>
      )}

      <div aria-live="polite" role="status" style={{ minHeight: aviso ? undefined : 0, fontSize: '12.5px', color: 'var(--at-success)', fontWeight: 600, marginBottom: aviso ? '6px' : 0 }}>
        {aviso}
      </div>

      {/* Fin del recorrido */}
      {!actual && (
        <section aria-label="Recorrido terminado" className="shared-card-in"
          style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-success-border)', borderRadius: '14px', padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px' }}>🏁</div>
          <h3 ref={titulo} tabIndex={-1} style={{ margin: '6px 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)', outline: 'none' }}>
            {resueltas === tareas.length ? '¡Recorrido terminado!' : 'Quedan tareas sin resolver'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>
            {tareas.filter(t => t.estado === 'completada').length} hechas
            {' · '}{tareas.filter(t => t.estado === 'con_observacion').length} con observación
            {' · '}{tareas.filter(t => t.estado === 'omitida').length} omitidas
            {resueltas < tareas.length && ` · ${tareas.length - resueltas} pendientes`}
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '14px' }}>
            {tareas.length > 0 && (
              <button onClick={() => onIr(tareas.find(t => !tareaResuelta(t.estado))?.id ?? tareas[0].id)} style={boton('var(--at-surface)', 'var(--at-line)', 'var(--at-ink-2)')}>
                {resueltas < tareas.length ? 'Ir a lo pendiente' : 'Revisar tareas'}
              </button>
            )}
            {puedeEjecutar && (
              <button onClick={onCerrarTurno} style={boton('var(--at-success)', 'var(--at-success)', 'var(--at-on-status)')}>
                ✓ Cerrar turno
              </button>
            )}
          </div>
        </section>
      )}

      {/* Llegada a una parada: qué se hace aquí */}
      {actual && parada && enIntro && (
        <section key={`intro-${parada.clave}`} aria-label={`Parada ${nParada + 1} de ${paradas.length}: ${parada.nombre}`} className="shared-card-in"
          style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '14px', padding: '18px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-primary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {nParada === 0 ? 'Primera parada' : `Parada ${nParada + 1} de ${paradas.length}`}
          </div>
          <h3 ref={titulo} tabIndex={-1} style={{ margin: '4px 0 2px', fontSize: '19px', fontWeight: 700, color: 'var(--at-ink)', outline: 'none' }}>
            {parada.icono} {parada.nombre}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
            {parada.tareas.length} tarea{parada.tareas.length !== 1 ? 's' : ''}
            {parada.minutos > 0 && ` · unos ${duracionLegible(parada.minutos)}`}
          </p>
          <div style={{ marginTop: '12px', fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Aquí vas a hacer:</div>
          <ol style={{ margin: '6px 0 0', paddingLeft: '20px', fontSize: '13.5px', color: 'var(--at-ink)' }}>
            {parada.tareas.map(t => (
              <li key={t.id} style={{ marginBottom: '4px', opacity: tareaResuelta(t.estado) ? 0.55 : 1 }}>
                {t.titulo}
                <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                  {t.duracion_estimada_min != null && ` · ⏱ ${t.duracion_estimada_min} min`}
                  {t.requiere_foto && ' · 📷 foto'}
                  {tareaResuelta(t.estado) && ` · ${ESTADO[t.estado]}`}
                </span>
              </li>
            ))}
          </ol>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
            <button onClick={() => onEmpezarParada(parada.clave)}
              style={{ ...boton('var(--at-primary)', 'var(--at-primary)', 'var(--at-on-status)'), flex: '0 1 320px' }}>
              Empezar en {parada.nombre} ›
            </button>
          </div>
        </section>
      )}

      {/* La tarea */}
      {actual && !enIntro && (
        <section key={actual.id} aria-label={`Tarea ${i + 1} de ${tareas.length}: ${actual.titulo}`} className="shared-card-in"
          style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '14px', padding: '16px' }}>
          {parada && (
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{parada.icono} {parada.nombre}</span>
              <span>Tarea {parada.tareas.indexOf(actual) + 1} de {parada.tareas.length} en esta área</span>
              <span>· {i + 1} de {tareas.length} del turno</span>
            </div>
          )}
          <h3 ref={titulo} tabIndex={-1} style={{ margin: '6px 0 2px', fontSize: '18px', fontWeight: 700, color: 'var(--at-ink)', outline: 'none' }}>
            {actual.titulo}
          </h3>
          {actual.descripcion && <p style={{ margin: '0 0 6px', fontSize: '13.5px', color: 'var(--at-ink-2)' }}>{actual.descripcion}</p>}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
            {actual.duracion_estimada_min != null && <span>⏱ {actual.duracion_estimada_min} min</span>}
            {actual.requiere_foto && <span style={{ color: 'var(--at-accent-hover)' }}>📷 Requiere foto</span>}
            {actual.requiere_comentario && <span style={{ color: 'var(--at-accent-hover)' }}>💬 Requiere comentario</span>}
            {tareaResuelta(actual.estado) && (
              <span style={{ fontWeight: 700, color: 'var(--at-ink-2)' }}>
                {ESTADO[actual.estado]}
                {actual.completada_en && ` a las ${new Date(actual.completada_en).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`}
              </span>
            )}
          </div>

          {!tareaResuelta(actual.estado) && puedeEjecutar && panel(actual)}
          {(actual.novedad ?? actual.notas_operativo) && (
            <div style={{ fontSize: '12.5px', color: 'var(--at-warning-strong)', marginBottom: '8px' }}>⚠ {actual.novedad ?? actual.notas_operativo}</div>
          )}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px' }}>
            {i > 0 && (
              <button onClick={() => onIr(tareas[i - 1].id)} disabled={guardando} aria-label="Tarea anterior"
                style={boton('var(--at-surface)', 'var(--at-line)', 'var(--at-ink-2)')}>
                ‹ Anterior
              </button>
            )}
            <span style={{ flex: '1 1 0' }} />
            {!tareaResuelta(actual.estado) && puedeEjecutar ? (
              <>
                <button onClick={() => onObservacion(actual)} disabled={guardando}
                  style={boton('var(--at-warning-tint)', 'var(--at-warning-border)', 'var(--at-warning-strong)')}>
                  ⚠️ Encontré algo
                </button>
                <button onClick={() => onOmitir(actual)} disabled={guardando}
                  style={boton('var(--at-accent-tint-2)', 'var(--at-accent-soft-2)', 'var(--at-accent-hover)')}>
                  ⏭ Omitir
                </button>
                <button onClick={() => onListo(actual)} disabled={guardando}
                  style={{ ...boton('var(--at-success)', 'var(--at-success)', 'var(--at-on-status)'), flex: '1 1 220px', maxWidth: '320px', fontWeight: 700 }}>
                  {guardando ? 'Guardando…' : '✓ Listo · Siguiente ›'}
                </button>
              </>
            ) : (
              <button onClick={() => onIr(i + 1 < tareas.length ? tareas[i + 1].id : null)} disabled={guardando}
                style={boton('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary)')}>
                {i + 1 < tareas.length ? 'Siguiente ›' : 'Ver resumen ›'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
