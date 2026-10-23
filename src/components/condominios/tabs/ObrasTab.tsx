import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ObraMejora, EstadoObra } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  obras: ObraMejora[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.obras.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<EstadoObra, { bg: string; color: string; label: string }> = {
  planificada:    { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Planificada' },
  en_ejecucion:  { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'En ejecución' },
  completada:    { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Completada' },
  pausada:       { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Pausada' },
  cancelada:     { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Cancelada' },
}

const BLANK = { titulo: '', descripcion: '', area: '', contratista: '', monto_contrato: '', fecha_inicio: '', fecha_fin_estimada: '', fecha_fin_real: '', estado: 'planificada' as EstadoObra, progreso: '0', notas: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }

export function ObrasTab({ obras, proyectoId, companyId, moneda, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  // Por id y no la fila: tras mover el progreso, `obras` llega refrescado y la
  // ventana muestra el porcentaje y el estado nuevos (la copia quedaba vieja).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoObra>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(o: ObraMejora) {
    setEditId(o.id)
    setForm({ titulo: o.titulo, descripcion: o.descripcion ?? '', area: o.area ?? '', contratista: o.contratista ?? '', monto_contrato: o.monto_contrato ? String(o.monto_contrato) : '', fecha_inicio: o.fecha_inicio ?? '', fecha_fin_estimada: o.fecha_fin_estimada ?? '', fecha_fin_real: o.fecha_fin_real ?? '', estado: o.estado, progreso: String(o.progreso), notas: o.notas ?? '' })
    setShowForm(true)
  }

  function cerrarForm() {
    if (saving) return
    setShowForm(false); setEditId(null)
  }

  async function handleSave() {
    if (!form.titulo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El título es obligatorio.' })
    const progreso = Math.max(0, Math.min(100, parseInt(form.progreso) || 0))
    setSaving(true)
    const payload = {
      titulo: form.titulo.trim(), descripcion: form.descripcion || null, area: form.area || null,
      contratista: form.contratista || null, monto_contrato: form.monto_contrato ? parseFloat(form.monto_contrato) : null,
      fecha_inicio: form.fecha_inicio || null, fecha_fin_estimada: form.fecha_fin_estimada || null,
      fecha_fin_real: form.fecha_fin_real || null, estado: form.estado, progreso, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await updateCondominioRow('obras_mejoras', editId, payload))
    } else {
      ({ error } = await createCondominioRow('obras_mejoras', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar obra?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('obras_mejoras', id)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  async function actualizarProgreso(id: string, progreso: number) {
    const autoEstado = progreso === 100 ? 'completada' : undefined
    const update: Record<string, unknown> = { progreso }
    if (autoEstado) update.estado = autoEstado
    await updateCondominioRow('obras_mejoras', id, update)
    onRefresh()
  }

  const filtered = filtroEstado === 'todos' ? obras : obras.filter(o => o.estado === filtroEstado)
  // De `obras` y no de `filtered`: cambiar el filtro no cierra la ventana.
  const selected = selectedId ? obras.find(o => o.id === selectedId) ?? null : null

  const totalPresupuestado = obras.reduce((s, o) => s + Number(o.monto_contrato ?? 0), 0)
  const enEjecucion = obras.filter(o => o.estado === 'en_ejecucion').length
  const completadas = obras.filter(o => o.estado === 'completada').length

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Obras y Mejoras</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{enEjecucion} en ejecución · {completadas} completadas</p>
        </div>
        {/* Sin `!showForm`: el botón sigue montado detrás de la ventana y
            recupera el foco al cerrarla. */}
        {canCreate && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Obra
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total', value: String(obras.length), color: 'var(--at-ink-3)' },
          { label: 'En ejecución', value: String(enEjecucion), color: 'var(--at-warning)' },
          { label: 'Completadas', value: String(completadas), color: 'var(--at-success)' },
          { label: 'Presupuestado', value: fmt(totalPresupuestado, moneda), color: 'var(--at-primary)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: k.label === 'Presupuestado' ? '12px' : '22px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form en ventana (antes se desplegaba arriba de la lista y en el
          teléfono la empujaba fuera de la pantalla). */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar obra' : 'Nueva obra'}
          maxWidth="680px"
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="obra-titulo" style={labelStyle}>Título *</label>
              <input id="obra-titulo" style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Remodelación salón comunal" autoFocus />
            </div>
            <div>
              <label htmlFor="obra-area" style={labelStyle}>Área</label>
              <input id="obra-area" style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Salón, Piscina, Exteriores…" />
            </div>
            <div>
              <label htmlFor="obra-contratista" style={labelStyle}>Contratista</label>
              <input id="obra-contratista" style={inputStyle} value={form.contratista} onChange={e => setF('contratista', e.target.value)} placeholder="Empresa / persona" />
            </div>
            <div>
              <label htmlFor="obra-monto" style={labelStyle}>Monto contrato ({moneda})</label>
              <input id="obra-monto" style={inputStyle} type="number" step="0.01" value={form.monto_contrato} onChange={e => setF('monto_contrato', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="obra-fecha-inicio" style={labelStyle}>Fecha inicio</label>
              <input id="obra-fecha-inicio" style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label htmlFor="obra-fecha-fin-estimada" style={labelStyle}>Fecha fin estimada</label>
              <input id="obra-fecha-fin-estimada" style={inputStyle} type="date" value={form.fecha_fin_estimada} onChange={e => setF('fecha_fin_estimada', e.target.value)} />
            </div>
            <div>
              <label htmlFor="obra-fecha-fin-real" style={labelStyle}>Fecha fin real</label>
              <input id="obra-fecha-fin-real" style={inputStyle} type="date" value={form.fecha_fin_real} onChange={e => setF('fecha_fin_real', e.target.value)} />
            </div>
            <div>
              <label htmlFor="obra-estado" style={labelStyle}>Estado</label>
              <select id="obra-estado" style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value as EstadoObra)}>
                {Object.entries(ESTADO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="obra-progreso" style={labelStyle}>Progreso ({form.progreso}%)</label>
              <input id="obra-progreso" style={inputStyle} type="range" min="0" max="100" value={form.progreso} onChange={e => setF('progreso', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="obra-notas" style={labelStyle}>Descripción / Notas</label>
              <textarea id="obra-notas" style={{ ...inputStyle, minHeight: '55px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Detalles, observaciones…" />
            </div>
          </div>
        </EditModal>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'planificada', 'en_ejecucion', 'completada', 'pausada', 'cancelada'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todas' : ESTADO_STYLE[f as EstadoObra]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Lista a todo el ancho — cada obra se abre en ventana. Antes el
          detalle ocupaba media pantalla a la derecha y en el teléfono partía
          la lista. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.length === 0 ? (
          <EmptyState icon="🏗️" title="No hay obras registradas" />
        ) : filtered.map(o => {
          const es = ESTADO_STYLE[o.estado]
          const progreso = o.progreso ?? 0
          return (
            <div key={o.id}
              style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
              <button type="button" className="cond-row-main" onClick={() => setSelectedId(o.id)}
                style={{ flex: '1 1 260px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>{o.titulo}</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '6px', display: 'flex', gap: '4px 10px', flexWrap: 'wrap' }}>
                  {o.area && <span>📍 {o.area}</span>}
                  {o.contratista && <span>👷 {o.contratista}</span>}
                  {o.monto_contrato && <span>💰 {fmt(Number(o.monto_contrato), moneda)}</span>}
                  {o.fecha_fin_estimada && <span>📅 Est: {o.fecha_fin_estimada}</span>}
                </div>
                {/* Progress bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: 1, height: '6px', background: 'var(--at-line)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progreso}%`, background: progreso === 100 ? 'var(--at-success)' : progreso > 50 ? 'var(--at-primary)' : 'var(--at-warning)', borderRadius: '3px', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-2)', minWidth: '30px' }}>{progreso}%</span>
                </div>
              </button>
              {(canEdit || canDelete) && (
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                  {canEdit && (
                    <button onClick={() => startEdit(o)} aria-label={`Editar ${o.titulo}`}
                      style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                  )}
                  {canDelete && (
                    <button onClick={() => handleDelete(o.id)} aria-label={`Eliminar ${o.titulo}`}
                      style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {selected && (() => {
        const es = ESTADO_STYLE[selected.estado]
        return (
          <EditModal
            title={selected.titulo}
            subtitle={<span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {es && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>}
              {selected.area && <span>📍 {selected.area}</span>}
              <span>{selected.progreso ?? 0}% de avance</span>
            </span>}
            maxWidth="640px"
            fullScreenOnMobile
            onClose={() => setSelectedId(null)}
            // Las mismas acciones de la fila: con la ventana abierta la lista
            // queda detrás y no se alcanzan.
            footer={(canEdit || canDelete) ? <>
              {canDelete && <Button variant="outline-danger" onClick={() => handleDelete(selected.id)} aria-label="Eliminar obra">🗑️</Button>}
              {canEdit && <Button variant="secondary" onClick={() => { setSelectedId(null); startEdit(selected) }}>✏️ Editar</Button>}
            </> : undefined}
          >
            {/* Tarjetas que se reacomodan: dentro de la ventana no aplican las
                reglas de teléfono del panel. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Estado', value: ESTADO_STYLE[selected.estado]?.label },
                { label: 'Área', value: selected.area ?? '—' },
                { label: 'Contratista', value: selected.contratista ?? '—' },
                { label: 'Monto contrato', value: selected.monto_contrato ? fmt(Number(selected.monto_contrato), moneda) : '—' },
                { label: 'Fecha inicio', value: selected.fecha_inicio ?? '—' },
                { label: 'Fecha fin estimada', value: selected.fecha_fin_estimada ?? '—' },
                { label: 'Fecha fin real', value: selected.fecha_fin_real ?? '—' },
              ].map(f => (
                <div key={f.label} style={{ background: 'var(--at-surface-2)', borderRadius: '7px', padding: '8px', border: '1px solid var(--at-line)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--at-ink-3)' }}>{f.label}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{f.value}</div>
                </div>
              ))}
            </div>

            {/* Progress adjuster */}
            {canEdit && selected.estado !== 'completada' && selected.estado !== 'cancelada' && (
              <div style={{ marginBottom: '12px' }}>
                <label htmlFor="obra-detalle-progreso" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '4px' }}>Actualizar progreso: {selected.progreso}%</label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input id="obra-detalle-progreso" type="range" min="0" max="100" defaultValue={selected.progreso ?? 0}
                    style={{ flex: 1, minWidth: 0 }}
                    onMouseUp={e => actualizarProgreso(selected.id, parseInt((e.target as HTMLInputElement).value))}
                    onTouchEnd={e => actualizarProgreso(selected.id, parseInt((e.target as HTMLInputElement).value))}
                  />
                  <div style={{ height: '8px', width: '120px', flexShrink: 0, background: 'var(--at-line)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${selected.progreso ?? 0}%`, background: 'var(--at-primary)', borderRadius: '4px' }} />
                  </div>
                </div>
              </div>
            )}

            {selected.notas && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', border: '1px solid var(--at-line)' }}>
                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '4px' }}>Notas</div>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selected.notas}</div>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
