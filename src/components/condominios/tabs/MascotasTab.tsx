import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Mascota, Unidad, EspecieMascota } from '../../../types'
import { ImageUploader } from '../ImageUploader'
import { SecureImage } from '../../shared/SecureImage'

interface Props {
  mascotas: Mascota[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESPECIE_ICON: Record<EspecieMascota, string> = { perro: '🐕', gato: '🐈', ave: '🦜', otro: '🐾' }

export function MascotasTab({ mascotas, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEspecie, setFiltroEspecie] = useState<EspecieMascota | 'todos'>('todos')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [form, setForm] = useState({
    unidad_id: '', nombre: '', especie: 'perro' as EspecieMascota,
    raza: '', color: '', fecha_nacimiento: '', fecha_ultima_vacuna: '', notas: '',
  })

  const hoy = new Date().toISOString().slice(0, 10)

  const filtradas = mascotas.filter(m => {
    const matchEspecie = filtroEspecie === 'todos' || m.especie === filtroEspecie
    const matchBusqueda = !busqueda ||
      m.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      (m.raza || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (m.unidad_nombre || '').toLowerCase().includes(busqueda.toLowerCase())
    return matchEspecie && matchBusqueda && m.activo
  })

  // Alert for overdue vaccines (>1 year)
  const vencidasVacuna = mascotas.filter(m => {
    if (!m.fecha_ultima_vacuna || !m.activo) return false
    const diff = (new Date(hoy).getTime() - new Date(m.fecha_ultima_vacuna).getTime()) / (1000 * 60 * 60 * 24)
    return diff > 365
  })

  function resetForm() {
    setForm({ unidad_id: '', nombre: '', especie: 'perro', raza: '', color: '', fecha_nacimiento: '', fecha_ultima_vacuna: '', notas: '' })
    setFotoUrl(null)
    setShowForm(false); setEditingId(null)
  }

  function startEdit(m: Mascota) {
    setForm({
      unidad_id: m.unidad_id, nombre: m.nombre, especie: m.especie,
      raza: m.raza ?? '', color: m.color ?? '',
      fecha_nacimiento: m.fecha_nacimiento ?? '', fecha_ultima_vacuna: m.fecha_ultima_vacuna ?? '',
      notas: m.notas ?? '',
    })
    setFotoUrl(m.foto_url ?? null)
    setEditingId(m.id); setShowForm(true)
  }

  async function handleGuardar() {
    if (!form.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre de la mascota.', 'error'); return }
    if (!form.unidad_id) { Swal.fire('Error', 'Seleccione la unidad.', 'error'); return }
    setSaving(true)
    const data = {
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      nombre: form.nombre.trim(), especie: form.especie,
      raza: form.raza.trim() || null, color: form.color.trim() || null,
      fecha_nacimiento: form.fecha_nacimiento || null, fecha_ultima_vacuna: form.fecha_ultima_vacuna || null,
      notas: form.notas.trim() || null,
      foto_url: fotoUrl,
    }
    const { error } = editingId
      ? await supabase.from('mascotas').update(data).eq('id', editingId)
      : await supabase.from('mascotas').insert(data)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: editingId ? 'Mascota actualizada' : 'Mascota registrada', timer: 1400, showConfirmButton: false })
    resetForm(); onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar mascota?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('mascotas').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Mascotas</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>{mascotas.filter(m => m.activo).length} registradas</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar mascota
          </button>
        )}
      </div>

      {/* Vacunas vencidas */}
      {vencidasVacuna.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13.5px', color: '#92400e', fontWeight: 600 }}>
            {vencidasVacuna.length} mascota{vencidasVacuna.length > 1 ? 's' : ''} con vacuna vencida (más de 1 año): {vencidasVacuna.map(m => m.nombre).join(', ')}
          </span>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar mascota, raza, unidad..."
          style={{ flex: 1, minWidth: '180px', padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13.5px', background: '#f8fafc' }} />
        {(['todos', 'perro', 'gato', 'ave', 'otro'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEspecie(e)}
            style={{ padding: '7px 13px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEspecie === e ? '#0ea5e9' : '#e2e8f0', background: filtroEspecie === e ? '#eff6ff' : 'white', color: filtroEspecie === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? 'Todas' : `${ESPECIE_ICON[e]} ${e.charAt(0).toUpperCase() + e.slice(1)}`}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editingId ? 'Editar mascota' : 'Registrar mascota'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre de la mascota"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Especie</label>
              <select value={form.especie} onChange={e => setForm(f => ({ ...f, especie: e.target.value as EspecieMascota }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="perro">🐕 Perro</option>
                <option value="gato">🐈 Gato</option>
                <option value="ave">🦜 Ave</option>
                <option value="otro">🐾 Otro</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Raza</label>
              <input value={form.raza} onChange={e => setForm(f => ({ ...f, raza: e.target.value }))} placeholder="Ej. Labrador"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Color</label>
              <input value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="Ej. Café"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha nacimiento</label>
              <input type="date" value={form.fecha_nacimiento} onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Última vacuna</label>
              <input type="date" value={form.fecha_ultima_vacuna} onChange={e => setForm(f => ({ ...f, fecha_ultima_vacuna: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="mascotas" label="Foto de la mascota" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🐾</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>No hay mascotas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {filtradas.map(m => {
            const vacunaDays = m.fecha_ultima_vacuna
              ? Math.floor((new Date(hoy).getTime() - new Date(m.fecha_ultima_vacuna).getTime()) / (1000 * 60 * 60 * 24))
              : null
            const vacunaVencida = vacunaDays !== null && vacunaDays > 365
            return (
              <div key={m.id} style={{ background: 'white', border: `1.5px solid ${vacunaVencida ? '#fde68a' : '#e2e8f0'}`, borderRadius: '14px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  {m.foto_url
                    ? <SecureImage src={m.foto_url} alt={m.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0', flexShrink: 0 }} />
                    : <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>
                        {ESPECIE_ICON[m.especie]}
                      </div>
                  }
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a' }}>{m.nombre}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{m.especie}{m.raza ? ` · ${m.raza}` : ''}</div>
                  </div>
                </div>
                <div style={{ fontSize: '12.5px', color: '#374151', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  {m.unidad_nombre && <span>📍 {m.unidad_nombre}</span>}
                  {m.color && <span>🎨 {m.color}</span>}
                  {m.fecha_ultima_vacuna && (
                    <span style={{ color: vacunaVencida ? '#dc2626' : '#16a34a', fontWeight: vacunaVencida ? 700 : 400 }}>
                      💉 Vacuna: {m.fecha_ultima_vacuna} {vacunaVencida ? '⚠️ Vencida' : ''}
                    </span>
                  )}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                    <button onClick={() => startEdit(m)} style={{ flex: 1, padding: '6px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: '#374151' }}>✏️ Editar</button>
                    <button onClick={() => eliminar(m.id)} style={{ padding: '6px 10px', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '14px' }}>🗑</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
