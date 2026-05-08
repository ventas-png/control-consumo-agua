import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { Mudanza, TipoMudanza, EstadoMudanza, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  mudanzas: Mudanza[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoMudanza, { label: string; color: string; bg: string }> = {
  programada: { label: 'Programada', color: '#0ea5e9', bg: '#e0f2fe' },
  en_curso:   { label: 'En Curso',   color: '#f59e0b', bg: '#fef3c7' },
  completada: { label: 'Completada', color: '#10b981', bg: '#d1fae5' },
  cancelada:  { label: 'Cancelada',  color: '#64748b', bg: '#f1f5f9' },
}

const blank = (): Partial<Mudanza> => ({
  tipo: 'ingreso', fecha: new Date().toISOString().slice(0, 10),
  hora_inicio: '', hora_fin: '', nombre_residente: '', telefono: '',
  empresa_mudanza: '', estado: 'programada', deposito_requerido: false,
  deposito_pagado: false, monto_deposito: undefined, ascensor_reservado: false, notas: '',
})

export function MudanzasTab({ mudanzas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [filtroEstado, setFiltroEstado] = useState<EstadoMudanza | 'todos'>('todos')
  const [filtroTipo, setFiltroTipo] = useState<TipoMudanza | 'todos'>('todos')
  const [form, setForm] = useState<Partial<Mudanza>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const hoy_mudanzas = mudanzas.filter(m => m.fecha === hoy && (m.estado === 'programada' || m.estado === 'en_curso'))
  const depositosPendientes = mudanzas.filter(m => m.deposito_requerido && !m.deposito_pagado && m.estado !== 'cancelada')

  const filtered = mudanzas.filter(m => {
    if (filtroEstado !== 'todos' && m.estado !== filtroEstado) return false
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false
    return true
  }).sort((a, b) => b.fecha.localeCompare(a.fecha))

  function startEdit(m: Mudanza) {
    setForm({
      unidad_id: m.unidad_id ?? '', tipo: m.tipo, fecha: m.fecha,
      hora_inicio: m.hora_inicio ?? '', hora_fin: m.hora_fin ?? '',
      nombre_residente: m.nombre_residente, telefono: m.telefono ?? '',
      empresa_mudanza: m.empresa_mudanza ?? '', estado: m.estado,
      deposito_requerido: m.deposito_requerido, deposito_pagado: m.deposito_pagado,
      monto_deposito: m.monto_deposito ?? undefined, ascensor_reservado: m.ascensor_reservado,
      notas: m.notas ?? '',
    })
    setEditId(m.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.nombre_residente?.trim()) return Swal.fire('Campo requerido', 'Ingresa el nombre del residente.', 'warning')
    if (!form.fecha) return Swal.fire('Campo requerido', 'Ingresa la fecha.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo ?? 'ingreso', fecha: form.fecha!,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      nombre_residente: form.nombre_residente!.trim(), telefono: form.telefono || null,
      empresa_mudanza: form.empresa_mudanza || null, estado: form.estado ?? 'programada',
      deposito_requerido: form.deposito_requerido ?? false,
      deposito_pagado: form.deposito_pagado ?? false,
      monto_deposito: form.monto_deposito ?? null,
      ascensor_reservado: form.ascensor_reservado ?? false,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('mudanzas').update(payload).eq('id', editId)
      : await supabase.from('mudanzas').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar mudanza?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('mudanzas').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoMudanza) {
    const { error } = await supabase.from('mudanzas').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {hoy_mudanzas.length > 0 && (
        <div style={{ background: '#ede9fe', border: '1px solid #8b5cf6', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚚</span>
          <span style={{ fontSize: '13px', color: '#5b21b6', fontWeight: 600 }}>
            {hoy_mudanzas.length} mudanza{hoy_mudanzas.length > 1 ? 's' : ''} programada{hoy_mudanzas.length > 1 ? 's' : ''} para hoy
          </span>
        </div>
      )}
      {depositosPendientes.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>💰</span>
          <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 600 }}>
            {depositosPendientes.length} depósito{depositosPendientes.length > 1 ? 's' : ''} pendiente{depositosPendientes.length > 1 ? 's' : ''} de cobro
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Control de Mudanzas</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Mudanza
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Mudanza' : 'Nueva Mudanza'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Nombre del residente *</label>
              <input style={inputStyle} value={form.nombre_residente ?? ''} onChange={e => setForm(f => ({ ...f, nombre_residente: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin unidad</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'ingreso'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoMudanza }))}>
                <option value="ingreso">📥 Ingreso</option>
                <option value="salida">📤 Salida</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'programada'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoMudanza }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora inicio</label>
              <input style={inputStyle} type="time" value={form.hora_inicio ?? ''} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora fin</label>
              <input style={inputStyle} type="time" value={form.hora_fin ?? ''} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Teléfono</label>
              <input style={inputStyle} value={form.telefono ?? ''} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Empresa de mudanza</label>
              <input style={inputStyle} value={form.empresa_mudanza ?? ''} onChange={e => setForm(f => ({ ...f, empresa_mudanza: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Depósito ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto_deposito ?? ''} onChange={e => setForm(f => ({ ...f, monto_deposito: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.deposito_requerido ?? false} onChange={e => setForm(f => ({ ...f, deposito_requerido: e.target.checked }))} />
                Depósito requerido
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.deposito_pagado ?? false} onChange={e => setForm(f => ({ ...f, deposito_pagado: e.target.checked }))} />
                Depósito pagado
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#374151', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.ascensor_reservado ?? false} onChange={e => setForm(f => ({ ...f, ascensor_reservado: e.target.checked }))} />
                Ascensor reservado
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Registrar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['todos', 'programada', 'en_curso', 'completada', 'cancelada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === e ? '#e0f2fe' : 'white',
              color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? `Todas (${mudanzas.length})` : `${ESTADO_CONFIG[e as EstadoMudanza]?.label} (${mudanzas.filter(m => m.estado === e).length})`}
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 4px' }} />
        <button onClick={() => setFiltroTipo(filtroTipo === 'ingreso' ? 'todos' : 'ingreso')}
          style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroTipo === 'ingreso' ? '#8b5cf6' : '#e2e8f0', background: filtroTipo === 'ingreso' ? '#ede9fe' : 'white', color: filtroTipo === 'ingreso' ? '#7c3aed' : '#64748b' }}>
          📥 Ingresos
        </button>
        <button onClick={() => setFiltroTipo(filtroTipo === 'salida' ? 'todos' : 'salida')}
          style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroTipo === 'salida' ? '#f59e0b' : '#e2e8f0', background: filtroTipo === 'salida' ? '#fef3c7' : 'white', color: filtroTipo === 'salida' ? '#92400e' : '#64748b' }}>
          📤 Salidas
        </button>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚚</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay mudanzas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(m => {
            const est = ESTADO_CONFIG[m.estado]
            const esHoy = m.fecha === hoy
            return (
              <div key={m.id} style={{ background: 'white', border: `1.5px solid ${esHoy && m.estado === 'programada' ? '#a78bfa' : '#e2e8f0'}`, borderRadius: '10px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '28px' }}>{m.tipo === 'ingreso' ? '📥' : '📤'}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                      {m.nombre_residente}
                      {m.unidad_nombre && <span style={{ fontWeight: 400, color: '#64748b', fontSize: '12px' }}> — {m.unidad_nombre}</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                      📅 {m.fecha}{m.hora_inicio ? ` · ${m.hora_inicio}${m.hora_fin ? `–${m.hora_fin}` : ''}` : ''}
                      {m.empresa_mudanza && ` · ${m.empresa_mudanza}`}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {m.ascensor_reservado && <span style={{ fontSize: '10px', fontWeight: 600, background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: '4px' }}>🛗 Ascensor</span>}
                      {m.deposito_requerido && (
                        <span style={{ fontSize: '10px', fontWeight: 600, background: m.deposito_pagado ? '#d1fae5' : '#fef3c7', color: m.deposito_pagado ? '#059669' : '#92400e', padding: '1px 6px', borderRadius: '4px' }}>
                          💰 {m.deposito_pagado ? 'Depósito pagado' : 'Depósito pendiente'}{m.monto_deposito ? ` (${moneda} ${m.monto_deposito})` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {canEdit ? (
                    <select value={m.estado} onChange={e => handleEstado(m.id, e.target.value as EstadoMudanza)}
                      style={{ padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: est.color, background: 'white', cursor: 'pointer' }}>
                      {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  ) : (
                    <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: est.bg, color: est.color }}>{est.label}</span>
                  )}
                  {(m.estado === 'programada' || m.estado === 'en_curso') && (
                    <button
                      title="Enviar recordatorio por WhatsApp"
                      onClick={() => {
                        const msg = `🚚 Recordatorio de mudanza (${m.tipo === 'ingreso' ? 'ingreso' : 'salida'})\nResidente: ${m.nombre_residente}${m.unidad_nombre ? `\nUnidad: ${m.unidad_nombre}` : ''}\nFecha: ${m.fecha}${m.hora_inicio ? `\nHorario: ${m.hora_inicio}${m.hora_fin ? `–${m.hora_fin}` : ''}` : ''}${m.ascensor_reservado ? '\n🛗 Ascensor reservado' : ''}${m.deposito_requerido && !m.deposito_pagado ? `\n⚠️ Depósito pendiente${m.monto_deposito ? ` (${moneda} ${m.monto_deposito})` : ''}` : ''}`
                        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                      }}
                      style={{ padding: '5px 7px', background: '#dcfce7', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#16a34a' }}
                    >💬</button>
                  )}
                  {canEdit && <button onClick={() => startEdit(m)} style={{ padding: '5px 7px', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                  {canEdit && <button onClick={() => handleDelete(m.id)} style={{ padding: '5px 7px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
