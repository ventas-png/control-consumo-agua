import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ReclamoCondominio } from '../../../types'
import type { Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  reclamos: ReclamoCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  queja:          { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Queja',           icon: '😤' },
  sugerencia:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Sugerencia',      icon: '💡' },
  reclamo_formal: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Reclamo Formal',  icon: '📋' },
  apelacion:      { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Apelación',       icon: '⚖️' },
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  recibido:    { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Recibido' },
  en_revision: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'En revisión' },
  respondido:  { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Respondido' },
  cerrado:     { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Cerrado' },
  escalado:    { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Escalado' },
}

const PRIORIDAD_STYLE: Record<string, { color: string; label: string }> = {
  baja:    { color: 'var(--at-ink-3)', label: 'Baja' },
  normal:  { color: 'var(--at-primary)', label: 'Normal' },
  alta:    { color: 'var(--at-warning)', label: 'Alta' },
  urgente: { color: 'var(--at-danger)', label: 'Urgente' },
}

const BLANK = { unidad_id: '', tipo: 'queja', asunto: '', descripcion: '', prioridad: 'normal', plazo_respuesta: '', anonimo: false }
const BLANK_RESP = { respuesta_admin: '', respondido_por: '' }

export function ReclamosTab({ reclamos, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ReclamoCondominio | null>(null)
  const [showRespForm, setShowRespForm] = useState(false)
  const [formResp, setFormResp] = useState({ ...BLANK_RESP })
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'recibido' | 'en_revision' | 'respondido' | 'cerrado' | 'escalado'>('todos')
  const [filtroTipo, setFiltroTipo] = useState('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
  function setFR<K extends keyof typeof formResp>(k: K, v: typeof formResp[K]) { setFormResp(p => ({ ...p, [k]: v })) }

  function startEdit(r: ReclamoCondominio) {
    setEditId(r.id)
    setForm({ unidad_id: r.unidad_id ?? '', tipo: r.tipo, asunto: r.asunto, descripcion: r.descripcion ?? '', prioridad: r.prioridad, plazo_respuesta: r.plazo_respuesta ?? '', anonimo: r.anonimo })
    setShowForm(true)
    setSelected(null)
  }

  async function handleSave() {
    if (!form.asunto.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El asunto es obligatorio.' })
    setSaving(true)
    const payload = {
      unidad_id: form.unidad_id || null, tipo: form.tipo, asunto: form.asunto.trim(),
      descripcion: form.descripcion || null, prioridad: form.prioridad,
      plazo_respuesta: form.plazo_respuesta || null, anonimo: form.anonimo,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('reclamos_condominio', editId, payload))
    } else {
      ({ error } = await createCondominioRow('reclamos_condominio', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar reclamo?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('reclamos_condominio', id)
    if (selected?.id === id) setSelected(null)
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await updateCondominioRow('reclamos_condominio', id, { estado })
    onRefresh()
  }

  async function handleResponder() {
    if (!selected) return
    if (!formResp.respuesta_admin.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'Escriba una respuesta.' })
    await updateCondominioRow('reclamos_condominio', selected.id, {
      respuesta_admin: formResp.respuesta_admin.trim(),
      respondido_por: formResp.respondido_por || null,
      fecha_respuesta: new Date().toISOString().slice(0, 10),
      estado: 'respondido',
    })
    setShowRespForm(false); setFormResp({ ...BLANK_RESP }); onRefresh()
  }

  let filtered = reclamos
  if (filtroEstado !== 'todos') filtered = filtered.filter(r => r.estado === filtroEstado)
  if (filtroTipo !== 'todos') filtered = filtered.filter(r => r.tipo === filtroTipo)

  const pendientes = reclamos.filter(r => r.estado === 'recibido' || r.estado === 'en_revision').length
  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Reclamos y Sugerencias</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{pendientes} pendiente(s) de respuesta</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(ESTADO_STYLE).map(([est, s]) => (
          <div key={est} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: s.color }}>{reclamos.filter(r => r.estado === est).length}</div>
            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar reclamo' : 'Nuevo Reclamo / Sugerencia'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad / General —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Prioridad</label>
              <select style={inputStyle} value={form.prioridad} onChange={e => setF('prioridad', e.target.value)}>
                {Object.entries(PRIORIDAD_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Plazo de respuesta</label>
              <input style={inputStyle} type="date" value={form.plazo_respuesta} onChange={e => setF('plazo_respuesta', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Asunto *</label>
              <input style={inputStyle} value={form.asunto} onChange={e => setF('asunto', e.target.value)} placeholder="Resumen del reclamo o sugerencia" autoFocus />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción</label>
              <textarea style={{ ...inputStyle, minHeight: '65px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalle del reclamo, contexto, evidencias…" />
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginTop: '8px' }}>
                <input type="checkbox" checked={form.anonimo} onChange={e => setF('anonimo', e.target.checked)} />
                Anónimo
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['todos', 'recibido', 'en_revision', 'respondido', 'cerrado', 'escalado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
        <select style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '11px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }}
          value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <EmptyState icon="📋" title="No hay reclamos registrados" />
          ) : filtered.map(r => {
            const ts = TIPO_STYLE[r.tipo] ?? TIPO_STYLE.queja
            const es = ESTADO_STYLE[r.estado] ?? ESTADO_STYLE.recibido
            const pr = PRIORIDAD_STYLE[r.prioridad] ?? PRIORIDAD_STYLE.normal
            const unidad = unidades.find(u => u.id === r.unidad_id)
            const today = new Date().toISOString().slice(0, 10)
            const vencido = (r.estado === 'recibido' || r.estado === 'en_revision') && r.plazo_respuesta && r.plazo_respuesta < today
            return (
              <div key={r.id} onClick={() => setSelected(selected?.id === r.id ? null : r)}
                style={{ background: 'var(--at-surface)', border: `1.5px solid ${vencido ? 'var(--at-danger-border)' : selected?.id === r.id ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px' }}>{ts.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{r.asunto}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: ts.bg, color: ts.color }}>{ts.label}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {!r.anonimo && unidad && <span>🏠 {unidad.nombre}</span>}
                      {r.anonimo && <span style={{ color: 'var(--at-ink-3)' }}>🔒 Anónimo</span>}
                      <span style={{ color: pr.color, fontWeight: 600 }}>● {pr.label}</span>
                      <span>📅 {r.created_at.slice(0, 10)}</span>
                      {r.plazo_respuesta && <span style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>⏰ Plazo: {r.plazo_respuesta}{vencido ? ' ⚠️' : ''}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {r.estado === 'recibido' && (
                        <button onClick={() => cambiarEstado(r.id, 'en_revision')}
                          style={{ padding: '3px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          En revisión
                        </button>
                      )}
                      {r.estado === 'respondido' && (
                        <button onClick={() => cambiarEstado(r.id, 'cerrado')}
                          style={{ padding: '3px 7px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          Cerrar
                        </button>
                      )}
                      <button onClick={() => startEdit(r)}
                        style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(r.id)}
                        style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail / response panel */}
        {selected && (
          <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700 }}>{TIPO_STYLE[selected.tipo]?.icon} {selected.asunto}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '10px' }}>
              {[
                { label: 'Tipo', value: TIPO_STYLE[selected.tipo]?.label },
                { label: 'Estado', value: ESTADO_STYLE[selected.estado]?.label },
                { label: 'Prioridad', value: PRIORIDAD_STYLE[selected.prioridad]?.label },
                { label: 'Unidad', value: selected.anonimo ? 'Anónimo' : (unidades.find(u => u.id === selected.unidad_id)?.nombre ?? '—') },
                { label: 'Recibido', value: selected.created_at.slice(0, 10) },
                { label: 'Plazo', value: selected.plazo_respuesta ?? '—' },
              ].map(f => (
                <div key={f.label} style={{ background: 'var(--at-surface)', borderRadius: '7px', padding: '7px', border: '1px solid var(--at-line)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{f.label}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600 }}>{f.value}</div>
                </div>
              ))}
            </div>

            {selected.descripcion && (
              <div style={{ background: 'var(--at-surface)', borderRadius: '8px', padding: '8px', border: '1px solid var(--at-line)', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Descripción</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{selected.descripcion}</div>
              </div>
            )}

            {selected.respuesta_admin && (
              <div style={{ background: 'var(--at-success-tint)', borderRadius: '8px', padding: '8px', border: '1px solid var(--at-success-border)', marginBottom: '10px' }}>
                <div style={{ fontSize: '10px', color: 'var(--at-success)', fontWeight: 700, marginBottom: '3px' }}>Respuesta{selected.respondido_por ? ` de ${selected.respondido_por}` : ''} ({selected.fecha_respuesta})</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>{selected.respuesta_admin}</div>
              </div>
            )}

            {canEdit && !showRespForm && (selected.estado === 'recibido' || selected.estado === 'en_revision') && (
              <button onClick={() => setShowRespForm(true)}
                style={{ width: '100%', padding: '8px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', fontWeight: 600, marginBottom: '8px' }}>
                ✍️ Responder
              </button>
            )}

            {showRespForm && (
              <div style={{ background: 'var(--at-surface)', borderRadius: '8px', padding: '10px', border: '1px solid var(--at-line)' }}>
                <div style={{ marginBottom: '6px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '2px' }}>Respondido por</label>
                  <input style={{ ...inputStyle, fontSize: '12px' }} value={formResp.respondido_por} onChange={e => setFR('respondido_por', e.target.value)} placeholder="Nombre del administrador" />
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '2px' }}>Respuesta *</label>
                  <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit', fontSize: '12px' }}
                    value={formResp.respuesta_admin} onChange={e => setFR('respuesta_admin', e.target.value)} placeholder="Respuesta oficial de la administración…" autoFocus />
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={handleResponder}
                    style={{ padding: '6px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                    Enviar respuesta
                  </button>
                  <button onClick={() => { setShowRespForm(false); setFormResp({ ...BLANK_RESP }) }}
                    style={{ padding: '6px 10px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
