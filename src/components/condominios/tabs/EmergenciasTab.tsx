import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ContactoEmergencia, TipoContactoEmergencia } from '../../../types'
import Swal from 'sweetalert2'
import { ImportEmergenciasModal } from '../ImportEmergenciasModal'

interface Props {
  contactos: ContactoEmergencia[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPOS: { value: TipoContactoEmergencia; label: string; icon: string; color: string }[] = [
  { value: 'bomberos',       label: 'Bomberos',       icon: '🚒', color: '#ef4444' },
  { value: 'policia',        label: 'Policía',        icon: '🚔', color: '#102622' },
  { value: 'ambulancia',     label: 'Ambulancia',     icon: '🚑', color: '#dc2626' },
  { value: 'hospital',       label: 'Hospital',       icon: '🏥', color: '#102622' },
  { value: 'electricidad',   label: 'Electricidad',   icon: '⚡', color: '#d97706' },
  { value: 'agua',           label: 'Agua',           icon: '💧', color: '#1B3B36' },
  { value: 'gas',            label: 'Gas',            icon: '🔥', color: '#ea580c' },
  { value: 'administracion', label: 'Administración', icon: '🏢', color: '#9C5733' },
  { value: 'general',        label: 'General',        icon: '📞', color: '#7E9389' },
]

const blank = (): Partial<ContactoEmergencia> => ({
  nombre: '', tipo: 'general', telefono: '', telefono_alternativo: '',
  descripcion: '', disponible_24h: true, orden: 0, activo: true,
})

export function EmergenciasTab({ contactos, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [form, setForm] = useState<Partial<ContactoEmergencia>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroTipo, setFiltroTipo] = useState<TipoContactoEmergencia | 'todos'>('todos')
  const [showImportModal, setShowImportModal] = useState(false)

  const sorted = [...contactos]
    .filter(c => filtroTipo === 'todos' || c.tipo === filtroTipo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))

  const activos = contactos.filter(c => c.activo)

  function startEdit(c: ContactoEmergencia) {
    setForm({
      nombre: c.nombre, tipo: c.tipo, telefono: c.telefono,
      telefono_alternativo: c.telefono_alternativo ?? '',
      descripcion: c.descripcion ?? '', disponible_24h: c.disponible_24h,
      orden: c.orden, activo: c.activo,
    })
    setEditId(c.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.nombre?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre.', 'warning')
    if (!form.telefono?.trim()) return Swal.fire('Campo requerido', 'Ingresa el teléfono.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre!.trim(), tipo: form.tipo ?? 'general',
      telefono: form.telefono!.trim(), telefono_alternativo: form.telefono_alternativo || null,
      descripcion: form.descripcion || null, disponible_24h: form.disponible_24h ?? true,
      orden: form.orden ?? 0, activo: form.activo ?? true,
    }
    const { error } = editId
      ? await supabase.from('contactos_emergencia').update(payload).eq('id', editId)
      : await supabase.from('contactos_emergencia').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar contacto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('contactos_emergencia').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function toggleActivo(c: ContactoEmergencia) {
    const { error } = await supabase.from('contactos_emergencia').update({ activo: !c.activo }).eq('id', c.id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const tipoInfo = (t: TipoContactoEmergencia) => TIPOS.find(x => x.value === t) ?? TIPOS[TIPOS.length - 1]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#7E9389', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Directorio rápido — siempre visible arriba */}
      {activos.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%)', border: '1.5px solid #fca5a5', borderRadius: '12px', padding: '16px 20px', marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: '#991b1b', marginBottom: '12px' }}>🆘 Directorio de Emergencias</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
            {activos.slice(0, 8).map(c => {
              const ti = tipoInfo(c.tipo)
              return (
                <a key={c.id} href={`tel:${c.telefono}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: 'white', borderRadius: '8px', border: `1.5px solid ${ti.color}20`, textDecoration: 'none', cursor: 'pointer' }}>
                  <span style={{ fontSize: '22px' }}>{ti.icon}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#15291F' }}>{c.nombre}</div>
                    <div style={{ fontSize: '13px', color: ti.color, fontWeight: 700 }}>{c.telefono}</div>
                    {c.disponible_24h && <div style={{ fontSize: '10px', color: '#10b981', fontWeight: 600 }}>24h</div>}
                  </div>
                </a>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Gestión de Contactos</h2>
        {canCreate && !showForm && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setShowImportModal(true)} style={{ padding: '8px 14px', background: '#EEF2EC', color: '#102622', border: '1.5px solid #C2D2CA', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              ⬆ Carga masiva
            </button>
            <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Agregar Contacto
            </button>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Contacto' : 'Nuevo Contacto'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input style={inputStyle} value={form.nombre ?? ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Bomberos Voluntarios" />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'general'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoContactoEmergencia }))}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Teléfono principal *</label>
              <input style={inputStyle} value={form.telefono ?? ''} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} placeholder="122 / +502 0000-0000" />
            </div>
            <div>
              <label style={labelStyle}>Teléfono alternativo</label>
              <input style={inputStyle} value={form.telefono_alternativo ?? ''} onChange={e => setForm(f => ({ ...f, telefono_alternativo: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Orden (prioridad)</label>
              <input style={inputStyle} type="number" min="0" value={form.orden ?? 0} onChange={e => setForm(f => ({ ...f, orden: Number(e.target.value) }))} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#3E5A4C', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.disponible_24h ?? true} onChange={e => setForm(f => ({ ...f, disponible_24h: e.target.checked }))} />
                Disponible 24h
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#3E5A4C', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.activo ?? true} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} />
                Activo
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Notas o descripción adicional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtro por tipo */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroTipo('todos')}
          style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroTipo === 'todos' ? '#1B3B36' : '#E1DDD0', background: filtroTipo === 'todos' ? '#D9E2DC' : 'white', color: filtroTipo === 'todos' ? '#1B3B36' : '#7E9389' }}>
          Todos ({contactos.length})
        </button>
        {TIPOS.filter(t => contactos.some(c => c.tipo === t.value)).map(t => (
          <button key={t.value} onClick={() => setFiltroTipo(t.value)}
            style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroTipo === t.value ? t.color : '#E1DDD0', background: filtroTipo === t.value ? `${t.color}20` : 'white', color: filtroTipo === t.value ? t.color : '#7E9389' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📞</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay contactos de emergencia</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
          {sorted.map(c => {
            const ti = tipoInfo(c.tipo)
            return (
              <div key={c.id} style={{ background: c.activo ? 'white' : '#FAF7EF', border: `1.5px solid ${c.activo ? '#E1DDD0' : '#EAE6D8'}`, borderRadius: '10px', padding: '14px', opacity: c.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: `${ti.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', flexShrink: 0 }}>
                    {ti.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#15291F', fontSize: '13px' }}>{c.nombre}</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: ti.color, marginTop: '2px' }}>{c.telefono}</div>
                    {c.telefono_alternativo && <div style={{ fontSize: '12px', color: '#7E9389' }}>Alt: {c.telefono_alternativo}</div>}
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {c.disponible_24h && <span style={{ fontSize: '10px', fontWeight: 700, color: '#10b981', background: '#d1fae5', padding: '1px 6px', borderRadius: '4px' }}>24H</span>}
                      <span style={{ fontSize: '10px', fontWeight: 600, color: '#7E9389', background: '#EAE6D8', padding: '1px 6px', borderRadius: '4px' }}>{ti.label}</span>
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <button onClick={() => startEdit(c)} style={{ padding: '4px 6px', background: '#EAE6D8', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => toggleActivo(c)} style={{ padding: '4px 6px', background: c.activo ? '#fef3c7' : '#d1fae5', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }} title={c.activo ? 'Desactivar' : 'Activar'}>
                        {c.activo ? '⏸️' : '▶️'}
                      </button>
                      <button onClick={() => handleDelete(c.id)} style={{ padding: '4px 6px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
                {c.descripcion && <div style={{ marginTop: '8px', fontSize: '11px', color: '#7E9389', borderTop: '1px solid #EAE6D8', paddingTop: '6px' }}>{c.descripcion}</div>}
              </div>
            )
          })}
        </div>
      )}

      {showImportModal && (
        <ImportEmergenciasModal
          proyectoId={proyectoId}
          companyId={companyId}
          onClose={() => setShowImportModal(false)}
          onImportado={() => { setShowImportModal(false); onRefresh() }}
        />
      )}
    </div>
  )
}
