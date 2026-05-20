import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { PlantillaTareaCargo, AreaCondominio } from '../../../types'

interface Props {
  plantillas: PlantillaTareaCargo[]
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ICONOS = ['✅','🧹','🔧','🌿','💡','🚿','🪟','🚪','🏊','🗑','🧴','🔑','📦','🛗','⚡','💧','🖨','🪣','🧽','🔐','📋','🏋️','🎭','🌊','🛠']

function blankForm() {
  return { cargo: '', titulo: '', descripcion: '', icono: '✅', orden: 0, area_id: '', requiere_foto: false }
}

export function PlantillasCargoTab({ plantillas, areas, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(blankForm())
  const [filtroCargo, setFiltroCargo] = useState<string>('todos')

  const cargos = Array.from(new Set(plantillas.map(p => p.cargo))).sort()
  const filtradas = filtroCargo === 'todos'
    ? plantillas.sort((a, b) => a.cargo.localeCompare(b.cargo) || a.orden - b.orden)
    : plantillas.filter(p => p.cargo === filtroCargo).sort((a, b) => a.orden - b.orden)

  const cargosPorGrupo = Array.from(
    filtradas.reduce((m, p) => { m.set(p.cargo, [...(m.get(p.cargo) ?? []), p]); return m }, new Map<string, PlantillaTareaCargo[]>())
  )

  function startEdit(p: PlantillaTareaCargo) {
    setEditId(p.id)
    setForm({ cargo: p.cargo, titulo: p.titulo, descripcion: p.descripcion ?? '', icono: p.icono, orden: p.orden, area_id: p.area_id ?? '', requiere_foto: p.requiere_foto })
    setShowForm(true)
  }

  function resetForm() { setForm(blankForm()); setEditId(null); setShowForm(false) }

  async function save() {
    if (!form.cargo.trim()) { Swal.fire('Error', 'Ingrese el cargo.', 'error'); return }
    if (!form.titulo.trim()) { Swal.fire('Error', 'Ingrese el título de la tarea.', 'error'); return }
    setSaving(true)
    const payload = {
      cargo: form.cargo.trim(),
      titulo: form.titulo.trim(),
      descripcion: form.descripcion.trim() || null,
      icono: form.icono,
      orden: form.orden,
      area_id: form.area_id || null,
      requiere_foto: form.requiere_foto,
    }
    if (editId) {
      const { error } = await supabase.from('plantillas_tarea_cargo').update(payload).eq('id', editId)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { error } = await supabase.from('plantillas_tarea_cargo').insert({ ...payload, company_id: companyId, project_id: proyectoId })
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    }
    setSaving(false); resetForm(); onRefresh()
  }

  async function deletePlantilla(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar plantilla?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('plantillas_tarea_cargo').delete().eq('id', id)
    onRefresh()
  }

  async function toggleActivo(p: PlantillaTareaCargo) {
    await supabase.from('plantillas_tarea_cargo').update({ activo: !p.activo }).eq('id', p.id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Plantillas de tareas por cargo</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {plantillas.filter(p => p.activo).length} activas · {cargos.length} cargo{cargos.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => { resetForm(); setShowForm(true) }}
            style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            + Nueva plantilla
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editId ? 'Editar plantilla' : 'Nueva plantilla de tarea'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Cargo *</label>
              <input value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))} placeholder="Ej. Limpieza, Mantenimiento, Jardinería..."
                list="cargos-list"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              <datalist id="cargos-list">
                {cargos.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Título de la tarea *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Limpiar lobby, Revisar bomba..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Ícono</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1.5px solid var(--at-line)' }}>
                {ICONOS.map(ic => (
                  <button key={ic} onClick={() => setForm(f => ({ ...f, icono: ic }))}
                    style={{ width: '34px', height: '34px', fontSize: '18px', borderRadius: '7px', border: '2px solid', borderColor: form.icono === ic ? '#f59e0b' : 'transparent', background: form.icono === ic ? '#fef3c7' : 'transparent', cursor: 'pointer' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Área (opcional)</label>
                <select value={form.area_id} onChange={e => setForm(f => ({ ...f, area_id: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                  <option value="">Sin área específica</option>
                  {areas.filter(a => a.activo).sort((a, b) => a.orden - b.orden).map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Orden</label>
                <input type="number" value={form.orden} onChange={e => setForm(f => ({ ...f, orden: parseInt(e.target.value) || 0 }))} min={0}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.requiere_foto} onChange={e => setForm(f => ({ ...f, requiere_foto: e.target.checked }))} />
                Requiere foto como evidencia
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción / instrucciones</label>
              <textarea value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle de cómo realizar la tarea..." rows={2}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={save} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Filtro por cargo */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {(['todos', ...cargos] as string[]).map(c => (
          <button key={c} onClick={() => setFiltroCargo(c)}
            style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', border: 'none',
              background: filtroCargo === c ? '#fef3c7' : 'var(--at-chip)', color: filtroCargo === c ? '#d97706' : 'var(--at-ink-3)' }}>
            {c === 'todos' ? `Todos (${plantillas.length})` : `${c} (${plantillas.filter(p => p.cargo === c).length})`}
          </button>
        ))}
      </div>

      {plantillas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📋</div>
          <p style={{ fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Sin plantillas</p>
          <p style={{ fontSize: '13px' }}>Crea tareas predefinidas por cargo para asignar rápidamente al crear bloques de turno.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {cargosPorGrupo.map(([cargo, tareas]) => (
            <div key={cargo}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontWeight: 800, fontSize: '14px', color: '#92400e', background: '#fef3c7', padding: '4px 12px', borderRadius: '20px' }}>
                  {cargo}
                </span>
                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{tareas.length} tarea{tareas.length !== 1 ? 's' : ''}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                {tareas.map(p => {
                  const areaNombre = areas.find(a => a.id === p.area_id)?.nombre
                  return (
                    <div key={p.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${p.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '12px', padding: '14px', opacity: p.activo ? 1 : 0.55 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <span style={{ fontSize: '24px', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef3c7', borderRadius: '9px', flexShrink: 0 }}>{p.icono}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-ink)' }}>{p.titulo}</div>
                          {p.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{p.descripcion}</div>}
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '5px' }}>
                            {areaNombre && <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>📍 {areaNombre}</span>}
                            {p.requiere_foto && <span style={{ fontSize: '11.5px', color: 'var(--at-accent-hover)' }}>📷 Requiere foto</span>}
                            <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>#{p.orden}</span>
                          </div>
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                          <button onClick={() => startEdit(p)} style={{ flex: 1, padding: '5px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>
                          <button onClick={() => toggleActivo(p)} style={{ padding: '5px 10px', background: p.activo ? '#fef9c3' : '#f0fdf4', border: `1px solid ${p.activo ? '#fde047' : '#86efac'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: p.activo ? '#92400e' : '#16a34a' }}>
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button onClick={() => deletePlantilla(p.id)} style={{ padding: '5px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: '#dc2626' }}>🗑</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
