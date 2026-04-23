import { useState, useMemo } from 'react'
import { Encuesta, RespuestaEncuesta } from '../../../types'

interface Props {
  encuestas: Encuesta[]
  respuestas: RespuestaEncuesta[]
}

const ESTADO_CFG: Record<string, { color: string; bg: string; label: string }> = {
  borrador: { color: '#64748b', bg: '#f8fafc',  label: 'Borrador' },
  activa:   { color: '#16a34a', bg: '#dcfce7',  label: 'Activa' },
  cerrada:  { color: '#ef4444', bg: '#fef2f2',  label: 'Cerrada' },
}

export default function EncuestaDashboardTab({ encuestas, respuestas }: Props) {
  const [encuestaId, setEncuestaId] = useState(encuestas[0]?.id ?? '')

  const encuesta = encuestas.find(e => e.id === encuestaId)

  const rsEnc = useMemo(() =>
    respuestas.filter(r => r.encuesta_id === encuestaId)
  , [respuestas, encuestaId])

  const unidadesRespondentes = useMemo(() =>
    [...new Set(rsEnc.filter(r => r.unidad_id).map(r => r.unidad_id!))]
  , [rsEnc])

  const preguntas = useMemo(() => {
    if (!encuesta) return []
    try { return Array.isArray(encuesta.preguntas) ? encuesta.preguntas : [] }
    catch { return [] }
  }, [encuesta])

  // Agregados de respuestas por unidad (intentar parsear el JSON blob)
  const respuestasParsed = useMemo(() =>
    rsEnc.map(r => {
      let parsed: Record<string, unknown> = {}
      try { parsed = typeof r.respuestas === 'object' && r.respuestas !== null ? r.respuestas as Record<string, unknown> : {} }
      catch { parsed = {} }
      return { ...r, parsed }
    })
  , [rsEnc])

  // Por encuesta: tasa de respuesta (respuestas / total encuestas emitidas — no disponible, mostrar solo absolutos)
  const resumenEncuestas = useMemo(() =>
    encuestas.map(e => {
      const rs = respuestas.filter(r => r.encuesta_id === e.id)
      return { e, total: rs.length, unidades: new Set(rs.filter(r => r.unidad_id).map(r => r.unidad_id!)).size }
    }).sort((a, b) => b.total - a.total)
  , [encuestas, respuestas])

  const SEL = { padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, background: '#fff' }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>Dashboard de Encuestas</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
        {encuestas.length} encuesta{encuestas.length !== 1 ? 's' : ''} · {respuestas.length} respuestas totales
      </div>

      {encuestas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
          No hay encuestas creadas.
        </div>
      ) : (
        <>
          {/* Resumen de todas las encuestas */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>Todas las encuestas</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {resumenEncuestas.map(({ e, total, unidades }) => {
                const cfg = ESTADO_CFG[e.estado] ?? { color: '#374151', bg: '#f8fafc', label: e.estado }
                return (
                  <div key={e.id}
                    onClick={() => setEncuestaId(e.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px', background: encuestaId === e.id ? '#eff6ff' : '#f8fafc',
                      borderRadius: 8, border: `1px solid ${encuestaId === e.id ? '#bfdbfe' : '#e5e7eb'}`,
                      cursor: 'pointer' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{e.titulo}</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        {e.fecha_inicio && <span>📅 {e.fecha_inicio}</span>}
                        {e.fecha_fin && <span> → {e.fecha_fin}</span>}
                        {preguntas.length > 0 && e.id === encuestaId && <span> · {preguntas.length} preguntas</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#2563eb' }}>{total}</div>
                        <div style={{ fontSize: 10, color: '#6b7280' }}>respuestas</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#7c3aed' }}>{unidades}</div>
                        <div style={{ fontSize: 10, color: '#6b7280' }}>unidades</div>
                      </div>
                      <span style={{ padding: '3px 10px', borderRadius: 20, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700 }}>
                        {cfg.label}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detalle encuesta seleccionada */}
          {encuesta && (
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 10 }}>
                Detalle: {encuesta.titulo}
              </div>

              {encuesta.descripcion && (
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 12, padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
                  {encuesta.descripcion}
                </div>
              )}

              {/* KPIs */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                {[
                  { label: 'Respuestas', val: String(rsEnc.length), color: '#2563eb', bg: '#eff6ff' },
                  { label: 'Unidades respondentes', val: String(unidadesRespondentes.length), color: '#7c3aed', bg: '#f5f3ff' },
                  { label: 'Preguntas', val: String(preguntas.length), color: '#374151', bg: '#f8fafc' },
                  { label: 'Estado', val: ESTADO_CFG[encuesta.estado]?.label ?? encuesta.estado, color: ESTADO_CFG[encuesta.estado]?.color ?? '#374151', bg: ESTADO_CFG[encuesta.estado]?.bg ?? '#f8fafc' },
                ].map(k => (
                  <div key={k.label} style={{ flex: '1 1 110px', background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ fontSize: 10, color: '#6b7280' }}>{k.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: k.color, marginTop: 2 }}>{k.val}</div>
                  </div>
                ))}
              </div>

              {/* Lista de respuestas */}
              {respuestasParsed.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af', fontSize: 13 }}>
                  Esta encuesta aún no tiene respuestas.
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>Respuestas recibidas</span>
                    <select value={encuestaId} onChange={e => setEncuestaId(e.target.value)} style={{ ...SEL, fontSize: 11 }}>
                      {encuestas.map(e => <option key={e.id} value={e.id}>{e.titulo}</option>)}
                    </select>
                  </div>
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {respuestasParsed.map((r, i) => (
                      <div key={r.id} style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                            {r.unidad_nombre ?? r.nombre_respondente ?? `Respuesta #${i + 1}`}
                          </div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>{r.created_at.slice(0, 10)}</div>
                        </div>
                        {/* Mostrar respuestas como key-value si es objeto */}
                        {Object.keys(r.parsed).length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {Object.entries(r.parsed).slice(0, 8).map(([k, v]) => (
                              <span key={k} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20,
                                background: '#f1f5f9', color: '#374151' }}>
                                <strong>{k}:</strong> {String(v).slice(0, 40)}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>Sin detalle disponible</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
