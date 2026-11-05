import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { BitacoraManto } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { printHtml, raw } from '../../../lib/printHtml'

interface Props {
  registros: BitacoraManto[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.bitacora_manto.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

interface TareaItem { tarea: string; completado: boolean; observaciones: string }

const TURNO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  'mañana': { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Mañana',   icon: '🌅' },
  'tarde':  { bg: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', label: 'Tarde',    icon: '☀️' },
  'noche':  { bg: 'var(--at-accent-soft-2)', color: 'var(--at-accent-dark)', label: 'Noche',    icon: '🌙' },
}

const BLANK = { fecha: hoyLocalISO(), turno: 'mañana', responsable: '', area: '', observaciones: '' }
const BLANK_TAREA: TareaItem = { tarea: '', completado: false, observaciones: '' }

const TAREAS_PREDEFINIDAS = [
  'Limpieza de áreas comunes', 'Limpieza de pasillos y escaleras', 'Limpieza de lobby',
  'Revisión de bombas de agua', 'Revisión de luces de emergencia', 'Revisión de extintores',
  'Limpieza de piscina', 'Limpieza de gimnasio', 'Revisión de cámaras', 'Revisión de portones',
]

export function BitacoraManto({ registros, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [tareas, setTareas] = useState<TareaItem[]>([])
  const [saving, setSaving] = useState(false)
  // Por id y no la fila: con la copia, marcar una tarea no se veía hasta
  // reabrir y la segunda marca se calculaba sobre la lista vieja, deshaciendo
  // la primera. Derivado de `registros`, cada cambio parte del dato refrescado.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtroTurno, setFiltroTurno] = useState<'todos' | 'mañana' | 'tarde' | 'noche'>('todos')
  const [filtroFecha, setFiltroFecha] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
  function addTarea(texto = '') { setTareas(p => [...p, { ...BLANK_TAREA, tarea: texto }]) }
  function removeTarea(i: number) { setTareas(p => p.filter((_, idx) => idx !== i)) }
  function setTarea(i: number, f: keyof TareaItem, v: string | boolean) { setTareas(p => p.map((t, idx) => idx === i ? { ...t, [f]: v } : t)) }

  function startEdit(r: BitacoraManto) {
    setEditId(r.id)
    setForm({ fecha: r.fecha, turno: r.turno, responsable: r.responsable, area: r.area ?? '', observaciones: r.observaciones ?? '' })
    setTareas((r.tareas ?? []) as TareaItem[])
    setShowForm(true)
    setSelectedId(null)
  }

  function cerrarForm() {
    if (saving) return
    setShowForm(false); setEditId(null); setTareas([])
  }

  async function handleSave() {
    if (!form.responsable.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El responsable es obligatorio.' })
    const tareasValidas = tareas.filter(t => t.tarea.trim())
    setSaving(true)
    const payload = {
      fecha: form.fecha, turno: form.turno, responsable: form.responsable.trim(),
      area: form.area || null, tareas: tareasValidas, observaciones: form.observaciones || null, firmado: false,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('bitacora_manto', editId, payload))
    } else {
      ({ error } = await createCondominioRow('bitacora_manto', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); setTareas([]); onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar registro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('bitacora_manto', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  async function toggleFirmado(r: BitacoraManto) {
    await updateCondominioRow('bitacora_manto', r.id, { firmado: !r.firmado })
    onRefresh()
  }

  async function toggleTareaCompletada(r: BitacoraManto, i: number) {
    const tareas = (r.tareas ?? []) as TareaItem[]
    const updated = tareas.map((t, idx) => idx === i ? { ...t, completado: !t.completado } : t)
    await updateCondominioRow('bitacora_manto', r.id, { tareas: updated })
    onRefresh()
  }

  function handlePrint(r: BitacoraManto) {
    const ts = TURNO_STYLE[r.turno] ?? TURNO_STYLE['mañana']
    const tareasList = (r.tareas ?? []) as TareaItem[]
    const completadas = tareasList.filter(t => t.completado).length
    const tareasHtml = tareasList.length > 0
      ? printHtml`<table><tr><th style="width:30px">✓</th><th>Tarea</th><th>Observaciones</th></tr>
${raw(tareasList.map(t => printHtml`<tr><td class="check">${t.completado ? '✓' : '○'}</td><td>${t.tarea}</td><td>${t.observaciones || '—'}</td></tr>`).join(''))}
</table>`
      : ''
    const html = printHtml`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bitácora Mantenimiento</title>
<style>body{font-family:Arial,sans-serif;padding:30px;font-size:13px}h1{font-size:18px}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:6px 8px}th{background:var(--at-surface-2)}
.check{color:${ts.color};font-weight:700}.footer{margin-top:40px;border-top:1px solid #ccc;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig{border-top:1px solid #000;margin-top:50px;padding-top:6px;font-size:11px}</style></head><body>
<h1>Bitácora de Mantenimiento — ${ts.icon} ${ts.label}</h1>
<p><strong>Fecha:</strong> ${r.fecha} &nbsp;&nbsp; <strong>Responsable:</strong> ${r.responsable}${r.area ? raw(printHtml` &nbsp;&nbsp; <strong>Área:</strong> ${r.area}`) : ''}</p>
<p><strong>Tareas completadas:</strong> ${completadas}/${tareasList.length}</p>
${raw(tareasHtml)}
${r.observaciones ? raw(printHtml`<p><strong>Observaciones generales:</strong> ${r.observaciones}</p>`) : ''}
<div class="footer">
<div><div class="sig">Responsable de turno<br>${r.responsable}</div></div>
<div><div class="sig">Supervisión / Visto Bueno</div></div>
</div></body></html>`
    const w = window.open('', '_blank'); if (!w) return; w.document.write(html); w.document.close(); w.print()
  }

  let filtered = registros
  if (filtroTurno !== 'todos') filtered = filtered.filter(r => r.turno === filtroTurno)
  if (filtroFecha) filtered = filtered.filter(r => r.fecha === filtroFecha)
  // De `registros` y no de `filtered`: cambiar el filtro no cierra la ventana.
  const selected = selectedId ? registros.find(r => r.id === selectedId) ?? null : null

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Bitácora de Mantenimiento</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{registros.length} registro(s) · {registros.filter(r => r.firmado).length} firmado(s)</p>
        </div>
        {/* Sin `!showForm`: el botón sigue montado detrás de la ventana y
            recupera el foco al cerrarla. */}
        {canCreate && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setTareas([]); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Registro
          </button>
        )}
      </div>

      {/* Form en ventana (antes se desplegaba arriba de la lista y en el
          teléfono la empujaba fuera de la pantalla). */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar registro' : 'Nuevo registro de mantenimiento'}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label htmlFor="bit-fecha" style={labelStyle}>Fecha</label>
              <input id="bit-fecha" style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label htmlFor="bit-turno" style={labelStyle}>Turno</label>
              <select id="bit-turno" style={inputStyle} value={form.turno} onChange={e => setF('turno', e.target.value)}>
                {Object.entries(TURNO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="bit-responsable" style={labelStyle}>Responsable *</label>
              <input id="bit-responsable" style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Nombre del técnico" autoFocus />
            </div>
            <div>
              <label htmlFor="bit-area" style={labelStyle}>Área</label>
              <input id="bit-area" style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Zona, edificio…" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="bit-observaciones" style={labelStyle}>Observaciones generales</label>
              <textarea id="bit-observaciones" style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Novedades, incidencias…" />
            </div>
          </div>

          {/* Tareas */}
          <div role="group" aria-labelledby="bit-tareas-titulo">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
              <span id="bit-tareas-titulo" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)' }}>Lista de tareas</span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <select aria-label="Agregar tarea predefinida" style={{ padding: '3px 6px', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', background: 'var(--at-surface-2)', color: 'var(--at-ink)', fontFamily: 'inherit', maxWidth: '100%' }}
                  onChange={e => { if (e.target.value) { addTarea(e.target.value); e.target.value = '' } }}>
                  <option value="">+ Tarea predefinida</option>
                  {TAREAS_PREDEFINIDAS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="button" onClick={() => addTarea()}
                  style={{ padding: '3px 9px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                  + Personalizada
                </button>
              </div>
            </div>
            {tareas.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', padding: '8px', textAlign: 'center' }}>Sin tareas. Use los botones para agregar.</div>
            ) : tareas.map((t, i) => (
              // Casilla y ✕ a los lados; los dos campos se apilan en el teléfono
              // en vez de quedar en dos columnas de 80px.
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
                <input type="checkbox" aria-label={`Completada: ${t.tarea || `tarea ${i + 1}`}`} checked={t.completado} onChange={e => setTarea(i, 'completado', e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <input aria-label={`Tarea ${i + 1}`} style={{ ...inputStyle, fontSize: '12px', flex: '2 1 180px', width: 'auto', minWidth: 0, textDecoration: t.completado ? 'line-through' : 'none', color: t.completado ? 'var(--at-ink-3)' : 'var(--at-ink)' }}
                    value={t.tarea} onChange={e => setTarea(i, 'tarea', e.target.value)} placeholder="Descripción de la tarea" />
                  <input aria-label={`Notas de la tarea ${i + 1}`} style={{ ...inputStyle, fontSize: '12px', flex: '1 1 130px', width: 'auto', minWidth: 0 }} value={t.observaciones} onChange={e => setTarea(i, 'observaciones', e.target.value)} placeholder="Notas…" />
                </div>
                <button type="button" onClick={() => removeTarea(i)} aria-label={`Quitar tarea ${i + 1}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>✕</button>
              </div>
            ))}
          </div>
        </EditModal>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['todos', 'mañana', 'tarde', 'noche'] as const).map(f => (
          <button key={f} onClick={() => setFiltroTurno(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroTurno === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroTurno === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroTurno === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroTurno === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : `${TURNO_STYLE[f]?.icon} ${TURNO_STYLE[f]?.label}`}
          </button>
        ))}
        <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
          style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }} />
        {filtroFecha && <button onClick={() => setFiltroFecha('')} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>✕ Limpiar fecha</button>}
      </div>

      {/* Tarjetas: una por registro, en rejilla que se adapta al ancho (una
          columna en el teléfono). Pulsar una abre la ficha en ventana; editar y
          eliminar viven ahí. En la tarjeta queda sólo Imprimir, la acción del
          día a día. */}
      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="No hay registros de mantenimiento" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
          {filtered.map(r => {
            const ts = TURNO_STYLE[r.turno] ?? TURNO_STYLE['mañana']
            const tareasList = (r.tareas ?? []) as TareaItem[]
            const completadas = tareasList.filter(t => t.completado).length
            return (
              <div key={r.id}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderLeft: `4px solid ${r.firmado ? 'var(--at-success)' : ts.color}`, borderRadius: '10px', display: 'flex', alignItems: 'flex-start', gap: '4px', paddingRight: '8px' }}>
                <button type="button" className="cond-row-main" onClick={() => setSelectedId(r.id)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px' }}>{ts.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: '13px' }}>{r.fecha}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ts.bg, color: ts.color }}>{ts.label}</span>
                    {r.firmado && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>✓ Firmado</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '4px 10px', flexWrap: 'wrap' }}>
                    <span>👤 {r.responsable}</span>
                    {r.area && <span>📍 {r.area}</span>}
                    {tareasList.length > 0 && (
                      <span style={{ color: completadas === tareasList.length ? 'var(--at-success)' : 'var(--at-warning)', fontWeight: 600 }}>
                        ✓ {completadas}/{tareasList.length} tareas
                      </span>
                    )}
                  </div>
                  {tareasList.length > 0 && (
                    <div style={{ height: '4px', background: 'var(--at-line)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${completadas / tareasList.length * 100}%`, background: completadas === tareasList.length ? 'var(--at-success)' : 'var(--at-primary)', borderRadius: '2px' }} />
                    </div>
                  )}
                </button>
                <button onClick={() => handlePrint(r)} aria-label={`Imprimir registro del ${r.fecha}`}
                  style={{ margin: '10px 0', padding: '4px 8px', background: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', flexShrink: 0 }}>🖨️</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {selected && (() => {
        const ts = TURNO_STYLE[selected.turno] ?? TURNO_STYLE['mañana']
        const tareasList = (selected.tareas ?? []) as TareaItem[]
        const completadas = tareasList.filter(t => t.completado).length
        return (
          <EditModal
            title={`${ts.icon} ${selected.fecha} — ${ts.label}`}
            subtitle={<span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>✓ {completadas}/{tareasList.length} tareas</span>
              {selected.firmado && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>✓ Firmado</span>}
            </span>}
            size="lg"
            fullScreenOnMobile
            onClose={() => setSelectedId(null)}
            // Editar y eliminar viven aquí (la tarjeta sólo abre la ficha e
            // imprime). Envueltos para que bajen de línea en el teléfono.
            footer={<div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
              <Button variant="secondary" onClick={() => setSelectedId(null)}>Cerrar</Button>
              {canDelete && <Button variant="outline-danger" onClick={() => handleDelete(selected.id)} aria-label={`Eliminar registro del ${selected.fecha}`}>🗑️ Eliminar</Button>}
              <Button variant="secondary" onClick={() => handlePrint(selected)}>🖨️ Imprimir</Button>
              {canEdit && <Button variant="secondary" onClick={() => startEdit(selected)}>✏️ Editar</Button>}
              {canEdit && (
                <Button variant={selected.firmado ? 'success' : 'primary'} onClick={() => toggleFirmado(selected)}>
                  {selected.firmado ? '✓ Firmado' : 'Firmar'}
                </Button>
              )}
            </div>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Responsable', value: selected.responsable },
                { label: 'Área', value: selected.area || '—' },
                { label: 'Tareas completadas', value: tareasList.length > 0 ? `${completadas} / ${tareasList.length}` : '—', color: tareasList.length > 0 && completadas === tareasList.length ? 'var(--at-success)' : undefined },
                { label: 'Firma', value: selected.firmado ? '✓ Firmado' : 'Sin firmar', color: selected.firmado ? 'var(--at-success)' : 'var(--at-ink-3)' },
              ].map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '8px 12px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: d.color ?? 'var(--at-ink)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>
            {selected.observaciones && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '8px', border: '1px solid var(--at-line)', marginBottom: '10px', fontSize: '12px', color: 'var(--at-ink-2)', fontStyle: 'italic', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {selected.observaciones}
              </div>
            )}
            {tareasList.length === 0 ? (
              <EmptyState icon="📋" title="Sin tareas registradas" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {tareasList.map((t, i) => (
                  <div key={i} style={{ background: 'var(--at-surface)', borderRadius: '7px', padding: '7px 10px', border: '1px solid var(--at-line)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {canEdit ? (
                      <input type="checkbox" aria-label={`Completada: ${t.tarea}`} checked={t.completado} onChange={() => toggleTareaCompletada(selected, i)} style={{ width: '15px', height: '15px', cursor: 'pointer', flexShrink: 0 }} />
                    ) : (
                      <span style={{ fontSize: '14px', color: t.completado ? 'var(--at-success)' : 'var(--at-line)' }}>{t.completado ? '✓' : '○'}</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: t.completado ? 'var(--at-ink-3)' : 'var(--at-ink-2)', textDecoration: t.completado ? 'line-through' : 'none' }}>{t.tarea}</div>
                      {t.observaciones && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{t.observaciones}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
