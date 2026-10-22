import { useCallback, useEffect, useState } from 'react'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import {
  fetchAsambleasProyecto,
  fetchConteoVotosAsambleas,
  fetchPuntosByAsambleaIds,
  fetchVotosUnidad,
  type ConteoVotosPunto,
} from '../../../domain/condominios/tabQueries'
import { EmptyState } from '../../shared/EmptyState'
import { StatusBadge } from '../../shared/StatusBadge'
import { confirm, notify } from '../../shared/Dialog'
import type { Asamblea, EstadoAsamblea, PuntoAsamblea, TipoAsamblea, TipoPunto, TipoVoto, VotoAsamblea } from '../../../types'

// F3.12: Portal residente — vista de asambleas + votación.
// Antes: portal residente solo veía cuotas, tickets, paquetes.
// Ahora: ve asambleas programadas/en curso, lee el acta de las
// finalizadas, y el propietario vota en los puntos de votación.
//
// Cierra el gap B9 del design critique ("Portal residente subutilizado
// — solo lee cuotas y tickets. Sin votaciones de asamblea ni
// transparencia financiera").
//
// Son las asambleas CLÁSICAS (asambleas → puntos_asamblea → votos_asamblea),
// las mismas del tab Asambleas del panel: el voto del portal y el que registra
// el staff caen en el mismo conteo. Vota el PROPIETARIO, una vez por unidad y
// punto, sin poder cambiarlo; de las finalizadas el residente ve los totales,
// nunca el voto de otra unidad. La base exige lo mismo
// (20261104000050_asambleas_voto_residente).

interface Props {
  unidadId: string
  proyectoId: string
  /** auth.uid() de quien vota: firma el voto (registrado_por), la RLS lo exige. */
  userId: string
  /** Sólo el propietario vota por la unidad; inquilino y familiar la ven. */
  esPropietario: boolean
}

const ESTADO_LABELS: Record<EstadoAsamblea, { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  programada: { label: 'Programada', tone: 'info' },
  en_curso:   { label: 'En curso',   tone: 'warning' },
  finalizada: { label: 'Finalizada', tone: 'success' },
  cancelada:  { label: 'Cancelada',  tone: 'neutral' },
}

const TIPO_ASAMBLEA_LABELS: Record<TipoAsamblea, string> = {
  ordinaria:      'Ordinaria',
  extraordinaria: 'Extraordinaria',
}

const TIPO_PUNTO_LABELS: Record<TipoPunto, string> = {
  informativo: 'Informativo',
  votacion:    'Votación',
  debate:      'Debate',
}

const VOTO_LABELS: Record<TipoVoto, string> = {
  a_favor:    'A favor',
  en_contra:  'En contra',
  abstencion: 'Abstención',
}

function fechaAsamblea(a: Asamblea): string {
  const inicio = new Date(`${a.fecha}T${a.hora_inicio}`).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
  return a.hora_fin ? `${inicio} – ${a.hora_fin.slice(0, 5)}` : inicio
}

