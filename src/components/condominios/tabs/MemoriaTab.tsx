import { useState, type CSSProperties} from 'react'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { MemoriaLabores, TipoPeriodo, EstadoMemoria } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  memorias: MemoriaLabores[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.memoria.delete): editar no basta. */
  canDelete: boolean
  onRefresh: () => void
}

const TIPO_PERIODO: { value: TipoPeriodo; label: string }[] = [
  { value: 'mensual',     label: 'Mensual' },
  { value: 'trimestral',  label: 'Trimestral' },
  { value: 'anual',       label: 'Anual' },
]

const blank = (): Partial<MemoriaLabores> => ({
  titulo: '', periodo: '', tipo_periodo: 'mensual', resumen: '',
  logros: '', pendientes: '', tickets_resueltos: undefined,
  visitantes_registrados: undefined, cuotas_cobradas: undefined,
  incidencias_atendidas: undefined, estado: 'borrador',
})

export function MemoriaTab({ memorias, proyectoId, companyId, userId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [filtroTipo, setFiltroTipo] = useState<TipoPeriodo | 'todos'>('todos')
  // Por id y no la fila: la ventana lee la versión vigente de `memorias` tras
  // cada refresco y se cierra sola si la memoria ya no está.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<MemoriaLabores>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = memorias.filter(m => filtroTipo === 'todos' || m.tipo_periodo === filtroTipo)
    .sort((a, b) => b.periodo.localeCompare(a.periodo))
  const selected = selectedId ? memorias.find(m => m.id === selectedId) ?? null : null

  function startEdit(m: MemoriaLabores) {
    setForm({
      titulo: m.titulo, periodo: m.periodo, tipo_periodo: m.tipo_periodo,
      resumen: m.resumen ?? '', logros: m.logros ?? '', pendientes: m.pendientes ?? '',
      tickets_resueltos: m.tickets_resueltos ?? undefined,
      visitantes_registrados: m.visitantes_registrados ?? undefined,
      cuotas_cobradas: m.cuotas_cobradas ?? undefined,
      incidencias_atendidas: m.incidencias_atendidas ?? undefined,
      estado: m.estado,
    })
    setEditId(m.id); setShowForm(true); setSelectedId(null)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  function cerrarForm() {
    if (saving) return
    cancelForm()
  }

  async function handleSave() {
    if (!form.titulo?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el título.' })
    if (!form.periodo?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el período (ej. 2026-04).' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo!.trim(), periodo: form.periodo!.trim(),
      tipo_periodo: form.tipo_periodo ?? 'mensual',
      resumen: form.resumen || null, logros: form.logros || null, pendientes: form.pendientes || null,
      tickets_resueltos: form.tickets_resueltos ?? null,
      visitantes_registrados: form.visitantes_registrados ?? null,
      cuotas_cobradas: form.cuotas_cobradas ?? null,
      incidencias_atendidas: form.incidencias_atendidas ?? null,
      estado: form.estado ?? 'borrador',
      publicado_por: form.estado === 'publicado' ? userId || null : null,
    }
    const { error } = editId
      ? await updateCondominioRow('memoria_labores', editId, payload)
      : await createCondominioRow('memoria_labores', payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handlePublicar(id: string) {
    const { error } = await updateCondominioRow('memoria_labores', id, { estado: 'publicado', publicado_por: userId || null })
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const r = await confirm({ title: '¿Eliminar memoria?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('memoria_labores', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }
  const textareaStyle: CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: '80px' }

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Memoria de Labores</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Memoria</button>
        )}
      </div>

      {/* Form en ventana (antes se desplegaba arriba de la lista y en el
          teléfono empujaba todo hacia abajo). */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar Memoria' : 'Nueva Memoria de Labores'}
          maxWidth="760px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">{editId ? 'Actualizar' : 'Crear'}</Button>
          </>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="mem-titulo" style={labelStyle}>Título *</label>
              <input id="mem-titulo" style={inputStyle} value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="ej. Informe Mensual Abril 2026" />
            </div>
            <div>
              <label htmlFor="mem-periodo" style={labelStyle}>Período *</label>
              <input id="mem-periodo" style={inputStyle} value={form.periodo ?? ''} onChange={e => setForm(f => ({ ...f, periodo: e.target.value }))} placeholder="2026-04 / 2026-Q1 / 2026" />
            </div>
            <div>
              <label htmlFor="mem-tipo" style={labelStyle}>Tipo</label>
              <select id="mem-tipo" style={inputStyle} value={form.tipo_periodo ?? 'mensual'} onChange={e => setForm(f => ({ ...f, tipo_periodo: e.target.value as TipoPeriodo }))}>
                {TIPO_PERIODO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="mem-estado" style={labelStyle}>Estado</label>
              <select id="mem-estado" style={inputStyle} value={form.estado ?? 'borrador'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoMemoria }))}>
                <option value="borrador">Borrador</option>
                <option value="publicado">Publicado</option>
              </select>
            </div>
          </div>

          {/* Métricas */}
          <div style={{ marginTop: '12px', padding: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '10px' }}>MÉTRICAS DEL PERÍODO</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
              {[
                { key: 'tickets_resueltos' as const,       label: '🔧 Tickets resueltos' },
                { key: 'visitantes_registrados' as const,  label: '🚪 Visitantes registrados' },
                { key: 'cuotas_cobradas' as const,         label: '💳 Cuotas cobradas' },
                { key: 'incidencias_atendidas' as const,   label: '⚠️ Incidencias atendidas' },
              ].map(m => (
                <div key={m.key}>
                  <label htmlFor={`mem-${m.key}`} style={labelStyle}>{m.label}</label>
                  <input id={`mem-${m.key}`} style={{ ...inputStyle, background: 'var(--at-surface)' }} type="number" min="0" value={form[m.key] ?? ''} onChange={e => setForm(f => ({ ...f, [m.key]: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Las tres columnas fijas no cabían en el teléfono (la ventana no
              recibe el CSS móvil del panel): ahora se acomodan solas. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginTop: '12px' }}>
            <div>
              <label htmlFor="mem-resumen" style={labelStyle}>Resumen ejecutivo</label>
              <textarea id="mem-resumen" style={textareaStyle} value={form.resumen ?? ''} onChange={e => setForm(f => ({ ...f, resumen: e.target.value }))} placeholder="Resumen del período…" />
            </div>
            <div>
              <label htmlFor="mem-logros" style={labelStyle}>Logros destacados</label>
              <textarea id="mem-logros" style={textareaStyle} value={form.logros ?? ''} onChange={e => setForm(f => ({ ...f, logros: e.target.value }))} placeholder="• Logro 1&#10;• Logro 2" />
            </div>
            <div>
              <label htmlFor="mem-pendientes" style={labelStyle}>Pendientes / Próximos pasos</label>
              <textarea id="mem-pendientes" style={textareaStyle} value={form.pendientes ?? ''} onChange={e => setForm(f => ({ ...f, pendientes: e.target.value }))} placeholder="• Pendiente 1&#10;• Pendiente 2" />
            </div>
          </div>
        </EditModal>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'mensual', 'trimestral', 'anual'] as const).map(t => (
          <button key={t} onClick={() => setFiltroTipo(t)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroTipo === t ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroTipo === t ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroTipo === t ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {t === 'todos' ? `Todas (${memorias.length})` : `${TIPO_PERIODO.find(x => x.value === t)?.label} (${memorias.filter(m => m.tipo_periodo === t).length})`}
          </button>
        ))}
      </div>

      {/* Lista a todo el ancho — cada memoria se abre en ventana. Antes el
          detalle iba al lado y dejaba la lista en una columna de 280px. */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay memorias de labores</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(m => (
            <div key={m.id}
              style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
              <button type="button" className="cond-row-main" onClick={() => setSelectedId(m.id)}
                style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', textAlign: 'left', background: 'none', border: 'none', padding: '14px 4px 14px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{m.titulo}</div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    📅 {m.periodo} · {TIPO_PERIODO.find(t => t.value === m.tipo_periodo)?.label}
                  </div>
                </div>
                <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap', background: m.estado === 'publicado' ? 'var(--at-success-tint)' : 'var(--at-chip)', color: m.estado === 'publicado' ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>
                  {m.estado === 'publicado' ? '✅ Publicado' : '📝 Borrador'}
                </span>
              </button>
              {m.estado === 'borrador' && (canEdit || canDelete) && (
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                  {canEdit && (
                    <button onClick={() => handlePublicar(m.id)} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Publicar</button>
                  )}
                  {canEdit && (
                    <button onClick={() => startEdit(m)} aria-label={`Editar ${m.titulo}`} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                  )}
                  {canDelete && <button onClick={() => handleDelete(m.id)} aria-label={`Eliminar ${m.titulo}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
                </div>
              )}
              {m.estado === 'publicado' && canDelete && (
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                  <button onClick={() => handleDelete(m.id)} aria-label={`Eliminar ${m.titulo}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Detalle en ventana: a pantalla completa en el teléfono. */}
      {selected && (
        <EditModal
          title={selected.titulo}
          subtitle={`${selected.periodo} · ${TIPO_PERIODO.find(t => t.value === selected.tipo_periodo)?.label ?? ''}`}
          maxWidth="640px"
          fullScreenOnMobile
          onClose={() => setSelectedId(null)}
        >
          {/* Métricas */}
          {(selected.tickets_resueltos != null || selected.visitantes_registrados != null || selected.cuotas_cobradas != null || selected.incidencias_atendidas != null) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', marginBottom: '16px' }}>
              {[
                { v: selected.tickets_resueltos,      label: '🔧 Tickets',      color: 'var(--at-primary)' },
                { v: selected.visitantes_registrados, label: '🚪 Visitantes',    color: 'var(--at-accent)' },
                { v: selected.cuotas_cobradas,        label: '💳 Cuotas',        color: 'var(--at-success)' },
                { v: selected.incidencias_atendidas,  label: '⚠️ Incidencias',  color: 'var(--at-warning)' },
              ].filter(x => x.v != null).map(k => (
                <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.v}</div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{k.label}</div>
                </div>
              ))}
            </div>
          )}

          {selected.resumen && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px' }}>RESUMEN</div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.6 }}>{selected.resumen}</div>
            </div>
          )}
          {selected.logros && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px' }}>LOGROS</div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{selected.logros}</div>
            </div>
          )}
          {selected.pendientes && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px' }}>PENDIENTES</div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{selected.pendientes}</div>
            </div>
          )}
        </EditModal>
      )}
    </div>
  )
}
