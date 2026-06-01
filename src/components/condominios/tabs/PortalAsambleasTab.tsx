import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { EmptyState } from '../../shared/EmptyState'
import { StatusBadge } from '../../shared/StatusBadge'
import { notify } from '../../shared/Dialog'
import type { AsambleaDigital } from '../../../types'

// F3.12: Portal residente — vista de asambleas + votación.
// Antes: portal residente solo veía cuotas, tickets, paquetes.
// Ahora: ve asambleas programadas/en curso, descarga acta de las
// finalizadas, y puede votar en puntos de aprobación.
//
// Cierra el gap B9 del design critique ("Portal residente subutilizado
// — solo lee cuotas y tickets. Sin votaciones de asamblea ni
// transparencia financiera").

interface PuntoAsamblea2 {
  id: string
  asamblea_id: string
  orden: number
  titulo: string
  descripcion?: string | null
  tipo: 'informativo' | 'aprobacion' | 'eleccion'
  resultado?: string | null
  votos_favor: number
  votos_contra: number
  votos_abstencion: number
}

interface VotoUnidad {
  punto_id: string
  voto: 'favor' | 'contra' | 'abstencion'
}

interface Props {
  unidadId: string
  proyectoId: string
}

const ESTADO_LABELS: Record<AsambleaDigital['estado'], { label: string; tone: 'info' | 'success' | 'warning' | 'neutral' }> = {
  programada: { label: 'Programada', tone: 'info' },
  en_curso:   { label: 'En curso',   tone: 'warning' },
  finalizada: { label: 'Finalizada', tone: 'success' },
  cancelada:  { label: 'Cancelada',  tone: 'neutral' },
}

const MODALIDAD_LABELS = {
  presencial: '🏛️ Presencial',
  virtual:    '💻 Virtual',
  hibrida:    '🔀 Híbrida',
}

