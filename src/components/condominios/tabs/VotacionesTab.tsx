import { useState, useEffect, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { fetchVotosVotacion } from '../../../domain/condominios/tabQueries'
import type { Votacion, Voto, Unidad, Asamblea, TipoVotacion } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  votaciones: Votacion[]
  unidades: Unidad[]
  asambleas: Asamblea[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface FormState {
  titulo: string; descripcion: string; tipo: TipoVotacion
  opciones: { id: string; texto: string }[]
  quorum_requerido: number; fecha_cierre: string; asamblea_id: string
}
const BLANK: FormState = {
  titulo: '', descripcion: '', tipo: 'simple',
  opciones: [{ id: '1', texto: '' }, { id: '2', texto: '' }],
  quorum_requerido: 0, fecha_cierre: '', asamblea_id: '',
}

const ESTADO_COLORS: Record<string, { bg: string; color: string }> = {
  abierta: { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  cerrada: { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
  anulada: { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' },
}

export function VotacionesTab({ votaciones, unidades, asambleas, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [votos, setVotos] = useState<Voto[]>([])
  const [loadingVotos, setLoadingVotos] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selUnidad, setSelUnidad] = useState('')
  const [selOpcion, setSelOpcion] = useState('')
  const [registering, setRegistering] = useState(false)

  const votacion = votaciones.find(v => v.id === selected)

  useEffect(() => {
    if (!selected) return
    setLoadingVotos(true)
    void fetchVotosVotacion(selected).then(data => {
      setVotos(data.map((r: Record<string, unknown>) => ({
        ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre,
      } as Voto)))
      setLoadingVotos(false)
    })
  }, [selected])

  async function handleSave() {
    if (!form.titulo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El título es obligatorio.' })
    if (form.opciones.some(o => !o.texto.trim())) return notify({ variant: 'warning', title: 'Requerido', text: 'Completa todas las opciones.' })
    setSaving(true)
    const { error } = await createCondominioRow('votaciones', {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), descripcion: form.descripcion || null,
      tipo: form.tipo, opciones: form.opciones.map(o => ({ id: o.id, texto: o.texto.trim() })),
      quorum_requerido: form.quorum_requerido || null,
      total_unidades: unidades.length,
      fecha_cierre: form.fecha_cierre || null,
      asamblea_id: form.asamblea_id || null,
      estado: 'abierta',
    })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function handleVotar() {
    if (!selected || !selUnidad || !selOpcion) return notify({ variant: 'warning', title: 'Requerido', text: 'Selecciona unidad y opción.' })
    if (votos.some(v => v.unidad_id === selUnidad)) return notify({ variant: 'info', title: 'Ya votó', text: 'Esta unidad ya registró su voto.' })
    setRegistering(true)
    const { error } = await createCondominioRow('votos', { company_id: companyId, votacion_id: selected, unidad_id: selUnidad, opcion_id: selOpcion })
    setRegistering(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setSelUnidad(''); setSelOpcion('')
    const data = await fetchVotosVotacion(selected)
    setVotos(data.map((r: Record<string, unknown>) => ({ ...r, unidad_nombre: (r.unidades as { nombre: string } | null)?.nombre } as Voto)))
  }

  async function handleCerrar(id: string) {
    const r = await confirm({ title: '¿Cerrar votación?', text: 'No se podrán registrar más votos.', icon: 'warning', variant: 'danger', confirmText: 'Cerrar' })
    if (!r.isConfirmed) return
    const v = votaciones.find(x => x.id === id)
    const counts = (v?.opciones ?? []).map(o => ({ texto: o.texto, count: votos.filter(vt => vt.opcion_id === o.id).length }))
    const max = Math.max(...counts.map(c => c.count), 0)
    const winners = counts.filter(c => c.count === max && c.count > 0)
    const resultado = winners.length === 0 ? 'sin votos' : winners.length > 1 ? 'empate' : winners[0].texto.slice(0, 60)
    await updateCondominioRow('votaciones', id, { estado: 'cerrada', fecha_cierre: new Date().toISOString(), resultado })
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  const totalVotos = votos.length
  const counts = votacion ? votacion.opciones.map(o => ({ id: o.id, texto: o.texto, count: votos.filter(v => v.opcion_id === o.id).length })) : []
  const maxCount = Math.max(...counts.map(c => c.count), 1)

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Votaciones</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>Votaciones digitales vinculadas a asambleas</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Votación
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nueva Votación</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej: Aprobación del presupuesto 2026" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Asamblea (opcional)</label>
              <select style={inputStyle} value={form.asamblea_id} onChange={e => setForm(f => ({ ...f, asamblea_id: e.target.value }))}>
                <option value="">— Ninguna —</option>
                {asambleas.map(a => <option key={a.id} value={a.id}>{a.titulo} ({a.fecha})</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as 'simple' | 'multiple' | 'ponderada' }))}>
                <option value="simple">Simple (1 opción)</option>
                <option value="multiple">Múltiple</option>
                <option value="ponderada">Ponderada</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Quórum mínimo</label>
              <input style={inputStyle} type="number" min="0" value={form.quorum_requerido} onChange={e => setForm(f => ({ ...f, quorum_requerido: parseInt(e.target.value) || 0 }))} placeholder="0 = sin mínimo" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha de cierre</label>
              <input style={inputStyle} type="datetime-local" value={form.fecha_cierre} onChange={e => setForm(f => ({ ...f, fecha_cierre: e.target.value }))} />
            </div>
          </div>
          <div style={{ marginTop: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '6px' }}>Opciones de voto *</label>
            {form.opciones.map((op, i) => (
              <div key={op.id} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <input style={{ ...inputStyle, flex: 1 }} value={op.texto}
                  onChange={e => setForm(f => ({ ...f, opciones: f.opciones.map((o, j) => j === i ? { ...o, texto: e.target.value } : o) }))}
                  placeholder={`Opción ${i + 1}`} />
                {form.opciones.length > 2 && (
                  <button onClick={() => setForm(f => ({ ...f, opciones: f.opciones.filter((_, j) => j !== i) }))}
                    style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>✕</button>
                )}
              </div>
            ))}
            <button onClick={() => setForm(f => ({ ...f, opciones: [...f.opciones, { id: String(Date.now()), texto: '' }] }))}
              style={{ padding: '5px 12px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>
              + Agregar opción
            </button>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Crear Votación'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: votacion ? '300px 1fr' : '1fr', gap: '16px' }}>
        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {votaciones.length === 0 ? (
            <EmptyState icon="📋" title="No hay votaciones. Crea una para comenzar" />
          ) : (
            votaciones.map(v => {
              const ec = ESTADO_COLORS[v.estado] ?? { bg: 'var(--at-chip)', color: 'var(--at-ink-3)' }
              return (
                <div key={v.id} onClick={() => setSelected(selected === v.id ? null : v.id)}
                  style={{ background: selected === v.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', border: `1.5px solid ${selected === v.id ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)', marginBottom: '2px' }}>{v.titulo}</div>
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{v.fecha_inicio.slice(0, 10)} · {v.opciones.length} opciones</div>
                      {v.resultado && <div style={{ fontSize: '11px', color: 'var(--at-primary-hover)', fontWeight: 600, marginTop: '2px' }}>→ {v.resultado}</div>}
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ec.bg, color: ec.color, flexShrink: 0 }}>
                      {v.estado}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Detail */}
        {votacion && (
          <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', gap: '8px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 700 }}>{votacion.titulo}</h3>
                {votacion.descripcion && <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{votacion.descripcion}</p>}
              </div>
              {canEdit && votacion.estado === 'abierta' && (
                <button onClick={() => handleCerrar(votacion.id)}
                  style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                  Cerrar votación
                </button>
              )}
            </div>

            {/* Results */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                Resultados · {totalVotos} voto(s) de {votacion.total_unidades ?? unidades.length} unidades
                {votacion.quorum_requerido ? ` · Quórum: ${votacion.quorum_requerido}` : ''}
              </div>
              {loadingVotos ? (
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Cargando votos…</div>
              ) : (
                counts.map(c => (
                  <div key={c.id} style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '3px' }}>
                      <span style={{ fontWeight: 600 }}>{c.texto}</span>
                      <span style={{ color: 'var(--at-ink-3)' }}>{c.count} · {totalVotos > 0 ? Math.round(c.count / totalVotos * 100) : 0}%</span>
                    </div>
                    <div style={{ height: '8px', background: 'var(--at-chip)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: '4px', transition: 'width 0.3s',
                        background: c.count === maxCount && c.count > 0 ? 'var(--at-success)' : 'var(--at-primary)',
                        width: `${totalVotos > 0 ? c.count / totalVotos * 100 : 0}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Register vote */}
            {canCreate && votacion.estado === 'abierta' && (
              <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '8px' }}>Registrar voto</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad</label>
                    <select style={inputStyle} value={selUnidad} onChange={e => setSelUnidad(e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {unidades.filter(u => !votos.some(v => v.unidad_id === u.id)).map(u => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Opción</label>
                    <select style={inputStyle} value={selOpcion} onChange={e => setSelOpcion(e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {votacion.opciones.map(o => <option key={o.id} value={o.id}>{o.texto}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={handleVotar} disabled={registering || !selUnidad || !selOpcion}
                  style={{ padding: '6px 16px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  {registering ? '…' : 'Registrar voto'}
                </button>
              </div>
            )}

            {/* Votes log */}
            {votos.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Registro</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {votos.map(v => {
                    const op = votacion.opciones.find(o => o.id === v.opcion_id)
                    return (
                      <div key={v.id} style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px' }}>
                        <span style={{ fontWeight: 600 }}>{v.unidad_nombre ?? v.unidad_id.slice(0, 6)}</span>
                        <span style={{ color: 'var(--at-ink-3)', marginLeft: '4px' }}>→ {op?.texto ?? v.opcion_id}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {votacion.resultado && votacion.estado === 'cerrada' && (
              <div style={{ marginTop: '12px', background: 'var(--at-success-tint)', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: 'var(--at-success)', fontWeight: 600 }}>
                ✓ Resultado: {votacion.resultado}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
