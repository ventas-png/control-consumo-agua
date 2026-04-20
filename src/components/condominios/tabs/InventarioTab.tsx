import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { ItemInventario, CategoriaInventario, EstadoInventario } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  inventario: ItemInventario[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaInventario; label: string; icon: string }[] = [
  { value: 'herramienta',  label: 'Herramienta',  icon: '🔨' },
  { value: 'equipo',       label: 'Equipo',        icon: '⚙️' },
  { value: 'material',     label: 'Material',      icon: '📦' },
  { value: 'mobiliario',   label: 'Mobiliario',    icon: '🪑' },
  { value: 'vehiculo',     label: 'Vehículo',      icon: '🚗' },
  { value: 'otro',         label: 'Otro',          icon: '📋' },
]

const ESTADO_CONFIG: Record<EstadoInventario, { label: string; color: string; bg: string }> = {
  disponible:    { label: 'Disponible',    color: '#10b981', bg: '#d1fae5' },
  en_uso:        { label: 'En Uso',        color: '#0ea5e9', bg: '#e0f2fe' },
  en_reparacion: { label: 'En Reparación', color: '#f59e0b', bg: '#fef3c7' },
  dado_de_baja:  { label: 'Baja',          color: '#64748b', bg: '#f1f5f9' },
}

const blank = (): Partial<ItemInventario> => ({
  nombre: '', categoria: 'herramienta', descripcion: '', numero_serie: '',
  ubicacion: '', estado: 'disponible', cantidad: 1, cantidad_minima: 0,
  unidad_medida: 'unidad', costo_unitario: undefined,
  proveedor: '', fecha_adquisicion: '', fecha_vencimiento: '', notas: '',
})

