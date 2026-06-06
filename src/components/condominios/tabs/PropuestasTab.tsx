import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { PropuestaInversion, CategoriaPropuesta, EstadoPropuesta, PrioridadPropuesta } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  propuestas: PropuestaInversion[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaPropuesta; label: string; icon: string }[] = [
  { value: 'mejora',       label: 'Mejora',       icon: '⬆️' },
  { value: 'reparacion',   label: 'Reparación',   icon: '🔨' },
  { value: 'expansion',    label: 'Expansión',    icon: '📐' },
  { value: 'tecnologia',   label: 'Tecnología',   icon: '💻' },
  { value: 'seguridad',    label: 'Seguridad',    icon: '🛡️' },
  { value: 'otro',         label: 'Otro',         icon: '📋' },
]

const PRIORIDAD_CONFIG: Record<PrioridadPropuesta, { label: string; color: string; bg: string }> = {
  baja:  { label: 'Baja',  color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
  media: { label: 'Media', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  alta:  { label: 'Alta',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const ESTADO_CONFIG: Record<EstadoPropuesta, { label: string; color: string; bg: string }> = {
  propuesta:     { label: 'Propuesta',     color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
  en_evaluacion: { label: 'En Evaluación', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  aprobada:      { label: 'Aprobada',      color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  rechazada:     { label: 'Rechazada',     color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
  en_ejecucion:  { label: 'En Ejecución',  color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  completada:    { label: 'Completada',    color: 'var(--at-ink)', bg: 'var(--at-line)' },
}

const blank = (): Partial<PropuestaInversion> => ({
  titulo: '', descripcion: '', categoria: 'mejora', monto_estimado: undefined,
  prioridad: 'media', estado: 'propuesta', fecha_propuesta: new Date().toISOString().slice(0, 10),
  votos_favor: 0, votos_contra: 0, notas: '',
})

export function PropuestasTab({ propuestas, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoPropuesta | 'todos'>('todos')
  const [form, setForm] = useState<Partial<PropuestaInversion>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = propuestas.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado)
    .sort((a, b) => {
      const prioOrden: Record<PrioridadPropuesta, number> = { alta: 0, media: 1, baja: 2 }
      return prioOrden[a.prioridad] - prioOrden[b.prioridad]
    })

  const montoTotal = propuestas.filter(p => p.estado === 'aprobada' || p.estado === 'en_ejecucion')
    .reduce((s, p) => s + (p.monto_estimado ?? 0), 0)

  function startEdit(p: PropuestaInversion) {
    setForm({
      titulo: p.titulo, descripcion: p.descripcion ?? '', categoria: p.categoria,
      monto_estimado: p.monto_estimado ?? undefined, prioridad: p.prioridad,
      estado: p.estado, fecha_propuesta: p.fecha_propuesta,
      fecha_aprobacion: p.fecha_aprobacion ?? '', fecha_ejecucion: p.fecha_ejecucion ?? '',
      votos_favor: p.votos_favor, votos_contra: p.votos_contra, notas: p.notas ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.titulo?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el título.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo!.trim(), descripcion: form.descripcion || null,
      categoria: form.categoria ?? 'mejora', monto_estimado: form.monto_estimado ?? null,
      prioridad: form.prioridad ?? 'media', estado: form.estado ?? 'propuesta',
      fecha_propuesta: form.fecha_propuesta!, votos_favor: form.votos_favor ?? 0,
      votos_contra: form.votos_contra ?? 0,
      fecha_aprobacion: form.fecha_aprobacion || null, fecha_ejecucion: form.fecha_ejecucion || null,
      propuesto_por: userId || null, notas: form.notas || null,
    }
    const { error } = editId
      ? await updateCondominioRow('propuestas_inversion', editId, payload)
      : await createCondominioRow('propuestas_inversion', payload)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleVoto(id: string, tipo: 'favor' | 'contra') {
    const p = propuestas.find(x => x.id === id)
    if (!p) return
    const upd = tipo === 'favor' ? { votos_favor: p.votos_favor + 1 } : { votos_contra: p.votos_contra + 1 }
    const { error } = await updateCondominioRow('propuestas_inversion', id, upd)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoPropuesta) {
    const updates: Partial<PropuestaInversion> = { estado }
    if (estado === 'aprobada') updates.fecha_aprobacion = new Date().toISOString().slice(0, 10)
    if (estado === 'en_ejecucion') updates.fecha_ejecucion = new Date().toISOString().slice(0, 10)
    const { error } = await updateCondominioRow('propuestas_inversion', id, updates)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar propuesta?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('propuestas_inversion', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const catInfo = (c: CategoriaPropuesta) => CATEGORIAS.find(x => x.value === c) ?? CATEGORIAS[CATEGORIAS.length - 1]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Propuestas de Inversión</h2>
          {montoTotal > 0 && <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Comprometido (aprobadas + ejecución): <strong style={{ color: 'var(--at-primary)' }}>{moneda} {montoTotal.toLocaleString()}</strong></span>}
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Propuesta</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Propuesta' : 'Nueva Propuesta'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Título *</label>
              <input style={inputStyle} value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título de la propuesta" />
            </div>
            <div>
              <label style={labelStyle}>Categoría</label>
              <select style={inputStyle} value={form.categoria ?? 'mejora'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaPropuesta }))}>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Prioridad</label>
              <select style={inputStyle} value={form.prioridad ?? 'media'} onChange={e => setForm(f => ({ ...f, prioridad: e.target.value as PrioridadPropuesta }))}>
                {Object.entries(PRIORIDAD_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'propuesta'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoPropuesta }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Monto estimado ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="100" value={form.monto_estimado ?? ''} onChange={e => setForm(f => ({ ...f, monto_estimado: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Fecha propuesta</label>
              <input style={inputStyle} type="date" value={form.fecha_propuesta ?? ''} onChange={e => setForm(f => ({ ...f, fecha_propuesta: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Votos a favor</label>
              <input style={inputStyle} type="number" min="0" value={form.votos_favor ?? 0} onChange={e => setForm(f => ({ ...f, votos_favor: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Votos en contra</label>
              <input style={inputStyle} type="number" min="0" value={form.votos_contra ?? 0} onChange={e => setForm(f => ({ ...f, votos_contra: Number(e.target.value) }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción detallada de la propuesta…" />
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
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroEstado('todos')} style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroEstado === 'todos' ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === 'todos' ? 'var(--at-primary-soft)' : 'var(--at-surface)', color: filtroEstado === 'todos' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
          Todas ({propuestas.length})
        </button>
        {(Object.entries(ESTADO_CONFIG) as [EstadoPropuesta, typeof ESTADO_CONFIG[EstadoPropuesta]][]).map(([k, v]) => {
          const cnt = propuestas.filter(p => p.estado === k).length
          if (cnt === 0) return null
          return (
            <button key={k} onClick={() => setFiltroEstado(k)} style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroEstado === k ? v.color : 'var(--at-line)', background: filtroEstado === k ? v.bg : 'var(--at-surface)', color: filtroEstado === k ? v.color : 'var(--at-ink-3)' }}>
              {v.label} ({cnt})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>💡</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay propuestas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(p => {
            const cat = catInfo(p.categoria)
            const prio = PRIORIDAD_CONFIG[p.prioridad]
            const est = ESTADO_CONFIG[p.estado]
            const totalVotos = p.votos_favor + p.votos_contra
            return (
              <div key={p.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '18px' }}>{cat.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{p.titulo}</span>
                      <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: prio.bg, color: prio.color }}>{prio.label}</span>
                      <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                    </div>
                    {p.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px' }}>{p.descripcion}</div>}
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                      {p.fecha_propuesta}
                      {p.monto_estimado && <span style={{ marginLeft: '8px', fontWeight: 600, color: 'var(--at-ink)' }}>{moneda} {p.monto_estimado.toLocaleString()}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {canEdit && (
                      <select value={p.estado} onChange={e => handleEstado(p.id, e.target.value as EstadoPropuesta)}
                        style={{ padding: '4px 8px', border: '1.5px solid var(--at-line)', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: est.color, background: 'var(--at-surface)', cursor: 'pointer' }}>
                        {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    )}
                    {canEdit && <button onClick={() => startEdit(p)} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                    {canEdit && <button onClick={() => handleDelete(p.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>}
                  </div>
                </div>

                {/* Votación */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => handleVoto(p.id, 'favor')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', background: 'var(--at-success-tint)', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--at-success-strong)', cursor: 'pointer' }}>
                    👍 {p.votos_favor}
                  </button>
                  <button onClick={() => handleVoto(p.id, 'contra')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, color: 'var(--at-danger)', cursor: 'pointer' }}>
                    👎 {p.votos_contra}
                  </button>
                  {totalVotos > 0 && (
                    <div style={{ flex: 1, height: '6px', background: 'var(--at-danger-tint)', borderRadius: '3px', overflow: 'hidden', maxWidth: '120px' }}>
                      <div style={{ height: '100%', width: `${(p.votos_favor / totalVotos) * 100}%`, background: 'var(--at-success)', borderRadius: '3px' }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