export function PortalAsambleasTab({ unidadId, proyectoId }: Props) {
  const [asambleas, setAsambleas] = useState<AsambleaDigital[]>([])
  const [puntos, setPuntos] = useState<Record<string, PuntoAsamblea2[]>>({})
  const [misVotos, setMisVotos] = useState<Record<string, VotoUnidad['voto']>>({})
  const [loading, setLoading] = useState(true)
  const [voting, setVoting] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    void cargar()
  }, [proyectoId, unidadId])

  async function cargar() {
    setLoading(true)
    const { data: asambs } = await supabase
      .from('asambleas_digital')
      .select('*')
      .eq('project_id', proyectoId)
      .order('fecha_hora', { ascending: false })
      .limit(20)
    const list = (asambs as AsambleaDigital[]) ?? []
    setAsambleas(list)

    if (list.length > 0) {
      const ids = list.map(a => a.id)
      const { data: pts } = await supabase
        .from('puntos_asamblea')
        .select('*')
        .in('asamblea_id', ids)
        .order('orden')
      const byAsamblea: Record<string, PuntoAsamblea2[]> = {}
      ;(pts as PuntoAsamblea2[] ?? []).forEach(p => {
        if (!byAsamblea[p.asamblea_id]) byAsamblea[p.asamblea_id] = []
        byAsamblea[p.asamblea_id].push(p)
      })
      setPuntos(byAsamblea)

      // Cargar votos previos del residente
      const { data: votos } = await supabase
        .from('votos_asamblea')
        .select('punto_id, voto')
        .eq('unidad_id', unidadId)
      const votosMap: Record<string, VotoUnidad['voto']> = {}
      ;(votos as VotoUnidad[] ?? []).forEach(v => { votosMap[v.punto_id] = v.voto })
      setMisVotos(votosMap)
    }
    setLoading(false)
  }

  async function votar(punto: PuntoAsamblea2, voto: VotoUnidad['voto']) {
    if (misVotos[punto.id]) {
      notify({ variant: 'warning', title: 'Ya votaste', text: 'Ya emitiste tu voto en este punto.' })
      return
    }
    setVoting(punto.id)
    const { error } = await supabase.from('votos_asamblea').insert({
      punto_id: punto.id,
      asamblea_id: punto.asamblea_id,
      unidad_id: unidadId,
      voto,
    })
    setVoting(null)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.message })
      return
    }
    setMisVotos(prev => ({ ...prev, [punto.id]: voto }))
    notify({ variant: 'success', title: 'Voto registrado', text: `Tu voto fue: ${voto === 'favor' ? 'A favor' : voto === 'contra' ? 'En contra' : 'Abstención'}`, duration: 1800 })
  }

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando asambleas…</div>
  }

  if (asambleas.length === 0) {
    return (
      <EmptyState
        icon="🏛️"
        title="No hay asambleas registradas"
        description="Cuando la administración programe una asamblea, podrás verla aquí y votar en los puntos de aprobación."
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
          Programadas, en curso y finalizadas. Vota en los puntos de aprobación cuando la asamblea esté activa.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {asambleas.map(a => {
          const isExpanded = expanded === a.id
          const asambleaPuntos = puntos[a.id] ?? []
          const fechaFmt = new Date(a.fecha_hora).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
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
                    {fechaFmt} · {MODALIDAD_LABELS[a.modalidad]}
                    {a.link_reunion && a.estado !== 'finalizada' && (
                      <> · <a href={a.link_reunion} target="_blank" rel="noopener" style={{ color: 'var(--at-primary)', textDecoration: 'none', fontWeight: 600 }}>🔗 Unirse</a></>
                    )}
                  </p>
                  {a.descripcion && (
                    <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--at-ink-2)' }}>{a.descripcion}</p>
                  )}
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
                  {a.acta_url && a.estado === 'finalizada' && (
                    <p style={{ margin: '0 0 10px', fontSize: '13px' }}>
                      📜 <a href={a.acta_url} target="_blank" rel="noopener" style={{ color: 'var(--at-primary)', fontWeight: 600 }}>Descargar acta</a>
                    </p>
                  )}
                  {asambleaPuntos.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>Sin puntos en el orden del día.</p>
                  ) : (
                    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {asambleaPuntos.map(p => (
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
                              background: p.tipo === 'aprobacion' ? 'var(--at-warning-tint)' : 'var(--at-chip)',
                              color: p.tipo === 'aprobacion' ? 'var(--at-warning-strong)' : 'var(--at-ink-3)',
                              flexShrink: 0,
                            }}>
                              {p.tipo}
                            </span>
                          </div>

                          {/* Voto del residente */}
                          {p.tipo === 'aprobacion' && a.estado === 'en_curso' && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                              {misVotos[p.id] ? (
                                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-success)' }}>
                                  ✓ Votaste: {misVotos[p.id] === 'favor' ? 'A favor' : misVotos[p.id] === 'contra' ? 'En contra' : 'Abstención'}
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => votar(p, 'favor')}
                                    disabled={voting === p.id}
                                    style={{ ...btnVoto, background: 'var(--at-success-tint)', color: 'var(--at-success-strong)' }}
                                  >
                                    👍 A favor
                                  </button>
                                  <button
                                    onClick={() => votar(p, 'contra')}
                                    disabled={voting === p.id}
                                    style={{ ...btnVoto, background: 'var(--at-danger-tint)', color: 'var(--at-danger-strong)' }}
                                  >
                                    👎 En contra
                                  </button>
                                  <button
                                    onClick={() => votar(p, 'abstencion')}
                                    disabled={voting === p.id}
                                    style={{ ...btnVoto, background: 'var(--at-chip)', color: 'var(--at-ink-3)' }}
                                  >
                                    ⊘ Abstención
                                  </button>
                                </>
                              )}
                            </div>
                          )}

                          {/* Resultado (asamblea finalizada) */}
                          {a.estado === 'finalizada' && p.tipo === 'aprobacion' && (
                            <div style={{ marginTop: '8px', fontSize: '12px', display: 'flex', gap: '14px', color: 'var(--at-ink-3)' }}>
                              <span>👍 {p.votos_favor}</span>
                              <span>👎 {p.votos_contra}</span>
                              <span>⊘ {p.votos_abstencion}</span>
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
