import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { VehiculoResidente } from '../../../types'
import type { Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  vehiculos: VehiculoResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABEL: Record<string, string> = { auto: 'Auto', moto: 'Moto', camion: 'Camión', otro: 'Otro' }
const TIPO_COLOR: Record<string, { bg: string; color: string }> = {
  auto:   { bg: '#D9E2DC', color: '#102622' },
  moto:   { bg: '#fef3c7', color: '#92400e' },
  camion: { bg: '#F4EBE3', color: '#9C5733' },
  otro:   { bg: '#EAE6D8', color: '#7E9389' },
}

const BLANK = { unidad_id: '', placa: '', marca: '', modelo: '', color: '', anio: '', tipo: 'auto', activo: true, notas: '' }

export function VehiculosTab({ vehiculos, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [soloActivos, setSoloActivos] = useState(true)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(v: VehiculoResidente) {
    setEditId(v.id)
    setForm({ unidad_id: v.unidad_id, placa: v.placa, marca: v.marca ?? '', modelo: v.modelo ?? '', color: v.color ?? '', anio: v.anio ? String(v.anio) : '', tipo: v.tipo, activo: v.activo, notas: v.notas ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.placa.trim()) return Swal.fire('Requerido', 'La placa es obligatoria.', 'warning')
    if (!form.unidad_id) return Swal.fire('Requerido', 'Seleccione una unidad.', 'warning')
    setSaving(true)
    const payload = {
      unidad_id: form.unidad_id, placa: form.placa.trim().toUpperCase(),
      marca: form.marca || null, modelo: form.modelo || null, color: form.color || null,
      anio: form.anio ? parseInt(form.anio) : null, tipo: form.tipo,
      activo: form.activo, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('vehiculos_residentes').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('vehiculos_residentes').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar vehículo?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('vehiculos_residentes').delete().eq('id', id)
    onRefresh()
  }

  async function toggleActivo(v: VehiculoResidente) {
    await supabase.from('vehiculos_residentes').update({ activo: !v.activo }).eq('id', v.id)
    onRefresh()
  }

  let filtered = vehiculos
  if (filtroUnidad) filtered = filtered.filter(v => v.unidad_id === filtroUnidad)
  if (filtroTipo !== 'todos') filtered = filtered.filter(v => v.tipo === filtroTipo)
  if (soloActivos) filtered = filtered.filter(v => v.activo)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }

  const totalActivos = vehiculos.filter(v => v.activo).length

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Vehículos de Residentes</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#7E9389' }}>{totalActivos} vehículos activos registrados</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Vehículo
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(TIPO_LABEL).map(([tipo, label]) => {
          const count = vehiculos.filter(v => v.tipo === tipo && v.activo).length
          const style = TIPO_COLOR[tipo]
          return (
            <div key={tipo} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '22px', fontWeight: 800, color: style.color }}>{count}</div>
              <div style={{ fontSize: '11px', color: '#7E9389' }}>{label}s</div>
            </div>
          )
        })}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar vehículo' : 'Registrar Vehículo'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Placa *</label>
              <input style={inputStyle} value={form.placa} onChange={e => setF('placa', e.target.value)} placeholder="ABC-1234" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Marca</label>
              <input style={inputStyle} value={form.marca} onChange={e => setF('marca', e.target.value)} placeholder="Toyota, Honda…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Modelo</label>
              <input style={inputStyle} value={form.modelo} onChange={e => setF('modelo', e.target.value)} placeholder="Corolla, Civic…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Color</label>
              <input style={inputStyle} value={form.color} onChange={e => setF('color', e.target.value)} placeholder="Blanco, Negro…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Año</label>
              <input style={inputStyle} type="number" value={form.anio} onChange={e => setF('anio', e.target.value)} placeholder="2023" min="1990" max="2030" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.activo ? 'true' : 'false'} onChange={e => setF('activo', e.target.value === 'true')}>
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones adicionales…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 'auto' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <select style={{ ...inputStyle, width: 'auto' }} value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label style={{ fontSize: '12px', color: '#7E9389', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo activos
        </label>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389', fontSize: '13px' }}>No hay vehículos registrados.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
          {filtered.map(v => {
            const unidad = unidades.find(u => u.id === v.unidad_id)
            const tc = TIPO_COLOR[v.tipo] ?? TIPO_COLOR.otro
            return (
              <div key={v.id} style={{ background: 'white', border: `1.5px solid ${v.activo ? '#E1DDD0' : '#EAE6D8'}`, borderRadius: '10px', padding: '12px', opacity: v.activo ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 800, fontSize: '15px', letterSpacing: '1px', color: '#15291F' }}>{v.placa}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: tc.bg, color: tc.color }}>{TIPO_LABEL[v.tipo]}</span>
                      {!v.activo && <span style={{ fontSize: '10px', padding: '2px 6px', background: '#EAE6D8', color: '#7E9389', borderRadius: '20px' }}>Inactivo</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: '#3E5A4C' }}>
                      {[v.anio, v.marca, v.modelo].filter(Boolean).join(' · ')}
                    </div>
                    {v.color && <div style={{ fontSize: '11px', color: '#7E9389' }}>Color: {v.color}</div>}
                    {unidad && <div style={{ fontSize: '11px', color: '#1B3B36', marginTop: '3px' }}>🏠 {unidad.nombre}</div>}
                    {v.notas && <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px', fontStyle: 'italic' }}>{v.notas}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <button onClick={() => toggleActivo(v)}
                        style={{ padding: '3px 7px', background: v.activo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', color: v.activo ? '#ef4444' : '#16a34a' }}>
                        {v.activo ? 'Desactivar' : 'Activar'}
                      </button>
                      <button onClick={() => startEdit(v)}
                        style={{ padding: '3px 7px', background: '#FAF7EF', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(v.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
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
