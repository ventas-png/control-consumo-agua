import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { BodegaCondominio, EstadoBodega, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  bodegas: BodegaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoBodega, { label: string; color: string; bg: string }> = {
  disponible: { label: 'Disponible', color: '#10b981', bg: '#d1fae5' },
  asignada:   { label: 'Asignada',   color: '#1B3B36', bg: '#D9E2DC' },
  bloqueada:  { label: 'Bloqueada',  color: '#7E9389', bg: '#EAE6D8' },
}

const blank = (): Partial<BodegaCondominio> => ({
  numero: '', piso: '', area_m2: undefined, unidad_id: undefined,
  estado: 'disponible', monto_renta: undefined, fecha_asignacion: '', notas: '',
})

export function BodegasTab({ bodegas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoBodega | 'todos'>('todos')
  const [form, setForm] = useState<Partial<BodegaCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = bodegas.filter(b => filtroEstado === 'todos' || b.estado === filtroEstado)
  const disponibles = bodegas.filter(b => b.estado === 'disponible').length
  const rentaTotal = bodegas.filter(b => b.estado === 'asignada' && b.monto_renta).reduce((s, b) => s + (b.monto_renta ?? 0), 0)

  function startEdit(b: BodegaCondominio) {
    setForm({
      numero: b.numero, piso: b.piso ?? '', area_m2: b.area_m2 ?? undefined,
      unidad_id: b.unidad_id ?? undefined, estado: b.estado,
      monto_renta: b.monto_renta ?? undefined, fecha_asignacion: b.fecha_asignacion ?? '', notas: b.notas ?? '',
    })
    setEditId(b.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.numero?.trim()) return Swal.fire('Campo requerido', 'Ingresa el número de bodega.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      numero: form.numero!.trim(), piso: form.piso || null,
      area_m2: form.area_m2 ?? null,
      unidad_id: form.unidad_id || null,
      estado: form.estado ?? 'disponible',
      monto_renta: form.monto_renta ?? null,
      fecha_asignacion: form.fecha_asignacion || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('bodegas_condominio').update(payload).eq('id', editId)
      : await supabase.from('bodegas_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar bodega?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('bodegas_condominio').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoBodega) {
    const updates: Partial<BodegaCondominio> = { estado }
    if (estado === 'disponible') { updates.unidad_id = null; updates.fecha_asignacion = null }
    if (estado === 'asignada') updates.fecha_asignacion = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('bodegas_condominio').update(updates).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#7E9389', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total bodegas', value: String(bodegas.length), icon: '🗄️', color: '#1B3B36' },
          { label: 'Disponibles', value: String(disponibles), icon: '✅', color: '#10b981' },
          { label: 'Asignadas', value: String(bodegas.filter(b => b.estado === 'asignada').length), icon: '🔑', color: '#B96A3F' },
          { label: 'Renta mensual', value: rentaTotal > 0 ? `${moneda} ${rentaTotal.toFixed(0)}` : '—', icon: '💰', color: '#f59e0b' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Bodegas / Almacenamiento</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Agregar Bodega</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Bodega' : 'Nueva Bodega'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Número *</label>
              <input style={inputStyle} value={form.numero ?? ''} onChange={e => setForm(f => ({ ...f, numero: e.target.value }))} placeholder="B-01" />
            </div>
            <div>
              <label style={labelStyle}>Piso / Nivel</label>
              <input style={inputStyle} value={form.piso ?? ''} onChange={e => setForm(f => ({ ...f, piso: e.target.value }))} placeholder="Sótano 1" />
            </div>
            <div>
              <label style={labelStyle}>Área (m²)</label>
              <input style={inputStyle} type="number" min="0" step="0.1" value={form.area_m2 ?? ''} onChange={e => setForm(f => ({ ...f, area_m2: e.target.value ? Number(e.target.value) : undefined }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'disponible'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoBodega }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unidad asignada</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin asignación</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Renta mensual ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_renta ?? ''} onChange={e => setForm(f => ({ ...f, monto_renta: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Fecha asignación</label>
              <input style={inputStyle} type="date" value={form.fecha_asignacion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_asignacion: e.target.value }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'disponible', 'asignada', 'bloqueada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#1B3B36' : '#E1DDD0',
              background: filtroEstado === e ? '#D9E2DC' : 'white',
              color: filtroEstado === e ? '#1B3B36' : '#7E9389' }}>
            {e === 'todos' ? `Todas (${bodegas.length})` : `${ESTADO_CONFIG[e as EstadoBodega]?.label} (${bodegas.filter(b => b.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🗄️</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay bodegas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {filtered.map(b => {
            const est = ESTADO_CONFIG[b.estado]
            return (
              <div key={b.id} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '18px', color: '#15291F' }}>🗄️ {b.numero}</div>
                    {b.piso && <div style={{ fontSize: '11px', color: '#7E9389' }}>{b.piso}</div>}
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: '#7E9389', marginBottom: '10px' }}>
                  {b.area_m2 && <div>📐 {b.area_m2} m²</div>}
                  {b.unidad_nombre && <div>🏠 {b.unidad_nombre}</div>}
                  {b.monto_renta && <div style={{ fontWeight: 600, color: '#15291F' }}>💰 {moneda} {b.monto_renta}/mes</div>}
                  {b.fecha_asignacion && <div>📅 Desde {b.fecha_asignacion}</div>}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {b.estado === 'disponible' && (
                      <button onClick={() => handleEstado(b.id, 'asignada')} style={{ flex: 1, padding: '4px 8px', background: '#D9E2DC', color: '#102622', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        Asignar
                      </button>
                    )}
                    {b.estado === 'asignada' && (
                      <button onClick={() => handleEstado(b.id, 'disponible')} style={{ flex: 1, padding: '4px 8px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                        Liberar
                      </button>
                    )}
                    <button onClick={() => startEdit(b)} style={{ padding: '4px 8px', background: '#EAE6D8', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(b.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
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