export function InventarioTab({ inventario, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaInventario | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoInventario | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [form, setForm] = useState<Partial<ItemInventario>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const stockBajo = inventario.filter(i => i.cantidad <= i.cantidad_minima && i.estado !== 'dado_de_baja')
  const porVencer = inventario.filter(i => i.fecha_vencimiento && i.fecha_vencimiento >= hoy &&
    new Date(i.fecha_vencimiento).getTime() - Date.now() < 30 * 24 * 3600 * 1000 && i.estado !== 'dado_de_baja')

  const filtered = inventario.filter(i => {
    if (filtroCategoria !== 'todos' && i.categoria !== filtroCategoria) return false
    if (filtroEstado !== 'todos' && i.estado !== filtroEstado) return false
    if (busqueda && !i.nombre.toLowerCase().includes(busqueda.toLowerCase()) &&
      !(i.ubicacion ?? '').toLowerCase().includes(busqueda.toLowerCase())) return false
    return true
  })

  const valorTotal = filtered
    .filter(i => i.estado !== 'dado_de_baja')
    .reduce((s, i) => s + (i.costo_unitario ?? 0) * i.cantidad, 0)

  function startEdit(i: ItemInventario) {
    setForm({
      nombre: i.nombre, categoria: i.categoria, descripcion: i.descripcion ?? '',
      numero_serie: i.numero_serie ?? '', ubicacion: i.ubicacion ?? '',
      estado: i.estado, cantidad: i.cantidad, cantidad_minima: i.cantidad_minima,
      unidad_medida: i.unidad_medida, costo_unitario: i.costo_unitario ?? undefined,
      proveedor: i.proveedor ?? '', fecha_adquisicion: i.fecha_adquisicion ?? '',
      fecha_vencimiento: i.fecha_vencimiento ?? '', notas: i.notas ?? '',
    })
    setEditId(i.id)
    setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.nombre?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre del item.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre!.trim(), categoria: form.categoria ?? 'herramienta',
      descripcion: form.descripcion || null, numero_serie: form.numero_serie || null,
      ubicacion: form.ubicacion || null, estado: form.estado ?? 'disponible',
      cantidad: form.cantidad ?? 1, cantidad_minima: form.cantidad_minima ?? 0,
      unidad_medida: form.unidad_medida ?? 'unidad',
      costo_unitario: form.costo_unitario ?? null,
      proveedor: form.proveedor || null,
      fecha_adquisicion: form.fecha_adquisicion || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('inventario_condominio').update(payload).eq('id', editId)
      : await supabase.from('inventario_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar item?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('inventario_condominio').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoInventario) {
    const { error } = await supabase.from('inventario_condominio').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const catInfo = (c: CategoriaInventario) => CATEGORIAS.find(x => x.value === c) ?? CATEGORIAS[CATEGORIAS.length - 1]

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* Alertas */}
      {stockBajo.length > 0 && (
        <div style={{ background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13px', color: '#991b1b', fontWeight: 600 }}>
            {stockBajo.length} item{stockBajo.length > 1 ? 's' : ''} con stock bajo o agotado
          </span>
        </div>
      )}
      {porVencer.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>📅</span>
          <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>
            {porVencer.length} item{porVencer.length > 1 ? 's' : ''} por vencer en menos de 30 días
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Inventario</h2>
          {valorTotal > 0 && <span style={{ fontSize: '12px', color: '#64748b' }}>Valor en inventario activo: <strong style={{ color: '#0ea5e9' }}>{moneda} {valorTotal.toFixed(2)}</strong></span>}
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Agregar Item
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{editId ? 'Editar Item' : 'Nuevo Item'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input style={inputStyle} value={form.nombre ?? ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del item" />
            </div>
            <div>
              <label style={labelStyle}>Categoría</label>
              <select style={inputStyle} value={form.categoria ?? 'herramienta'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaInventario }))}>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoInventario }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cantidad</label>
              <input style={inputStyle} type="number" min="0" value={form.cantidad ?? 1} onChange={e => setForm(f => ({ ...f, cantidad: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Stock mínimo</label>
              <input style={inputStyle} type="number" min="0" value={form.cantidad_minima ?? 0} onChange={e => setForm(f => ({ ...f, cantidad_minima: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_medida ?? 'unidad'} onChange={e => setForm(f => ({ ...f, unidad_medida: e.target.value }))}>
                {['unidad', 'kg', 'litro', 'metro', 'caja'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Costo unitario ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.costo_unitario ?? ''} onChange={e => setForm(f => ({ ...f, costo_unitario: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Ubicación</label>
              <input style={inputStyle} value={form.ubicacion ?? ''} onChange={e => setForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder="ej. Cuarto de utilidades" />
            </div>
            <div>
              <label style={labelStyle}>No. de serie</label>
              <input style={inputStyle} value={form.numero_serie ?? ''} onChange={e => setForm(f => ({ ...f, numero_serie: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Proveedor</label>
              <input style={inputStyle} value={form.proveedor ?? ''} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha adquisición</label>
              <input style={inputStyle} type="date" value={form.fecha_adquisicion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_adquisicion: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha vencimiento</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento ?? ''} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción / Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '56px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por nombre o ubicación…"
          style={{ padding: '6px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: '#f8fafc', minWidth: '200px' }} />
        <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaInventario | 'todos')}
          style={{ padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', background: '#f8fafc' }}>
          <option value="todos">Todas las categorías</option>
          {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoInventario | 'todos')}
          style={{ padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', background: '#f8fafc' }}>
          <option value="todos">Todos los estados</option>
          {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{filtered.length} items</span>
      </div>

      {/* Grid de items */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay items en el inventario</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {filtered.map(item => {
            const cat = catInfo(item.categoria)
            const est = ESTADO_CONFIG[item.estado]
            const stockAlerta = item.cantidad <= item.cantidad_minima && item.estado !== 'dado_de_baja'
            const venceProx = item.fecha_vencimiento && item.fecha_vencimiento >= hoy &&
              new Date(item.fecha_vencimiento).getTime() - Date.now() < 30 * 24 * 3600 * 1000
            return (
              <div key={item.id} style={{ background: 'white', border: `1.5px solid ${stockAlerta ? '#fca5a5' : '#e2e8f0'}`, borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '18px' }}>{cat.icon}</span>
                      <span style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>{item.nombre}</span>
                    </div>
                    {item.ubicacion && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>📍 {item.ubicacion}</div>}
                  </div>
                  <span style={{ padding: '3px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                    {est.label}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '12px', fontSize: '13px' }}>
                  <div>
                    <span style={{ color: stockAlerta ? '#ef4444' : '#0f172a', fontWeight: 700 }}>{item.cantidad}</span>
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}> {item.unidad_medida}</span>
                  </div>
                  {item.costo_unitario != null && (
                    <div style={{ color: '#64748b', fontSize: '12px' }}>{moneda} {item.costo_unitario.toFixed(2)}/u</div>
                  )}
                </div>

                {stockAlerta && (
                  <div style={{ fontSize: '11px', background: '#fee2e2', color: '#ef4444', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                    Stock bajo (mín: {item.cantidad_minima})
                  </div>
                )}
                {venceProx && (
                  <div style={{ fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                    Vence: {item.fecha_vencimiento}
                  </div>
                )}

                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                    {item.estado === 'disponible' && (
                      <button onClick={() => handleEstado(item.id, 'en_uso')} style={{ flex: 1, padding: '4px 8px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        En Uso
                      </button>
                    )}
                    {item.estado === 'en_uso' && (
                      <button onClick={() => handleEstado(item.id, 'disponible')} style={{ flex: 1, padding: '4px 8px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        Disponible
                      </button>
                    )}
                    <button onClick={() => startEdit(item)} style={{ padding: '4px 8px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(item.id)} style={{ padding: '4px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
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
