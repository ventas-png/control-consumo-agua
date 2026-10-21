import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { IncidenteSeguridad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  incidentes: IncidenteSeguridad[]
  proyectoId: string
  companyId: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.<tab>.delete): ver o
   *  editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  robo:       { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Robo',       icon: '🚨' },
  vandalismo: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Vandalismo', icon: '🔨' },
  accidente:  { bg: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', label: 'Accidente',  icon: '🩺' },
  incendio:   { bg: 'var(--at-danger-border)', color: 'var(--at-danger-strong)', label: 'Incendio',   icon: '🔥' },
  pelea:      { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Pelea',      icon: '⚡' },
  otro:       { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Otro',       icon: '📋' },
}

const ESTADO_FLOW: Record<string, { bg: string; color: string; label: string; next?: string; nextLabel?: string }> = {
  reportado:    { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Reportado',    next: 'investigando', nextLabel: 'Iniciar Investigación' },
  investigando: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Investigando', next: 'resuelto',     nextLabel: 'Marcar Resuelto' },
  resuelto:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Resuelto',     next: 'cerrado',      nextLabel: 'Cerrar' },
  cerrado:      { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Cerrado' },
}

const BLANK = {
  fecha: hoyLocalISO(), hora: '',
  tipo: 'otro', descripcion: '', area: '',
  reportado_por: '', estado: 'reportado', involucrados: '', seguimiento: '',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }
const pill = (bg: string, color: string): CSSProperties => ({ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: bg, color, whiteSpace: 'nowrap' })

/** La descripción hace de título de la ventana: se acorta si es un párrafo
 *  (el texto completo va en el cuerpo). */
function tituloCorto(texto: string): string {
  return texto.length > 80 ? `${texto.slice(0, 79).trimEnd()}…` : texto
}

export function IncidentesTab({ incidentes, proyectoId, companyId, proyectoNombre = 'Condominio', canCreate, canEdit, canDelete, onRefresh }: Props) {
  // Por id y no la fila: tras editar o avanzar de estado, `incidentes` llega
  // refrescado y la ventana muestra el dato nuevo (la copia quedaba vieja).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterTipo, setFilterTipo] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [searchArea, setSearchArea] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true); setSelectedId(null) }
  const openEdit = (i: IncidenteSeguridad) => {
    setForm({
      fecha: i.fecha, hora: i.hora ?? '',
      tipo: i.tipo, descripcion: i.descripcion, area: i.area ?? '',
      reportado_por: i.reportado_por ?? '', estado: i.estado,
      involucrados: i.involucrados ?? '', seguimiento: i.seguimiento ?? '',
    })
    setEditId(i.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.descripcion.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'La descripción es obligatoria.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, hora: form.hora || null,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      area: form.area || null, reportado_por: form.reportado_por || null,
      estado: form.estado, involucrados: form.involucrados || null,
      seguimiento: form.seguimiento || null,
    }
    const { error } = editId
      ? await updateCondominioRow('incidentes_seguridad', editId, payload)
      : await createCondominioRow('incidentes_seguridad', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const avanzarEstado = async (i: IncidenteSeguridad) => {
    const cfg = ESTADO_FLOW[i.estado]
    if (!cfg.next) return
    const { error } = await updateCondominioRow('incidentes_seguridad', i.id, { estado: cfg.next })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const handleDelete = async (i: IncidenteSeguridad) => {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar incidente?', text: i.descripcion, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('incidentes_seguridad', i.id)
    if (selectedId === i.id) setSelectedId(null)
    onRefresh()
  }

  const cerrarForm = () => {
    if (saving) return
    setShowForm(false)
  }

  const filtered = incidentes.filter(i =>
    (!filterTipo || i.tipo === filterTipo) &&
    (!filterEstado || i.estado === filterEstado) &&
    (!searchArea || (i.area ?? '').toLowerCase().includes(searchArea.toLowerCase()))
  )

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Registro de Incidentes de Seguridad',
      proyectoNombre,
      headers: ['Fecha', 'Hora', 'Tipo', 'Área', 'Descripción', 'Reportado por', 'Estado'],
      rows: filtered.map(i => [i.fecha, i.hora ?? '—', TIPO_STYLE[i.tipo]?.label ?? i.tipo, i.area ?? '—', i.descripcion, i.reportado_por ?? '—', ESTADO_FLOW[i.estado]?.label ?? i.estado]),
      filename: `incidentes-${hoyLocalISO()}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`incidentes-${hoyLocalISO()}`, [{
      name: 'Incidentes',
      headers: ['Fecha', 'Hora', 'Tipo', 'Área', 'Descripción', 'Reportado por', 'Estado', 'Involucrados', 'Seguimiento'],
      rows: filtered.map(i => [i.fecha, i.hora ?? '', TIPO_STYLE[i.tipo]?.label ?? i.tipo, i.area ?? '', i.descripcion, i.reportado_por ?? '', ESTADO_FLOW[i.estado]?.label ?? i.estado, i.involucrados ?? '', i.seguimiento ?? '']),
    }])
  }

  const kpiTipos = Object.keys(TIPO_STYLE)
  const abiertos = incidentes.filter(i => i.estado === 'reportado' || i.estado === 'investigando').length
  const selected = selectedId ? incidentes.find(i => i.id === selectedId) ?? null : null

  // Antes: panel fijo de 360px a la izquierda y el detalle/formulario a la
  // derecha; en el teléfono el panel solo ya se salía de la pantalla. Ahora la
  // lista ocupa la página y el detalle y el formulario se abren en ventana.
  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
        {/* KPI strip */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: '90px', background: abiertos > 0 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', borderRadius: '8px', padding: '6px 10px', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '18px', color: abiertos > 0 ? 'var(--at-danger)' : 'var(--at-success)' }}>{abiertos}</div>
            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Abiertos</div>
          </div>
          <div style={{ minWidth: '90px', background: 'var(--at-chip)', borderRadius: '8px', padding: '6px 10px', textAlign: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--at-ink)' }}>{incidentes.length}</div>
            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Total</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          {canCreate && (
            <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              🚨 Registrar
            </button>
          )}
          <button onClick={exportarPDF} disabled={incidentes.length === 0} aria-label="Exportar a PDF" style={{ padding: '8px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }} title="PDF">📄</button>
          <button onClick={exportarXlsx} disabled={incidentes.length === 0} aria-label="Exportar a Excel" style={{ padding: '8px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }} title="Excel">📊</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input value={searchArea} onChange={e => setSearchArea(e.target.value)} placeholder="Buscar por área..." aria-label="Buscar por área" style={{ ...inputStyle, flex: '2 1 200px', width: 'auto', minWidth: 0 }} />
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} aria-label="Filtrar por tipo" style={{ ...inputStyle, flex: '1 1 140px', width: 'auto', minWidth: 0 }}>
          <option value="">Todos tipos</option>
          {kpiTipos.map(k => <option key={k} value={k}>{TIPO_STYLE[k].icon} {TIPO_STYLE[k].label}</option>)}
        </select>
        <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} aria-label="Filtrar por estado" style={{ ...inputStyle, flex: '1 1 140px', width: 'auto', minWidth: 0 }}>
          <option value="">Todos estados</option>
          {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="Sin incidentes" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(i => {
            const ts = TIPO_STYLE[i.tipo]
            const es = ESTADO_FLOW[i.estado]
            return (
              <button key={i.id} type="button" onClick={() => { setSelectedId(i.id); setShowForm(false) }}
                style={{ width: '100%', textAlign: 'left', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '16px' }}>{ts.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.descripcion}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {i.fecha}{i.hora ? ` ${i.hora}` : ''}{i.area ? ` · ${i.area}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, alignItems: 'flex-end' }}>
                    <span style={{ padding: '2px 7px', borderRadius: '99px', fontSize: '10px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                    <span style={{ padding: '2px 7px', borderRadius: '99px', fontSize: '10px', fontWeight: 600, background: es.bg, color: es.color }}>{es.label}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Form en ventana. Mientras está abierto se oculta el detalle, como
          antes; al cerrarlo vuelve el incidente que se estaba editando. */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar incidente' : 'Registrar incidente'}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="inc-tipo" style={labelStyle}>Tipo *</label>
              <select id="inc-tipo" style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="inc-fecha" style={labelStyle}>Fecha</label>
              <input id="inc-fecha" style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label htmlFor="inc-hora" style={labelStyle}>Hora</label>
              <input id="inc-hora" style={inputStyle} type="time" value={form.hora} onChange={e => setF('hora', e.target.value)} />
            </div>
            <div>
              <label htmlFor="inc-area" style={labelStyle}>Área</label>
              <input id="inc-area" style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Lobby, Parqueo 3" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inc-descripcion" style={labelStyle}>Descripción *</label>
              <textarea id="inc-descripcion" style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Descripción detallada del incidente" autoFocus />
            </div>
            <div>
              <label htmlFor="inc-reportado-por" style={labelStyle}>Reportado por</label>
              <input id="inc-reportado-por" style={inputStyle} value={form.reportado_por} onChange={e => setF('reportado_por', e.target.value)} placeholder="Nombre o cargo" />
            </div>
            <div>
              <label htmlFor="inc-estado" style={labelStyle}>Estado</label>
              <select id="inc-estado" style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inc-involucrados" style={labelStyle}>Involucrados</label>
              <input id="inc-involucrados" style={inputStyle} value={form.involucrados} onChange={e => setF('involucrados', e.target.value)} placeholder="Personas o unidades involucradas" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="inc-seguimiento" style={labelStyle}>Seguimiento</label>
              <textarea id="inc-seguimiento" style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.seguimiento} onChange={e => setF('seguimiento', e.target.value)} placeholder="Acciones tomadas, estado de la investigación..." />
            </div>
          </div>
        </EditModal>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {!showForm && selected && (() => {
        const ts = TIPO_STYLE[selected.tipo]
        const es = ESTADO_FLOW[selected.estado]
        return (
          <EditModal
            title={`${ts.icon} ${tituloCorto(selected.descripcion)}`}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={pill(ts.bg, ts.color)}>{ts.label}</span>
              <span style={pill(es.bg, es.color)}>{es.label}</span>
              <span>{selected.fecha}{selected.hora ? ` a las ${selected.hora}` : ''}{selected.area ? ` · ${selected.area}` : ''}</span>
            </span>}
            maxWidth="640px"
            fullScreenOnMobile
            onClose={() => setSelectedId(null)}
            footer={<>
              {canDelete && <Button variant="outline-danger" onClick={() => handleDelete(selected)}>🗑 Eliminar</Button>}
              {canEdit && <Button variant="secondary" onClick={() => openEdit(selected)}>✏️ Editar</Button>}
              {canEdit && es.next && <Button onClick={() => avanzarEstado(selected)}>→ {es.nextLabel}</Button>}
            </>}
          >
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '14px', marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Descripción</div>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--at-ink)', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selected.descripcion}</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
              {[
                { label: 'Reportado por', val: selected.reportado_por ?? '—' },
                { label: 'Involucrados', val: selected.involucrados ?? '—' },
              ].map(row => (
                <div key={row.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '2px' }}>{row.label}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{row.val}</div>
                </div>
              ))}
            </div>

            {selected.seguimiento && (
              <div style={{ background: 'var(--at-warning-tint)', borderRadius: '8px', padding: '12px', border: '1px solid var(--at-warning-border)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-warning-strong)', marginBottom: '4px' }}>Seguimiento</div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)', whiteSpace: 'pre-wrap' }}>{selected.seguimiento}</p>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
