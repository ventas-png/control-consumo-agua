import { useCallback, useEffect, useState } from 'react'
import { fetchAsambleasUnidad, votarPunto } from '../../../domain/portal/asambleas'
import { EmptyState } from '../../shared/EmptyState'
import { StatusBadge } from '../../shared/StatusBadge'
import { confirm, notify } from '../../shared/Dialog'
import type { AsambleaPortal, EstadoAsamblea, PuntoAsambleaPortal, TipoVoto } from '../../../types'

// F3.12: Portal residente — vista de asambleas + votación.
//
// Son las asambleas CLÁSICAS (asambleas + puntos_asamblea + votos_asamblea),
// las mismas que el tab «Asambleas» del panel: un solo registro de votos, con
// el vocabulario del panel ('a_favor' | 'en_contra' | 'abstencion').
// Todo pasa por los RPC de 20261105000000, que deciden server-side:
//   · sólo el propietario de la unidad lee y vota (tabsForRol ya esconde el
//     tab al inquilino);
//   · se vota en puntos de votación con la asamblea en curso, una vez por
//     unidad: el voto es definitivo desde el portal;
//   · los totales y el acta salen con la asamblea finalizada.

interface Props {
  unidadId: string
}

const ESTADO_LABELS: Record<EstadoAsamblea, { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  programada: { label: 'Programada', tone: 'info' },
  en_curso:   { label: 'En curso',   tone: 'warning' },
  finalizada: { label: 'Finalizada', tone: 'success' },
  cancelada:  { label: 'Cancelada',  tone: 'neutral' },
}

const VOTO_LABELS: Record<TipoVoto, string> = {
  a_favor:    'A favor',
  en_contra:  'En contra',
  abstencion: 'Abstención',
}

const TIPO_PUNTO_LABELS: Record<PuntoAsambleaPortal['tipo'], string> = {
  informativo: 'Informativo',
  votacion:    'Votación',
  debate:      'Debate',
}

function fechaAsamblea(a: AsambleaPortal): string {
  const d = new Date(`${a.fecha}T${a.hora_inicio}`)
  return Number.isNaN(d.getTime())
    ? a.fecha
    : d.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
}

