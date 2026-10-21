import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRowAfectando, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { PermisoObraUnidad, Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  permisos: PermisoObraUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.<tab>.delete): ver o
   *  editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  remodelacion: { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Remodelación', icon: '🔨' },
  ampliacion:   { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Ampliación',   icon: '📐' },
  reparacion:   { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Reparación',   icon: '🔧' },
  pintura:      { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Pintura',      icon: '🎨' },
  otro:         { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Otro',         icon: '📋' },
}

const ESTADO_FLOW: Record<string, { bg: string; color: string; label: string; next?: string; nextLabel?: string }> = {
  solicitado:   { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Solicitado',   next: 'aprobado',      nextLabel: 'Aprobar' },
  aprobado:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Aprobado',     next: 'en_ejecucion',  nextLabel: 'Iniciar Ejecución' },
  en_ejecucion: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'En Ejecución', next: 'completado',    nextLabel: 'Marcar Completado' },
  completado:   { bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', label: 'Completado' },
  rechazado:    { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Rechazado' },
}

const BLANK = {
  unidad_id: '', tipo_obra: 'remodelacion', descripcion: '',
  fecha_inicio: '', fecha_fin_estimada: '', horario_permitido: '',
  fianza: '', estado: 'solicitado', aprobado_por: '', observaciones: '',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }

export function PermisosObraTab({ permisos, unidades, proyectoId, companyId, moneda, canCreate, canEdit, canDelete, onRefresh }: Props) {
  // Por id y no la fila: tras editar o rechazar, la ventana muestra lo que
  // trae onRefresh (la copia guardada quedaba con los datos de antes).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /**
   * Estado recién avanzado, para que la ventana lo refleje al instante y no
   * tras la recarga. Vale solo mientras `permisos` siga trayendo esa misma
   * fila: cualquier versión nueva lo descarta.
   */
  const [cambioLocal, setCambioLocal] = useState<{ fila: PermisoObraUnidad; cambios: Partial<PermisoObraUnidad> } | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterEstado, setFilterEstado] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const filaSel = selectedId ? permisos.find(p => p.id === selectedId) ?? null : null
  const selected = filaSel && cambioLocal?.fila === filaSel ? { ...filaSel, ...cambioLocal.cambios } : filaSel

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true); setSelectedId(null) }
  const openEdit = (p: PermisoObraUnidad) => {
    setForm({
      unidad_id: p.unidad_id ?? '', tipo_obra: p.tipo_obra, descripcion: p.descripcion,
      fecha_inicio: p.fecha_inicio ?? '', fecha_fin_estimada: p.fecha_fin_estimada ?? '',
      horario_permitido: p.horario_permitido ?? '', fianza: p.fianza != null ? String(p.fianza) : '',
      estado: p.estado, aprobado_por: p.aprobado_por ?? '', observaciones: p.observaciones ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.descripcion.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'La descripción es obligatoria.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo_obra: form.tipo_obra, descripcion: form.descripcion.trim(),
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin_estimada: form.fecha_fin_estimada || null,
      horario_permitido: form.horario_permitido || null,
      fianza: form.fianza ? parseFloat(form.fianza) : null,
      estado: form.estado,
      aprobado_por: form.aprobado_por || null,
      observaciones: form.observaciones || null,
    }
    const { error } = editId
      ? await updateCondominioRow('permisos_obra_unidad', editId, payload)
      : await createCondominioRow('permisos_obra_unidad', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const avanzarEstado = async (p: PermisoObraUnidad) => {
    const cfg = ESTADO_FLOW[p.estado]
    if (!cfg.next) return
    const { error } = await updateCondominioRow('permisos_obra_unidad', p.id, { estado: cfg.next })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
    const fila = permisos.find(x => x.id === p.id)
    if (fila) setCambioLocal({ fila, cambios: { estado: cfg.next as PermisoObraUnidad['estado'] } })
  }

  const rechazar = async (p: PermisoObraUnidad) => {
    const r = await confirm({ title: '¿Rechazar permiso?', icon: 'warning', variant: 'danger', confirmText: 'Rechazar' })
    if (!r.isConfirmed) return
    await updateCondominioRow('permisos_obra_unidad', p.id, { estado: 'rechazado' })
    onRefresh()
  }

  const handleDelete = async (p: PermisoObraUnidad) => {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar permiso?', text: p.descripcion, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRowAfectando('permisos_obra_unidad', p.id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    if (selectedId === p.id) setSelectedId(null)
    onRefresh()
  }

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
  }

  const filtered = permisos.filter(p =>
    (!filterEstado || p.estado === filterEstado) &&
    (!filterTipo || p.tipo_obra === filterTipo)
  )

  const kpiEstados = ['solicitado', 'aprobado', 'en_ejecucion', 'completado', 'rechazado']

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Permisos de obra</h2>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nuevo permiso
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px', marginBottom: '12px' }}>
        {kpiEstados.map(e => {
          const cnt = permisos.filter(p => p.estado === e).length
          const cfg = ESTADO_FLOW[e]
          return (
            <div key={e} style={{ background: cfg.bg, borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '16px', color: cfg.color }}>{cnt}</div>
              <div style={{ fontSize: '10px', color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <select aria-label="Filtrar por estado" value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ ...inputStyle, flex: '1 1 180px', width: 'auto', minWidth: 0 }}>
          <option value="">Todos estados</option>
          {kpiEstados.map(e => <option key={e} value={e}>{ESTADO_FLOW[e].label}</option>)}
        </select>
        <select aria-label="Filtrar por tipo" value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, flex: '1 1 180px', width: 'auto', minWidth: 0 }}>
          <option value="">Todos tipos</option>
          {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Lista a todo el ancho — cada permiso se abre en ventana. Antes era un
          panel fijo de 360px con el detalle al lado, que en el teléfono ni
          cabía en la pantalla. */}
      {filtered.length === 0 && (
        <EmptyState icon="📋" title="Sin permisos" />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.map(p => {
          const ts = TIPO_STYLE[p.tipo_obra]
          const es = ESTADO_FLOW[p.estado]
          const unidad = unidades.find(u => u.id === p.unidad_id)
          return (
            <button key={p.id} type="button" onClick={() => { setSelectedId(p.id); setShowForm(false) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', padding: '12px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', cursor: 'pointer', background: 'var(--at-surface)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span>{ts.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.descripcion}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    {unidad?.nombre ?? 'Sin unidad'} · {p.fecha_inicio ?? 'Sin fecha'}
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

      {/* Form en ventana; al editar reemplaza al detalle, que vuelve al cerrar. */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar permiso' : 'Nuevo permiso de obra'}
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
              <label htmlFor="po-unidad" style={labelStyle}>Unidad</label>
              <select id="po-unidad" style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="po-tipo" style={labelStyle}>Tipo de obra *</label>
              <select id="po-tipo" style={inputStyle} value={form.tipo_obra} onChange={e => setF('tipo_obra', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="po-descripcion" style={labelStyle}>Descripción *</label>
              <input id="po-descripcion" style={inputStyle} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalle de la obra solicitada" autoFocus />
            </div>
            <div>
              <label htmlFor="po-inicio" style={labelStyle}>Fecha inicio</label>
              <input id="po-inicio" style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label htmlFor="po-fin" style={labelStyle}>Fecha fin estimada</label>
              <input id="po-fin" style={inputStyle} type="date" value={form.fecha_fin_estimada} onChange={e => setF('fecha_fin_estimada', e.target.value)} />
            </div>
            <div>
              <label htmlFor="po-horario" style={labelStyle}>Horario permitido</label>
              <input id="po-horario" style={inputStyle} value={form.horario_permitido} onChange={e => setF('horario_permitido', e.target.value)} placeholder="Ej. Lun-Vie 8:00-17:00" />
            </div>
            <div>
              <label htmlFor="po-fianza" style={labelStyle}>Fianza ({moneda})</label>
              <input id="po-fianza" style={inputStyle} type="number" min="0" step="0.01" value={form.fianza} onChange={e => setF('fianza', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label htmlFor="po-estado" style={labelStyle}>Estado</label>
              <select id="po-estado" style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="po-aprobado" style={labelStyle}>Aprobado por</label>
              <input id="po-aprobado" style={inputStyle} value={form.aprobado_por} onChange={e => setF('aprobado_por', e.target.value)} placeholder="Administrador" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="po-observaciones" style={labelStyle}>Observaciones</label>
              <input id="po-observaciones" style={inputStyle} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Condiciones, restricciones, notas" />
            </div>
          </div>
        </EditModal>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {!showForm && selected && (() => {
        const ts = TIPO_STYLE[selected.tipo_obra]
        const es = ESTADO_FLOW[selected.estado]
        const unidad = unidades.find(u => u.id === selected.unidad_id)
        return (
          <EditModal
            title={`${ts.icon} ${selected.descripcion}`}
            subtitle={<span style={{ display: 'inline-flex', gap: '6px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
              <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: es.bg, color: es.color }}>{es.label}</span>
              <span>Unidad: {unidad?.nombre ?? '—'}</span>
            </span>}
            maxWidth="680px"
            fullScreenOnMobile
            onClose={() => setSelectedId(null)}
            // Hasta cuatro botones: el contenedor propio los deja partirse en
            // dos filas en el teléfono en vez de salirse de la ventana.
            footer={<div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
              {canDelete && <Button variant="outline-danger" onClick={() => handleDelete(selected)}>🗑 Eliminar</Button>}
              {canEdit && <Button variant="secondary" onClick={() => openEdit(selected)}>✏️ Editar</Button>}
              {canEdit && (selected.estado === 'solicitado' || selected.estado === 'aprobado') && (
                <Button variant="outline-danger" onClick={() => rechazar(selected)}>✗ Rechazar</Button>
              )}
              {canEdit && es.next && (
                <Button onClick={() => avanzarEstado(selected)}>→ {es.nextLabel}</Button>
              )}
            </div>}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: selected.observaciones ? '16px' : 0 }}>
              {[
                { label: 'Fecha inicio', val: selected.fecha_inicio ?? '—' },
                { label: 'Fecha fin estimada', val: selected.fecha_fin_estimada ?? '—' },
                { label: 'Horario permitido', val: selected.horario_permitido ?? '—' },
                { label: 'Fianza', val: selected.fianza != null ? `${moneda} ${selected.fianza.toFixed(2)}` : '—' },
                { label: 'Aprobado por', val: selected.aprobado_por ?? '—' },
              ].map(row => (
                <div key={row.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '2px' }}>{row.label}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{row.val}</div>
                </div>
              ))}
            </div>

            {selected.observaciones && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Observaciones</div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>{selected.observaciones}</p>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
