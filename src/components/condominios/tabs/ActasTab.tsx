import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ActaReunion, Asamblea, TipoActa } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { printHtml, raw } from '../../../lib/printHtml'

interface Props {
  actas: ActaReunion[]
  /** Asambleas del condominio: el acta formal de una finalizada se liga a ella (una por asamblea). */
  asambleas?: Asamblea[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.actas.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoActa, { label: string; icon: string; color: string }> = {
  ordinaria:    { label: 'Ordinaria',    icon: '📋', color: 'var(--at-primary)' },
  extraordinaria:{ label: 'Extraordinaria', icon: '⚡', color: 'var(--at-warning)' },
  junta:        { label: 'Junta Directiva', icon: '👑', color: 'var(--at-accent)' },
  comite:       { label: 'Comité',       icon: '👥', color: 'var(--at-success)' },
  otro:         { label: 'Otro',         icon: '📁', color: 'var(--at-ink-3)' },
}

interface AsistenteFila { nombre: string; unidad: string; rol: string }
interface PuntoAgenda   { punto: string; descripcion: string; acuerdo: string }

const BLANK_FORM = {
  titulo: '', tipo: 'ordinaria' as TipoActa, fecha: hoyLocalISO(),
  hora_inicio: '', hora_fin: '', lugar: '', quorum: '', quorum_requerido: '',
  acuerdos: '', observaciones: '', redactada_por: '', aprobada: false,
  asamblea_id: '',
}

export function ActasTab({ actas, asambleas = [], proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [asistentes, setAsistentes] = useState<AsistenteFila[]>([{ nombre: '', unidad: '', rol: '' }])
  const [puntos, setPuntos] = useState<PuntoAgenda[]>([{ punto: '', descripcion: '', acuerdo: '' }])
  const [saving, setSaving] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function addAsistente() { setAsistentes(prev => [...prev, { nombre: '', unidad: '', rol: '' }]) }
  function removeAsistente(i: number) { setAsistentes(prev => prev.filter((_, j) => j !== i)) }
  function updateAsistente(i: number, k: keyof AsistenteFila, v: string) {
    setAsistentes(prev => prev.map((a, j) => j === i ? { ...a, [k]: v } : a))
  }
  function addPunto() { setPuntos(prev => [...prev, { punto: '', descripcion: '', acuerdo: '' }]) }
  function removePunto(i: number) { setPuntos(prev => prev.filter((_, j) => j !== i)) }
  function updatePunto(i: number, k: keyof PuntoAgenda, v: string) {
    setPuntos(prev => prev.map((p, j) => j === i ? { ...p, [k]: v } : p))
  }

  function startNew() {
    setEditId(null); setForm({ ...BLANK_FORM })
    setAsistentes([{ nombre: '', unidad: '', rol: '' }])
    setPuntos([{ punto: '', descripcion: '', acuerdo: '' }])
    setShowForm(true); setViewId(null)
  }

  function startEdit(a: ActaReunion) {
    setEditId(a.id)
    setForm({
      titulo: a.titulo, tipo: a.tipo, fecha: a.fecha,
      hora_inicio: a.hora_inicio ?? '', hora_fin: a.hora_fin ?? '',
      lugar: a.lugar ?? '', quorum: a.quorum != null ? String(a.quorum) : '',
      quorum_requerido: a.quorum_requerido != null ? String(a.quorum_requerido) : '',
      acuerdos: a.acuerdos ?? '', observaciones: a.observaciones ?? '',
      redactada_por: a.redactada_por ?? '', aprobada: a.aprobada,
      asamblea_id: a.asamblea_id ?? '',
    })
    setAsistentes((a.asistentes as AsistenteFila[]).length > 0 ? a.asistentes as AsistenteFila[] : [{ nombre: '', unidad: '', rol: '' }])
    setPuntos((a.orden_del_dia as PuntoAgenda[]).length > 0 ? a.orden_del_dia as PuntoAgenda[] : [{ punto: '', descripcion: '', acuerdo: '' }])
    setShowForm(true); setViewId(null)
  }

  async function handleSave() {
    if (!form.titulo.trim() || !form.fecha) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Título y fecha son obligatorios.' })
    setSaving(true)
    const payload = {
      titulo: form.titulo.trim(), tipo: form.tipo, fecha: form.fecha,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      lugar: form.lugar || null,
      quorum: form.quorum ? parseInt(form.quorum) : null,
      quorum_requerido: form.quorum_requerido ? parseInt(form.quorum_requerido) : null,
      asistentes: asistentes.filter(a => a.nombre.trim()),
      orden_del_dia: puntos.filter(p => p.punto.trim()),
      acuerdos: form.acuerdos || null, observaciones: form.observaciones || null,
      redactada_por: form.redactada_por || null, aprobada: form.aprobada,
      asamblea_id: form.asamblea_id || null,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('actas_reunion', editId, payload))
    } else {
      ({ error } = await createCondominioRow('actas_reunion', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar acta?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('actas_reunion', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    if (viewId === id) setViewId(null)
    onRefresh()
  }

  async function toggleAprobada(a: ActaReunion) {
    await updateCondominioRow('actas_reunion', a.id, { aprobada: !a.aprobada })
    onRefresh()
  }

  function handlePrint(a: ActaReunion) {
    const win = window.open('', '_blank')
    if (!win) return
    const asist = (a.asistentes as AsistenteFila[]).map(x => printHtml`<li>${x.nombre}${x.unidad ? ` — ${x.unidad}` : ''}${x.rol ? ` (${x.rol})` : ''}</li>`).join('')
    const agenda = (a.orden_del_dia as PuntoAgenda[]).map((p, i) => printHtml`
      <div style="margin-bottom:14px"><strong>${i+1}. ${p.punto}</strong>
      ${p.descripcion ? raw(printHtml`<p style="margin:4px 0;color:#444">${p.descripcion}</p>`) : ''}
      ${p.acuerdo ? raw(printHtml`<p style="margin:4px 0;background:var(--at-success-tint);padding:6px;border-left:3px solid var(--at-success)"><strong>Acuerdo:</strong> ${p.acuerdo}</p>`) : ''}
      </div>`).join('')
    win.document.write(printHtml`<html><head><title>${a.titulo}</title>
    <style>body{font-family:serif;max-width:750px;margin:40px auto;font-size:13px;line-height:1.7}h1{font-size:17px;text-align:center}h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px}ul{margin:0;padding-left:20px}.meta{color:#666;font-size:12px;text-align:center;margin-bottom:24px}</style>
    </head><body>
    <h1>${a.titulo}</h1>
    <div class="meta">${TIPO_LABELS[a.tipo].label} — ${a.fecha}${a.lugar ? ` — ${a.lugar}` : ''}${a.hora_inicio ? ` — ${a.hora_inicio}` : ''}${a.quorum != null ? ` — Quórum: ${a.quorum}/${a.quorum_requerido ?? '?'}` : ''}</div>
    ${asist ? raw(printHtml`<h2>Asistentes</h2><ul>${raw(asist)}</ul>`) : ''}
    ${agenda ? raw(printHtml`<h2>Orden del Día</h2>${raw(agenda)}`) : ''}
    ${a.acuerdos ? raw(printHtml`<h2>Acuerdos Generales</h2><p>${a.acuerdos}</p>`) : ''}
    ${a.observaciones ? raw(printHtml`<h2>Observaciones</h2><p>${a.observaciones}</p>`) : ''}
    ${a.redactada_por ? raw(printHtml`<div style="margin-top:40px;text-align:right;color:#666;font-size:12px">Redactada por: ${a.redactada_por}</div>`) : ''}
    ${a.aprobada ? raw('<div style="margin-top:10px;text-align:center;color:var(--at-success);font-weight:bold">✓ ACTA APROBADA</div>') : ''}
    </body></html>`)
    win.document.close(); win.print()
  }

  function cerrarForm() {
    if (saving) return
    setShowForm(false); setEditId(null)
  }

  const viewed = viewId ? actas.find(a => a.id === viewId) : null
  const asambleaDe = (id?: string | null) => (id ? asambleas.find(x => x.id === id) : undefined)
  // Se liga a una asamblea finalizada que todavía no tenga su acta (la base
  // exige las dos cosas: actas_reunion_asamblea y actas_reunion_asamblea_key).
  const ligables = asambleas.filter(x => x.estado === 'finalizada'
    && (x.id === form.asamblea_id || !actas.some(a => a.asamblea_id === x.id && a.id !== editId)))
  const inputStyle: CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }
  const aprobadaPill: CSSProperties = { fontSize: '10px', fontWeight: 700, color: 'var(--at-success)', background: 'var(--at-success-tint)', padding: '2px 6px', borderRadius: '20px' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Actas de Reunión</h2>
        {canCreate && (
          <button onClick={startNew}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Acta
          </button>
        )}
      </div>

      {/* Form en ventana: antes se desplegaba arriba de la lista y en el
          teléfono la empujaba fuera de la vista. */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar acta' : 'Nueva acta'}
          maxWidth="720px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          {/* `1 / -1` y no `span 2`: con una sola columna (teléfono) el span
              creaba una columna implícita y el campo se salía de la ventana. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="acta-titulo" style={labelStyle}>Título *</label>
              <input id="acta-titulo" style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Asamblea Ordinaria Q1 2026" autoFocus />
            </div>
            <div>
              <label htmlFor="acta-tipo" style={labelStyle}>Tipo</label>
              <select id="acta-tipo" style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoActa)}>
                {(Object.keys(TIPO_LABELS) as TipoActa[]).map(t => <option key={t} value={t}>{TIPO_LABELS[t].label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="acta-asamblea" style={labelStyle}>Asamblea</label>
              <select id="acta-asamblea" style={inputStyle} value={form.asamblea_id} onChange={e => setF('asamblea_id', e.target.value)}>
                <option value="">— Ninguna (junta, comité…) —</option>
                {ligables.map(x => <option key={x.id} value={x.id}>{x.titulo} ({x.fecha})</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="acta-fecha" style={labelStyle}>Fecha *</label>
              <input id="acta-fecha" style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label htmlFor="acta-hora-inicio" style={labelStyle}>Hora inicio</label>
              <input id="acta-hora-inicio" style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />
            </div>
            <div>
              <label htmlFor="acta-hora-fin" style={labelStyle}>Hora fin</label>
              <input id="acta-hora-fin" style={inputStyle} type="time" value={form.hora_fin} onChange={e => setF('hora_fin', e.target.value)} />
            </div>
            <div>
              <label htmlFor="acta-lugar" style={labelStyle}>Lugar</label>
              <input id="acta-lugar" style={inputStyle} value={form.lugar} onChange={e => setF('lugar', e.target.value)} placeholder="Salón de usos múltiples" />
            </div>
            <div>
              <label htmlFor="acta-quorum" style={labelStyle}>Quórum asistente</label>
              <input id="acta-quorum" style={inputStyle} type="number" min="0" value={form.quorum} onChange={e => setF('quorum', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label htmlFor="acta-quorum-requerido" style={labelStyle}>Quórum requerido</label>
              <input id="acta-quorum-requerido" style={inputStyle} type="number" min="0" value={form.quorum_requerido} onChange={e => setF('quorum_requerido', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label htmlFor="acta-redactor" style={labelStyle}>Redactada por</label>
              <input id="acta-redactor" style={inputStyle} value={form.redactada_por} onChange={e => setF('redactada_por', e.target.value)} placeholder="Nombre del secretario" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: '34px', alignSelf: 'end' }}>
              <input type="checkbox" checked={form.aprobada} onChange={e => setF('aprobada', e.target.checked)} id="aprobada_chk" />
              <label htmlFor="aprobada_chk" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Acta aprobada</label>
            </div>
          </div>

          {/* Asistentes — fila que se parte en dos líneas en el teléfono (con
              cuatro columnas fijas cada campo quedaba de unos pocos píxeles). */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)' }}>Asistentes</label>
              <button onClick={addAsistente} style={{ padding: '2px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>+ Agregar</button>
            </div>
            {asistentes.map((a, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                <input style={{ ...inputStyle, fontSize: '12px', flex: '2 1 160px', minWidth: 0 }} value={a.nombre} onChange={e => updateAsistente(i, 'nombre', e.target.value)} placeholder="Nombre" aria-label={`Nombre del asistente ${i + 1}`} />
                <input style={{ ...inputStyle, fontSize: '12px', flex: '1 1 90px', minWidth: 0 }} value={a.unidad} onChange={e => updateAsistente(i, 'unidad', e.target.value)} placeholder="Unidad" aria-label={`Unidad del asistente ${i + 1}`} />
                <input style={{ ...inputStyle, fontSize: '12px', flex: '1 1 90px', minWidth: 0 }} value={a.rol} onChange={e => updateAsistente(i, 'rol', e.target.value)} placeholder="Rol" aria-label={`Rol del asistente ${i + 1}`} />
                <button onClick={() => removeAsistente(i)} aria-label={`Quitar asistente ${i + 1}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)', flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>

          {/* Orden del día */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink)' }}>Orden del Día</label>
              <button onClick={addPunto} style={{ padding: '2px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>+ Punto</button>
            </div>
            {puntos.map((p, i) => (
              <div key={i} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', padding: '10px', marginBottom: '6px' }}>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                  <input style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: '12px' }} value={p.punto} onChange={e => updatePunto(i, 'punto', e.target.value)} placeholder={`Punto ${i+1}`} aria-label={`Punto ${i + 1}`} />
                  <button onClick={() => removePunto(i)} aria-label={`Quitar punto ${i + 1}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>✕</button>
                </div>
                <input style={{ ...inputStyle, fontSize: '12px', marginBottom: '4px' }} value={p.descripcion} onChange={e => updatePunto(i, 'descripcion', e.target.value)} placeholder="Descripción (opcional)" aria-label={`Descripción del punto ${i + 1}`} />
                <input style={{ ...inputStyle, fontSize: '12px', background: 'var(--at-success-tint)', borderColor: 'var(--at-success-border)' }} value={p.acuerdo} onChange={e => updatePunto(i, 'acuerdo', e.target.value)} placeholder="Acuerdo tomado (opcional)" aria-label={`Acuerdo del punto ${i + 1}`} />
              </div>
            ))}
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label htmlFor="acta-acuerdos" style={labelStyle}>Acuerdos generales</label>
            <textarea id="acta-acuerdos" style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.acuerdos} onChange={e => setF('acuerdos', e.target.value)} placeholder="Resumen de acuerdos generales…" />
          </div>
          <div>
            <label htmlFor="acta-observaciones" style={labelStyle}>Observaciones</label>
            <textarea id="acta-observaciones" style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Notas adicionales…" />
          </div>
        </EditModal>
      )}

      {/* Lista — cada acta se abre en ventana. Antes el detalle iba en una
          columna fija de 380px que en el teléfono dejaba la lista en una
          franja y el detalle fuera de la pantalla. */}
      {actas.length === 0 ? (
        <EmptyState icon="📜" title="No hay actas registradas" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {actas.map(a => {
            const tl = TIPO_LABELS[a.tipo]
            return (
              <div key={a.id}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderLeft: `4px solid ${tl.color}`, borderRadius: '8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
                <button type="button" className="cond-row-main" onClick={() => setViewId(a.id)}
                  style={{ flex: '1 1 240px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{tl.icon} {a.titulo}</span>
                    {a.aprobada && <span style={aprobadaPill}>✓ Aprobada</span>}
                    {asambleaDe(a.asamblea_id) && <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>🏛️ {asambleaDe(a.asamblea_id)!.titulo}</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    {tl.label} — {a.fecha}{a.lugar ? ` — ${a.lugar}` : ''}{a.hora_inicio ? ` — ${a.hora_inicio}` : ''}
                    {a.quorum != null ? ` — Quórum: ${a.quorum}/${a.quorum_requerido ?? '?'}` : ''}
                    {(a.asistentes as unknown[]).length > 0 ? ` — ${(a.asistentes as unknown[]).length} asistentes` : ''}
                  </div>
                </button>
                {(canEdit || canDelete) && (
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                    {canEdit && <>
                      <button onClick={() => handlePrint(a)} aria-label={`Imprimir ${a.titulo}`} title="Imprimir" style={{ padding: '6px 9px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>🖨️</button>
                      <button onClick={() => toggleAprobada(a)} aria-label={a.aprobada ? `Quitar aprobación de ${a.titulo}` : `Aprobar ${a.titulo}`} title={a.aprobada ? 'Quitar aprobación' : 'Aprobar'}
                        style={{ padding: '6px 9px', background: a.aprobada ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                        {a.aprobada ? '↩' : '✓'}
                      </button>
                      <button onClick={() => startEdit(a)} aria-label={`Editar ${a.titulo}`} title="Editar" style={{ padding: '6px 9px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    </>}
                    {canDelete && <button onClick={() => handleDelete(a.id)} aria-label={`Eliminar ${a.titulo}`} title="Eliminar" style={{ padding: '6px 9px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Detalle en ventana (a pantalla completa en el teléfono), con las
          mismas acciones de la fila al pie. */}
      {viewed && (() => {
        const tl = TIPO_LABELS[viewed.tipo]
        const asist = viewed.asistentes as AsistenteFila[]
        const agenda = viewed.orden_del_dia as PuntoAgenda[]
        const vacia = asist.length === 0 && agenda.length === 0 && !viewed.acuerdos && !viewed.observaciones
        return (
          <EditModal
            title={viewed.titulo}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                {tl.icon} {tl.label} · {viewed.fecha}{viewed.hora_inicio ? ` · ${viewed.hora_inicio}` : ''}{viewed.lugar ? ` · ${viewed.lugar}` : ''}
                {viewed.quorum != null ? ` · Quórum: ${viewed.quorum}/${viewed.quorum_requerido ?? '?'}` : ''}
                {asambleaDe(viewed.asamblea_id) ? ` · De la asamblea «${asambleaDe(viewed.asamblea_id)!.titulo}»` : ''}
              </span>
              {viewed.aprobada && <span style={aprobadaPill}>✓ Aprobada</span>}
            </span>}
            maxWidth="680px"
            fullScreenOnMobile
            onClose={() => setViewId(null)}
            footer={canEdit || canDelete ? (
              // Envuelve: con cuatro botones el pie no cabe a lo ancho del teléfono.
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
                {canDelete && <Button variant="outline-danger" onClick={() => handleDelete(viewed.id)} aria-label="Eliminar acta">🗑️</Button>}
                {canEdit && <>
                  <Button variant="secondary" onClick={() => startEdit(viewed)}>✏️ Editar</Button>
                  <Button variant="secondary" onClick={() => toggleAprobada(viewed)}>{viewed.aprobada ? '↩ Quitar aprobación' : '✓ Aprobar'}</Button>
                  <Button onClick={() => handlePrint(viewed)}>🖨️ Imprimir</Button>
                </>}
              </div>
            ) : undefined}
          >
            <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
              {asist.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontWeight: 700, color: 'var(--at-ink)', marginBottom: '4px' }}>Asistentes ({asist.length})</div>
                  {asist.map((a, i) => (
                    <div key={i} style={{ padding: '3px 0', color: 'var(--at-ink-3)' }}>• {a.nombre}{a.unidad ? ` — ${a.unidad}` : ''}{a.rol ? ` (${a.rol})` : ''}</div>
                  ))}
                </div>
              )}
              {agenda.length > 0 && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontWeight: 700, color: 'var(--at-ink)', marginBottom: '6px' }}>Orden del Día</div>
                  {agenda.map((p, i) => (
                    <div key={i} style={{ marginBottom: '8px', paddingLeft: '8px', borderLeft: '3px solid var(--at-line)' }}>
                      <div style={{ fontWeight: 600 }}>{i+1}. {p.punto}</div>
                      {p.descripcion && <div style={{ color: 'var(--at-ink-3)', marginTop: '2px' }}>{p.descripcion}</div>}
                      {p.acuerdo && <div style={{ background: 'var(--at-success-tint)', padding: '4px 6px', borderRadius: '4px', marginTop: '4px', color: 'var(--at-success)', fontWeight: 600 }}>✓ {p.acuerdo}</div>}
                    </div>
                  ))}
                </div>
              )}
              {viewed.acuerdos && <div style={{ marginBottom: '12px' }}><div style={{ fontWeight: 700, color: 'var(--at-ink)', marginBottom: '3px' }}>Acuerdos generales</div><div style={{ color: 'var(--at-ink-3)', whiteSpace: 'pre-wrap' }}>{viewed.acuerdos}</div></div>}
              {viewed.observaciones && <div><div style={{ fontWeight: 700, color: 'var(--at-ink)', marginBottom: '3px' }}>Observaciones</div><div style={{ color: 'var(--at-ink-3)', whiteSpace: 'pre-wrap' }}>{viewed.observaciones}</div></div>}
              {vacia && <p style={{ margin: 0, color: 'var(--at-ink-3)' }}>El acta no tiene asistentes, orden del día ni acuerdos registrados.</p>}
            </div>
          </EditModal>
        )
      })()}
    </div>
  )
}
