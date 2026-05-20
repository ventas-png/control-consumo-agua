import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { LlaveCondominio, EstadoLlave, TipoLlave, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  llaves: LlaveCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoLlave, { label: string; color: string; bg: string }> = {
  activa:   { label: 'Activa',    color: '#10b981', bg: '#d1fae5' },
  devuelta: { label: 'Devuelta',  color: '#7E9389', bg: '#EAE6D8' },
  perdida:  { label: 'Perdida',   color: '#ef4444', bg: '#fee2e2' },
  bloqueada:{ label: 'Bloqueada', color: '#f59e0b', bg: '#fef3c7' },
}

const TIPO_CONFIG: Record<TipoLlave, { label: string; icon: string }> = {
  fisica:  { label: 'Llave física', icon: '🔑' },
  tarjeta: { label: 'Tarjeta',      icon: '💳' },
  codigo:  { label: 'Código',       icon: '🔢' },
  app:     { label: 'App / Digital',icon: '📱' },
}

const blank = (): Partial<LlaveCondominio> => ({
  unidad_id: undefined, tipo: 'fisica', descripcion: '', codigo: '',
  cantidad: 1, fecha_entrega: '', fecha_devolucion: '',
  estado: 'activa', deposito_pagado: false, monto_deposito: undefined, notas: '',
})

export function LlavesTab({ llaves, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoLlave | 'todos'>('todos')
  const [form, setForm] = useState<Partial<LlaveCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = llaves.filter(l => filtroEstado === 'todos' || l.estado === filtroEstado)
  const activas   = llaves.filter(l => l.estado === 'activa').length
  const perdidas  = llaves.filter(l => l.estado === 'perdida').length
  const depositoTotal = llaves.filter(l => l.deposito_pagado && l.estado === 'activa').reduce((s, l) => s + (l.monto_deposito ?? 0), 0)

  function startEdit(l: LlaveCondominio) {
    setForm({
      unidad_id: l.unidad_id ?? undefined, tipo: l.tipo, descripcion: l.descripcion,
      codigo: l.codigo ?? '', cantidad: l.cantidad, fecha_entrega: l.fecha_entrega ?? '',
      fecha_devolucion: l.fecha_devolucion ?? '', estado: l.estado,
      deposito_pagado: l.deposito_pagado, monto_deposito: l.monto_deposito ?? undefined, notas: l.notas ?? '',
    })
    setEditId(l.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.descripcion?.trim()) return Swal.fire('Campo requerido', 'Ingresa la descripción.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo ?? 'fisica', descripcion: form.descripcion!.trim(),
      codigo: form.codigo || null, cantidad: form.cantidad ?? 1,
      fecha_entrega: form.fecha_entrega || null, fecha_devolucion: form.fecha_devolucion || null,
      estado: form.estado ?? 'activa',
      deposito_pagado: form.deposito_pagado ?? false,
      monto_deposito: form.monto_deposito ?? null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('llaves_condominio').update(payload).eq('id', editId)
      : await supabase.from('llaves_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar registro?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('llaves_condominio').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoLlave) {
    const updates: Record<string, unknown> = { estado }
    if (estado === 'devuelta') updates.fecha_devolucion = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('llaves_condominio').update(updates).eq('id', id)
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
          { label: 'Total registros', value: String(llaves.length),     icon: '🔑', color: '#1B3B36' },
          { label: 'Activas',         value: String(activas),           icon: '✅', color: '#10b981' },
          { label: 'Perdidas',        value: String(perdidas),          icon: '❌', color: '#ef4444' },
          { label: 'Depósitos activos', value: depositoTotal > 0 ? `${moneda} ${depositoTotal.toFixed(0)}` : '—', icon: '💰', color: '#B96A3F' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Llaves y Accesos</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Registrar Llave</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Llave' : 'Registrar Llave / Acceso'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'fisica'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoLlave }))}>
                {Object.entries(TIPO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Descripción *</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej: Puerta principal" />
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin unidad</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Código / Serial</label>
              <input style={inputStyle} value={form.codigo ?? ''} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} placeholder="Opcional" />
            </div>
            <div>
              <label style={labelStyle}>Cantidad</label>
              <input style={inputStyle} type="number" min="1" value={form.cantidad ?? 1} onChange={e => setForm(f => ({ ...f, cantidad: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'activa'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoLlave }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha entrega</label>
              <input style={inputStyle} type="date" value={form.fecha_entrega ?? ''} onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha devolución</label>
              <input style={inputStyle} type="date" value={form.fecha_devolucion ?? ''} onChange={e => setForm(f => ({ ...f, fecha_devolucion: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Depósito ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_deposito ?? ''} onChange={e => setForm(f => ({ ...f, monto_deposito: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
              <input type="checkbox" id="dep_pagado" checked={form.deposito_pagado ?? false} onChange={e => setForm(f => ({ ...f, deposito_pagado: e.target.checked }))} />
              <label htmlFor="dep_pagado" style={{ fontSize: '12px', fontWeight: 600, color: '#7E9389', cursor: 'pointer' }}>Depósito pagado</label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'activa', 'devuelta', 'perdida', 'bloqueada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#1B3B36' : '#E1DDD0',
              background: filtroEstado === e ? '#D9E2DC' : 'white',
              color: filtroEstado === e ? '#1B3B36' : '#7E9389' }}>
            {e === 'todos' ? `Todas (${llaves.length})` : `${ESTADO_CONFIG[e as EstadoLlave]?.label} (${llaves.filter(l => l.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔑</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay llaves registradas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          {filtered.map(l => {
            const est = ESTADO_CONFIG[l.estado]
            const tc  = TIPO_CONFIG[l.tipo]
            return (
              <div key={l.id} style={{ background: 'white', border: `1.5px solid ${l.estado === 'perdida' ? '#fca5a5' : '#E1DDD0'}`, borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '15px', color: '#15291F' }}>{tc.icon} {l.descripcion}</div>
                    <div style={{ fontSize: '11px', color: '#7E9389' }}>{tc.label}{l.cantidad > 1 ? ` · ${l.cantidad} copias` : ''}</div>
                  </div>
                  <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '12px', color: '#7E9389', marginBottom: '10px' }}>
                  {l.unidad_nombre && <div>🏠 {l.unidad_nombre}</div>}
                  {l.codigo && <div>🔢 {l.codigo}</div>}
                  {l.fecha_entrega && <div>📅 Entregada: {l.fecha_entrega}</div>}
                  {l.fecha_devolucion && <div>📅 Devuelta: {l.fecha_devolucion}</div>}
                  {l.monto_deposito && <div style={{ fontWeight: 600, color: l.deposito_pagado ? '#10b981' : '#f59e0b' }}>💰 Depósito: {moneda} {l.monto_deposito.toFixed(0)} {l.deposito_pagado ? '✅' : '⚠️ Pendiente'}</div>}
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {l.estado === 'activa' && (
                      <button onClick={() => handleEstado(l.id, 'devuelta')} style={{ flex: 1, padding: '4px 8px', background: '#EAE6D8', color: '#7E9389', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Devolver</button>
                    )}
                    {(l.estado === 'activa' || l.estado === 'bloqueada') && (
                      <button onClick={() => handleEstado(l.id, 'perdida')} style={{ flex: 1, padding: '4px 8px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Reportar pérdida</button>
                    )}
                    <button onClick={() => startEdit(l)} style={{ padding: '4px 8px', background: '#EAE6D8', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(l.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
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