export function PortalAsambleasTab({ unidadId, proyectoId, userId, esPropietario }: Props) {
  const [asambleas, setAsambleas] = useState<Asamblea[]>([])
  const [puntos, setPuntos] = useState<Record<string, PuntoAsamblea[]>>({})
  const [misVotos, setMisVotos] = useState<Record<string, TipoVoto>>({})
  const [conteos, setConteos] = useState<Record<string, ConteoVotosPunto>>({})
  const [loading, setLoading] = useState(true)
  const [voting, setVoting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // `cargar` como useCallback (antes función suelta, recreada por render): el
  // efecto declara su dependencia real en vez de una lista paralela que había
  // que mantener a mano. `cancelado` evita que una respuesta de un proyecto ya
  // abandonado pise el estado del actual.
  const cargar = useCallback(async (estaCancelado: () => boolean = () => false) => {
    setLoading(true)
    const list = await fetchAsambleasProyecto<Asamblea>(proyectoId)
    if (estaCancelado()) return
    setAsambleas(list)

    const ids = list.map(a => a.id)
    const finalizadas = list.filter(a => a.estado === 'finalizada').map(a => a.id)
    const [pts, votos, totales] = ids.length === 0
      ? [[], [], []]
      : await Promise.all([
        fetchPuntosByAsambleaIds<PuntoAsamblea>(ids),
        // Votos previos de la unidad (la RLS sólo deja ver los de sus unidades).
        fetchVotosUnidad<Pick<VotoAsamblea, 'punto_id' | 'voto'>>(unidadId),
        fetchConteoVotosAsambleas(finalizadas),
      ])
    if (estaCancelado()) return
    const byAsamblea: Record<string, PuntoAsamblea[]> = {}
    pts.forEach(p => { (byAsamblea[p.asamblea_id] ??= []).push(p) })
    setPuntos(byAsamblea)
    setMisVotos(Object.fromEntries(votos.map(v => [v.punto_id, v.voto])))
    setConteos(Object.fromEntries(totales.map(c => [c.punto_id, c])))
    setLoading(false)
  }, [proyectoId, unidadId])

  useEffect(() => {
    let cancelado = false
    void cargar(() => cancelado)
    return () => { cancelado = true }
  }, [cargar])

  async function votar(punto: PuntoAsamblea, voto: TipoVoto) {
    if (misVotos[punto.id]) {
      notify({ variant: 'warning', title: 'Tu unidad ya votó', text: 'Ya hay un voto registrado para tu unidad en este punto.' })
      return
    }
    const r = await confirm({
      title: `¿Votar «${VOTO_LABELS[voto]}»?`,
      text: `${punto.titulo}. El voto de tu unidad no se puede cambiar después.`,
      icon: 'question',
      confirmText: 'Votar',
    })
    if (!r.isConfirmed) return
    setVoting(punto.id)
    const { error } = await createCondominioRow('votos_asamblea', {
      punto_id: punto.id,
      unidad_id: unidadId,
      voto,
      registrado_por: userId,
    })
    setVoting(null)
    if (error) {
      // 23505: la unidad ya tenía voto (otro propietario o el staff, desde otra
      // pantalla). 42501: la RLS lo rechazó, p. ej. la asamblea ya no está en
      // curso. En los dos casos lo que se ve está viejo: se recarga.
      if (error.code === '23505') {
        notify({ variant: 'warning', title: 'Tu unidad ya votó', text: 'Ya hay un voto registrado para tu unidad en este punto.' })
        void cargar()
        return
      }
      if (error.code === '42501') {
        notify({ variant: 'error', title: 'No se registró el voto', text: 'La votación ya no está abierta o no puedes votar por esta unidad.' })
        void cargar()
        return
      }
      notify({ variant: 'error', title: 'No se registró el voto', text: error.message })
      return
    }
    setMisVotos(prev => ({ ...prev, [punto.id]: voto }))
    notify({ variant: 'success', title: 'Voto registrado', text: `Tu voto fue: ${VOTO_LABELS[voto]}`, duration: 1800 })
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando asambleas…</div>
  }

  if (asambleas.length === 0) {
    return (
      <EmptyState
        icon="🏛️"
        title="No hay asambleas registradas"
        description="Cuando la administración convoque una asamblea, podrás verla aquí. El propietario de la unidad vota en sus puntos de votación."
      />
    )
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
          🏛️ Asambleas
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Programadas, en curso y finalizadas. El propietario de la unidad vota en los puntos de votación mientras la asamblea está en curso.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {asambleas.map(a => {
          const isExpanded = expanded === a.id
          const asambleaPuntos = puntos[a.id] ?? []
          return (
            <article
              key={a.id}
              style={{
                background: 'var(--at-surface)',
                border: '1.5px solid var(--at-line)',
                borderRadius: '14px',
                padding: '16px 18px',
              }}
            >
              <header
                onClick={() => setExpanded(isExpanded ? null : a.id)}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>{a.titulo}</h3>
                    <StatusBadge tone={ESTADO_LABELS[a.estado].tone}>{ESTADO_LABELS[a.estado].label}</StatusBadge>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
                    {TIPO_ASAMBLEA_LABELS[a.tipo] ?? a.tipo} · {fechaAsamblea(a)}
                    {a.lugar && <> · 📍 {a.lugar}</>}
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? 'Ocultar puntos' : 'Ver puntos'}
                  style={{
                    background: 'var(--at-chip)', border: 'none', borderRadius: '8px',
                    padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)',
                  }}
                >
                  {isExpanded ? '▲' : '▼'} {asambleaPuntos.length} {asambleaPuntos.length === 1 ? 'punto' : 'puntos'}
                </button>
              </header>

              {isExpanded && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--at-line)' }}>
                  {a.acta && a.estado === 'finalizada' && (
                    <details style={{ margin: '0 0 10px', fontSize: '13px' }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--at-primary)', fontWeight: 600 }}>📜 Ver acta</summary>
                      <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: 'var(--at-ink-2)' }}>{a.acta}</p>
                    </details>
                  )}
                  {asambleaPuntos.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>Sin puntos en el orden del día.</p>
                  ) : (
                    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {asambleaPuntos.map(p => {
                        const miVoto = misVotos[p.id]
                        const conteo = conteos[p.id]
                        return (
                          <li key={p.id} style={{
                            background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px 14px',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                              <div>
                                <strong style={{ fontSize: '13px' }}>{p.orden}. {p.titulo}</strong>
                                {p.descripcion && (
                                  <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>{p.descripcion}</p>
                                )}
                              </div>
                              <span style={{
                                fontSize: '10px', fontWeight: 700,
                                padding: '2px 8px', borderRadius: '20px',
                                background: p.tipo === 'votacion' ? 'var(--at-warning-tint)' : 'var(--at-chip)',
                                color: p.tipo === 'votacion' ? 'var(--at-warning-strong)' : 'var(--at-ink-3)',
                                flexShrink: 0,
                              }}>
                                {TIPO_PUNTO_LABELS[p.tipo] ?? p.tipo}
                              </span>
                            </div>

                            {/* Voto de la unidad */}
                            {p.tipo === 'votacion' && a.estado === 'en_curso' && (
                              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                                {miVoto ? (
                                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-success)' }}>
                                    ✓ Tu unidad votó: {VOTO_LABELS[miVoto] ?? miVoto}
                                  </span>
                                ) : esPropietario ? (
                                  <>
                                    <button
                                      onClick={() => votar(p, 'a_favor')}
                                      disabled={voting === p.id}
                                      aria-label={`A favor: ${p.titulo}`}
                                      style={{ ...btnVoto, background: 'var(--at-success-tint)', color: 'var(--at-success-strong)' }}
                                    >
                                      👍 A favor
                                    </button>
                                    <button
                                      onClick={() => votar(p, 'en_contra')}
                                      disabled={voting === p.id}
                                      aria-label={`En contra: ${p.titulo}`}
                                      style={{ ...btnVoto, background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)' }}
                                    >
                                      👎 En contra
                                    </button>
                                    <button
                                      onClick={() => votar(p, 'abstencion')}
                                      disabled={voting === p.id}
                                      aria-label={`Abstención: ${p.titulo}`}
                                      style={{ ...btnVoto, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}
                                    >
                                      ⊘ Abstención
                                    </button>
                                  </>
                                ) : (
                                  <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                                    Vota el propietario de la unidad.
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Resultado (asamblea finalizada): totales, nunca el voto de cada unidad */}
                            {a.estado === 'finalizada' && p.tipo === 'votacion' && (conteo || miVoto || p.resultado) && (
                              <div style={{ marginTop: '8px', fontSize: '12px', display: 'flex', gap: '14px', flexWrap: 'wrap', color: 'var(--at-ink-3)' }}>
                                {conteo && (
                                  <>
                                    <span title="A favor">👍 {conteo.a_favor}</span>
                                    <span title="En contra">👎 {conteo.en_contra}</span>
                                    <span title="Abstención">⊘ {conteo.abstencion}</span>
                                  </>
                                )}
                                {miVoto && <span>Tu unidad: {VOTO_LABELS[miVoto] ?? miVoto}</span>}
                                {p.resultado && (
                                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--at-ink)' }}>
                                    → {p.resultado}
                                  </span>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

const btnVoto: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: '20px',
  border: 'none',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer',
}
