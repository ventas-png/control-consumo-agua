import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { MemoriaLabores, TipoPeriodo, EstadoMemoria } from '../../../types'
import Swal from 'sweetalert2'
import { notify } from '../../shared/Dialog'

interface Props {
  memorias: MemoriaLabores[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
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

export function MemoriaTab({ memorias, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [filtroTipo, setFiltroTipo] = useState<TipoPeriodo | 'todos'>('todos')
  const [selected, setSelected] = useState<MemoriaLabores | null>(null)
  const [form, setForm] = useState<Partial<MemoriaLabores>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = memorias.filter(m => filtroTipo === 'todos' || m.tipo_periodo === filtroTipo)
    .sort((a, b) => b.periodo.localeCompare(a.periodo))

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
    setEditId(m.id); setShowForm(true); setSelected(null)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

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
      ? await supabase.from('memoria_labores').update(payload).eq('id', editId)
      : await supabase.from('memoria_labores').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handlePublicar(id: string) {
    const { error } = await supabase.from('memoria_labores').update({ estado: 'publicado', publicado_por: userId || null }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar memoria?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: 'var(--at-danger)' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('memoria_labores').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    if (selected?.id === id) setSelected(null)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
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

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Memoria' : 'Nueva Memoria de Labores'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Título *</label>
              <input style={inputStyle} value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="ej. Informe Mensual Abril 2026" />
            </div>
            <div>
              <label style={labelStyle}>Período *</label>
              <input style={inputStyle} value={form.periodo ?? ''} onChange={e => setForm(f => ({ ...f, periodo: e.target.value }))} placeholder="2026-04 / 2026-Q1 / 2026" />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo_periodo ?? 'mensual'} onChange={e => setForm(f => ({ ...f, tipo_periodo: e.target.value as TipoPeriodo }))}>
                {TIPO_PERIODO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'borrador'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoMemoria }))}>
                <option value="borrador">Borrador</option>
                <option value="publicado">Publicado</option>
              </select>
            </div>
          </div>

          {/* Métricas */}
          <div style={{ marginTop: '12px', padding: '12px', background: 'var(--at-surface)', borderRadius: '8px', border: '1px solid var(--at-line)' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '10px' }}>MÉTRICAS DEL PERÍODO</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
              {[
                { key: 'tickets_resueltos' as const,       label: '🔧 Tickets resueltos' },
                { key: 'visitantes_registrados' as const,  label: '🚪 Visitantes registrados' },
                { key: 'cuotas_cobradas' as const,         label: '💳 Cuotas cobradas' },
                { key: 'incidencias_atendidas' as const,   label: '⚠️ Incidencias atendidas' },
              ].map(m => (
                <div key={m.key}>
                  <label style={labelStyle}>{m.label}</label>
                  <input style={inputStyle} type="number" min="0" value={form[m.key] ?? ''} onChange={e => setForm(f => ({ ...f, [m.key]: e.target.value ? Number(e.target.value) : undefined }))} />
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginTop: '12px' }}>
            <div>
              <label style={labelStyle}>Resumen ejecutivo</label>
              <textarea style={textareaStyle} value={form.resumen ?? ''} onChange={e => setForm(f => ({ ...f, resumen: e.target.value }))} placeholder="Resumen del período…" />
            </div>
            <div>
              <label style={labelStyle}>Logros destacados</label>
              <textarea style={textareaStyle} value={form.logros ?? ''} onChange={e => setForm(f => ({ ...f, logros: e.target.value }))} placeholder="• Logro 1&#10;• Logro 2" />
            </div>
            <div>
              <label style={labelStyle}>Pendientes / Próximos pasos</label>
              <textarea style={textareaStyle} value={form.pendientes ?? ''} onChange={e => setForm(f => ({ ...f, pendientes: e.target.value }))} placeholder="• Pendiente 1&#10;• Pendiente 2" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </div>
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

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay memorias de labores</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '280px 1fr' : '1fr', gap: '16px', alignItems: 'start' }}>
          {/* Lista */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.map(m => (
              <div key={m.id} onClick={() => setSelected(selected?.id === m.id ? null : m)}
                style={{ background: selected?.id === m.id ? 'var(--at-primary-soft)' : 'var(--at-surface)', border: `1.5px solid ${selected?.id === m.id ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)' }}>{m.titulo}</div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      📅 {m.periodo} · {TIPO_PERIODO.find(t => t.value === m.tipo_periodo)?.label}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: m.estado === 'publicado' ? 'var(--at-success-tint)' : 'var(--at-chip)', color: m.estado === 'publicado' ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>
                      {m.estado === 'publicado' ? '✅ Publicado' : '📝 Borrador'}
                    </span>
                  </div>
                </div>
                {m.estado === 'borrador' && canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => handlePublicar(m.id)} style={{ flex: 1, padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Publicar</button>
                    <button onClick={() => startEdit(m)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(m.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  </div>
                )}
                {m.estado === 'publicado' && canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleDelete(m.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Detalle */}
          {selected && (
            <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', position: 'sticky', top: '16px' }}>
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{selected.titulo}</h3>
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{selected.periodo} · {TIPO_PERIODO.find(t => t.value === selected.tipo_periodo)?.label}</div>
              </div>

              {/* Métricas */}
              {(selected.tickets_resueltos != null || selected.visitantes_registrados != null || selected.cuotas_cobradas != null || selected.incidencias_atendidas != null) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '16px' }}>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