export function PortalAsambleasTab({ unidadId }: Props) {
  const [asambleas, setAsambleas] = useState<AsambleaPortal[]>([])
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [voting, setVoting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  // `cancelado` evita que la respuesta de una unidad ya abandonada pise el
  // estado de la actual (los votos son por unidad).
  const cargar = useCallback(async (estaCancelado: () => boolean = () => false) => {
    setLoading(true)
    const { data, error } = await fetchAsambleasUnidad(unidadId)
    if (estaCancelado()) return
    setAsambleas(data)
    setErrorCarga(error)
    // Se conserva la que estaba abierta si sigue en la lista (recarga tras un
    // voto); si no (otra unidad), se abre la asamblea en curso: es donde hay
    // algo que hacer.
    setExpanded(prev => (prev && data.some(a => a.id === prev) ? prev : data.find(a => a.estado === 'en_curso')?.id ?? null))
    setLoading(false)
  }, [unidadId])

  useEffect(() => {
    let cancelado = false
    void cargar(() => cancelado)
    return () => { cancelado = true }
  }, [cargar])

  async function votar(punto: PuntoAsambleaPortal, voto: TipoVoto) {
    const r = await confirm({
      title: `¿Votar «${VOTO_LABELS[voto]}»?`,
      text: `Punto: ${punto.titulo}. El voto es por unidad y no se puede cambiar desde el portal.`,
      confirmText: 'Votar',
      icon: 'question',
    })
    if (!r.isConfirmed) return
    setVoting(punto.id)
    const { error, yaVotado } = await votarPunto(punto.id, unidadId, voto)
    setVoting(null)
    if (yaVotado) {
      notify({ variant: 'warning', title: 'Ya votaste', text: 'Esta unidad ya tiene un voto registrado en este punto.' })
      void cargar()
      return
    }
    if (error) {
      notify({ variant: 'error', title: 'No se registró el voto', text: error })
      return
    }
    setAsambleas(prev => prev.map(a => ({
      ...a,
      puntos: a.puntos.map(p => (p.id === punto.id ? { ...p, mi_voto: voto } : p)),
    })))
    notify({ variant: 'success', title: 'Voto registrado', text: `Tu voto fue: ${VOTO_LABELS[voto]}`, duration: 1800 })
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando asambleas…</div>
  }

  if (errorCarga) {
    return (
      <EmptyState
        audience="resident"
        icon="⚠️"
        title="No se pudieron cargar las asambleas"
        description={errorCarga}
        action={<button type="button" onClick={() => void cargar()} style={btnReintentar}>Reintentar</button>}
      />
    )
  }

  if (asambleas.length === 0) {
    return (
      <EmptyState
        audience="resident"
        icon="🏛️"
        title="No hay asambleas registradas"
        description="Cuando la administración convoque una asamblea, podrás verla aquí y votar en los puntos de votación mientras esté en curso."
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
          Programadas, en curso y finalizadas. Vota por tu unidad en los puntos de votación mientras la asamblea está en curso.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {asambleas.map(a => {
          const isExpanded = expanded === a.id
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
                    {fechaAsamblea(a)} · {a.tipo === 'extraordinaria' ? 'Extraordinaria' : 'Ordinaria'}
                    {a.lugar && <> · 📍 {a.lugar}</>}
                  </p>
                </div>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? `Ocultar puntos de ${a.titulo}` : `Ver puntos de ${a.titulo}`}
                  style={{
                    background: 'var(--at-chip)', border: 'none', borderRadius: '8px',
                    padding: '6px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)',
                  }}
                >
                  {isExpanded ? '▲' : '▼'} {a.puntos.length} {a.puntos.length === 1 ? 'punto' : 'puntos'}
                </button>
              </header>

              {isExpanded && (
                <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--at-line)' }}>
                  {a.puntos.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>Sin puntos en el orden del día.</p>
                  ) : (
                    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {a.puntos.map(p => (
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

                          {p.tipo === 'votacion' && p.mi_voto && (
                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-success)' }}>
                              ✓ Tu unidad votó: {VOTO_LABELS[p.mi_voto]}
                            </span>
                          )}

                          {/* Voto del propietario: sólo con la asamblea en curso */}
                          {p.tipo === 'votacion' && a.estado === 'en_curso' && !p.mi_voto && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                onClick={() => votar(p, 'a_favor')}
                                disabled={voting === p.id}
                                style={{ ...btnVoto, background: 'var(--at-success-tint)', color: 'var(--at-success-strong)' }}
                              >
                                👍 A favor
                              </button>
                              <button
                                type="button"
                                onClick={() => votar(p, 'en_contra')}
                                disabled={voting === p.id}
                                style={{ ...btnVoto, background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)' }}
                              >
                                👎 En contra
                              </button>
                              <button
                                type="button"
                                onClick={() => votar(p, 'abstencion')}
                                disabled={voting === p.id}
                                style={{ ...btnVoto, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}
                              >
                                ⊘ Abstención
                              </button>
                            </div>
                          )}

                          {/* Resultado (asamblea finalizada): totales, nunca votos de otras unidades */}
                          {p.conteo && (
                            <div
                              aria-label={`Resultado de ${p.titulo}`}
                              style={{ marginTop: '8px', fontSize: '12px', display: 'flex', gap: '14px', color: 'var(--at-ink-3)' }}
                            >
                              <span>👍 {p.conteo.a_favor}</span>
                              <span>👎 {p.conteo.en_contra}</span>
                              <span>⊘ {p.conteo.abstencion}</span>
                              {p.resultado && (
                                <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--at-ink)' }}>
                                  → {p.resultado}
                                </span>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}

                  {a.acta && (
                    <details style={{ marginTop: '12px', fontSize: '13px' }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--at-primary)' }}>📜 Acta</summary>
                      <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', color: 'var(--at-ink-2)' }}>{a.acta}</p>
                    </details>
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

const btnReintentar: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '8px',
  border: '1.5px solid var(--at-line)',
  background: 'var(--at-surface)',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
}
