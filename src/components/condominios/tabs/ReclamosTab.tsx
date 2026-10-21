import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
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
  // Por id y no la fila: tras responder o cambiar de estado, `reclamos` llega
  // refrescado y la ventana muestra el dato nuevo (la copia quedaba vieja).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showRespForm, setShowRespForm] = useState(false)
  const [formResp, setFormResp] = useState({ ...BLANK_RESP })
  const [respondiendo, setRespondiendo] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'recibido' | 'en_revision' | 'respondido' | 'cerrado' | 'escalado'>('todos')
  const [filtroTipo, setFiltroTipo] = useState('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
  function setFR<K extends keyof typeof formResp>(k: K, v: typeof formResp[K]) { setFormResp(p => ({ ...p, [k]: v })) }

  function startEdit(r: ReclamoCondominio) {
    setEditId(r.id)
    setForm({ unidad_id: r.unidad_id ?? '', tipo: r.tipo, asunto: r.asunto, descripcion: r.descripcion ?? '', prioridad: r.prioridad, plazo_respuesta: r.plazo_respuesta ?? '', anonimo: r.anonimo })
    setShowForm(true)
    cerrarDetalle()
  }

  function abrirDetalle(id: string) {
    setSelectedId(id)
    setShowRespForm(false)
    setFormResp({ ...BLANK_RESP })
  }

  function cerrarDetalle() {
    if (respondiendo) return
    setSelectedId(null)
    setShowRespForm(false)
    setFormResp({ ...BLANK_RESP })
  }

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
    setEditId(null)
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
    if (selectedId === id) cerrarDetalle()
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await updateCondominioRow('reclamos_condominio', id, { estado })
    onRefresh()
  }

  async function handleResponder() {
    if (!selectedId) return
    if (!formResp.respuesta_admin.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'Escriba una respuesta.' })
    setRespondiendo(true)
    const { error } = await updateCondominioRow('reclamos_condominio', selectedId, {
      respuesta_admin: formResp.respuesta_admin.trim(),
      respondido_por: formResp.respondido_por || null,
      fecha_respuesta: hoyLocalISO(),
      estado: 'respondido',
    })
    setRespondiendo(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowRespForm(false); setFormResp({ ...BLANK_RESP }); onRefresh()
  }

  let filtered = reclamos
  if (filtroEstado !== 'todos') filtered = filtered.filter(r => r.estado === filtroEstado)
  if (filtroTipo !== 'todos') filtered = filtered.filter(r => r.tipo === filtroTipo)

  const selected = selectedId ? reclamos.find(r => r.id === selectedId) ?? null : null
  const pendientes = reclamos.filter(r => r.estado === 'recibido' || r.estado === 'en_revision').length
  const today = hoyLocalISO()
  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }
  const pill = (bg: string, color: string): CSSProperties => ({ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px', background: bg, color, whiteSpace: 'nowrap' })

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Reclamos y Sugerencias</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{pendientes} pendiente(s) de respuesta</p>
        </div>
        {canCreate && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo
          </button>
        )}
      </div>

      {/* KPIs por estado — también son el filtro: tocar uno muestra solo
          esos (antes había una fila de chips aparte con lo mismo). */}
      <div role="group" aria-label="Filtrar por estado" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px', marginBottom: '12px' }}>
        {([['todos', { label: 'Todos', color: 'var(--at-ink-2)' }], ...Object.entries(ESTADO_STYLE)] as [string, { label: string; color: string }][]).map(([est, st]) => {
          const activo = filtroEstado === est
          const n = est === 'todos' ? reclamos.length : reclamos.filter(r => r.estado === est).length
          return (
            <button key={est} type="button" aria-pressed={activo}
              onClick={() => setFiltroEstado((activo && est !== 'todos' ? 'todos' : est) as typeof filtroEstado)}
              style={{ background: activo ? 'var(--at-primary-tint)' : 'var(--at-surface)', border: `1.5px solid ${activo ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '8px 6px', textAlign: 'center', cursor: 'pointer', font: 'inherit' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: st.color }}>{n}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: activo ? 700 : 500 }}>{st.label}</div>
            </button>
          )
        })}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <select aria-label="Filtrar por tipo" style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12.5px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }}
          value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
      </div>

      {/* Form en ventana (antes se desplegaba arriba de la lista). */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar reclamo' : 'Nuevo reclamo / sugerencia'}
          maxWidth="600px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
            <div>
              <label htmlFor="rec-tipo" style={labelStyle}>Tipo</label>
              <select id="rec-tipo" style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rec-unidad" style={labelStyle}>Unidad</label>
              <select id="rec-unidad" style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad / General —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rec-prioridad" style={labelStyle}>Prioridad</label>
              <select id="rec-prioridad" style={inputStyle} value={form.prioridad} onChange={e => setF('prioridad', e.target.value)}>
                {Object.entries(PRIORIDAD_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rec-plazo" style={labelStyle}>Plazo de respuesta</label>
              <input id="rec-plazo" style={inputStyle} type="date" value={form.plazo_respuesta} onChange={e => setF('plazo_respuesta', e.target.value)} />
            </div>
            {/* `1 / -1` y no `span 2`: en una sola columna el span creaba una
                columna implícita y el campo se salía de la ventana. */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="rec-asunto" style={labelStyle}>Asunto *</label>
              <input id="rec-asunto" style={inputStyle} value={form.asunto} onChange={e => setF('asunto', e.target.value)} placeholder="Resumen del reclamo o sugerencia" autoFocus />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="rec-descripcion" style={labelStyle}>Descripción</label>
              <textarea id="rec-descripcion" style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalle del reclamo, contexto, evidencias…" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '13px', color: 'var(--at-ink-2)', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.anonimo} onChange={e => setF('anonimo', e.target.checked)} />
                Anónimo
              </label>
            </div>
          </div>
        </EditModal>
      )}

      {/* Lista — cada reclamo se abre en ventana. Antes el detalle ocupaba
          media pantalla a la derecha y en el teléfono partía la lista. */}
      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="No hay reclamos registrados" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(r => {
            const ts = TIPO_STYLE[r.tipo] ?? TIPO_STYLE.queja
            const es = ESTADO_STYLE[r.estado] ?? ESTADO_STYLE.recibido
            const pr = PRIORIDAD_STYLE[r.prioridad] ?? PRIORIDAD_STYLE.normal
            const unidad = unidades.find(u => u.id === r.unidad_id)
            const vencido = (r.estado === 'recibido' || r.estado === 'en_revision') && r.plazo_respuesta && r.plazo_respuesta < today
            const accion = !canEdit ? null
              : r.estado === 'recibido' ? { label: 'En revisión', estado: 'en_revision', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' }
              : r.estado === 'respondido' ? { label: 'Cerrar', estado: 'cerrado', bg: 'var(--at-chip)', color: 'var(--at-ink-2)' }
              : null
            return (
              <div key={r.id}
                style={{ background: 'var(--at-surface)', border: `1.5px solid ${vencido ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
                <button type="button" className="cond-row-main" onClick={() => abrirDetalle(r.id)}
                  style={{ flex: '1 1 280px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{ts.icon} {r.asunto}</span>
                    <span style={pill(es.bg, es.color)}>{es.label}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '4px 10px', flexWrap: 'wrap' }}>
                    <span>{ts.label}</span>
                    {!r.anonimo && unidad && <span>🏠 {unidad.nombre}</span>}
                    {r.anonimo && <span>🔒 Anónimo</span>}
                    <span style={{ color: pr.color, fontWeight: 600 }}>● {pr.label}</span>
                    <span>📅 {r.created_at.slice(0, 10)}</span>
                    {r.plazo_respuesta && <span style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: vencido ? 700 : 400 }}>⏰ Plazo: {r.plazo_respuesta}{vencido ? ' · vencido' : ''}</span>}
                  </div>
                </button>
                {accion && (
                  <button type="button" onClick={() => cambiarEstado(r.id, accion.estado)}
                    style={{ margin: '8px 0 8px auto', padding: '6px 12px', background: accion.bg, color: accion.color, border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: 700, flexShrink: 0 }}>
                    {accion.label}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Detalle y respuesta en ventana: a pantalla completa en el teléfono. */}
      {selected && (() => {
        const ts = TIPO_STYLE[selected.tipo] ?? TIPO_STYLE.queja
        const es = ESTADO_STYLE[selected.estado] ?? ESTADO_STYLE.recibido
        const puedeResponder = canEdit && (selected.estado === 'recibido' || selected.estado === 'en_revision')
        return (
          <EditModal
            title={`${ts.icon} ${selected.asunto}`}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={pill(es.bg, es.color)}>{es.label}</span>
              <span>{ts.label}</span>
            </span>}
            maxWidth="620px"
            fullScreenOnMobile
            closeOnBackdropClick={!respondiendo}
            closeOnEscape={!respondiendo}
            onClose={cerrarDetalle}
            footer={showRespForm ? <>
              <Button variant="secondary" onClick={() => { setShowRespForm(false); setFormResp({ ...BLANK_RESP }) }} disabled={respondiendo}>Cancelar</Button>
              <Button onClick={handleResponder} loading={respondiendo} loadingText="Enviando…">Enviar respuesta</Button>
            </> : <>
              {canEdit && <Button variant="outline-danger" onClick={() => handleDelete(selected.id)} aria-label="Eliminar reclamo">🗑️</Button>}
              {canEdit && <Button variant="secondary" onClick={() => startEdit(selected)}>✏️ Editar</Button>}
              {canEdit && selected.estado === 'recibido' && <Button variant="warning" onClick={() => cambiarEstado(selected.id, 'en_revision')}>En revisión</Button>}
              {canEdit && selected.estado === 'respondido' && <Button variant="secondary" onClick={() => cambiarEstado(selected.id, 'cerrado')}>Cerrar reclamo</Button>}
              {puedeResponder
                ? <Button onClick={() => setShowRespForm(true)}>✍️ Responder</Button>
                : !canEdit && <Button variant="secondary" onClick={cerrarDetalle}>Cerrar</Button>}
            </>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                {[
                  { label: 'Prioridad', value: PRIORIDAD_STYLE[selected.prioridad]?.label },
                  { label: 'Unidad', value: selected.anonimo ? 'Anónimo' : (unidades.find(u => u.id === selected.unidad_id)?.nombre ?? '—') },
                  { label: 'Recibido', value: selected.created_at.slice(0, 10) },
                  { label: 'Plazo', value: selected.plazo_respuesta ?? '—' },
                ].map(f => (
                  <div key={f.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '8px 10px', border: '1px solid var(--at-line)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{f.label}</div>
                    <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink)' }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {selected.descripcion && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Descripción</div>
                  <div style={{ fontSize: '14px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{selected.descripcion}</div>
                </div>
              )}

              {selected.respuesta_admin && (
                <div style={{ background: 'var(--at-success-tint)', borderRadius: '10px', padding: '10px 12px', border: '1px solid var(--at-success-border)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--at-success)', fontWeight: 700, marginBottom: '3px' }}>Respuesta{selected.respondido_por ? ` de ${selected.respondido_por}` : ''}{selected.fecha_respuesta ? ` · ${selected.fecha_respuesta}` : ''}</div>
                  <div style={{ fontSize: '14px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>{selected.respuesta_admin}</div>
                </div>
              )}

              {showRespForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid var(--at-line)', paddingTop: '12px' }}>
                  <div>
                    <label htmlFor="rec-respuesta" style={labelStyle}>Respuesta *</label>
                    <textarea id="rec-respuesta" style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', fontFamily: 'inherit' }}
                      value={formResp.respuesta_admin} onChange={e => setFR('respuesta_admin', e.target.value)} placeholder="Respuesta oficial de la administración…" autoFocus />
                  </div>
                  <div>
                    <label htmlFor="rec-respondido-por" style={labelStyle}>Respondido por</label>
                    <input id="rec-respondido-por" style={inputStyle} value={formResp.respondido_por} onChange={e => setFR('respondido_por', e.target.value)} placeholder="Nombre del administrador" />
                  </div>
                </div>
              )}
            </div>
          </EditModal>
        )
      })()}
    </div>
  )
}
