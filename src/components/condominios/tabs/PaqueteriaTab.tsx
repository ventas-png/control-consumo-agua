import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { PaqueteRecibido, Unidad, EstadoPaquete } from '../../../types'

interface Props {
  paquetes: PaqueteRecibido[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoPaquete, { label: string; bg: string; color: string; icon: string }> = {
  pendiente: { label: 'Pendiente', bg: '#EEF2EC', color: '#1B3B36', icon: '📦' },
  entregado: { label: 'Entregado', bg: '#f0fdf4', color: '#16a34a', icon: '✅' },
  devuelto:  { label: 'Devuelto',  bg: '#fef2f2', color: '#dc2626', icon: '↩️' },
}

export function PaqueteriaTab({ paquetes, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoPaquete | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [form, setForm] = useState({
    unidad_id: '', descripcion: '', remitente: '', num_guia: '', empresa_mensajeria: '', notas: '',
  })

  const filtrados = paquetes.filter(p => {
    const matchEstado = filtroEstado === 'todos' || p.estado === filtroEstado
    const matchBusqueda = !busqueda ||
      p.descripcion.toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.remitente || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.num_guia || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (p.unidad_nombre || '').toLowerCase().includes(busqueda.toLowerCase())
    return matchEstado && matchBusqueda
  })

  const pendientes = paquetes.filter(p => p.estado === 'pendiente').length

  function resetForm() {
    setForm({ unidad_id: '', descripcion: '', remitente: '', num_guia: '', empresa_mensajeria: '', notas: '' })
    setShowForm(false)
  }

  async function handleRegistrar() {
    if (!form.descripcion.trim()) { Swal.fire('Error', 'Ingrese una descripción del paquete.', 'error'); return }
    if (!form.unidad_id) { Swal.fire('Error', 'Seleccione la unidad destinataria.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('paquetes_recibidos').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      descripcion: form.descripcion.trim(),
      remitente: form.remitente.trim() || null,
      num_guia: form.num_guia.trim() || null,
      empresa_mensajeria: form.empresa_mensajeria.trim() || null,
      notas: form.notas.trim() || null,
      estado: 'pendiente', recibido_por: userId,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Paquete registrado', timer: 1400, showConfirmButton: false })
    resetForm(); onRefresh()
  }

  async function marcarEntregado(id: string) {
    const { error } = await supabase.from('paquetes_recibidos').update({
      estado: 'entregado', hora_entrega: new Date().toISOString(), entregado_por: userId,
    }).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoPaquete) {
    await supabase.from('paquetes_recibidos').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar registro?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('paquetes_recibidos').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#15291F' }}>Paquetería</h2>
          <p style={{ margin: '4px 0 0', color: '#7E9389', fontSize: '13.5px' }}>
            {paquetes.length} paquetes · <span style={{ color: '#1B3B36', fontWeight: 600 }}>{pendientes} pendientes de entrega</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar paquete
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por descripción, remitente, guía, unidad..."
          style={{ flex: 1, minWidth: '200px', padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: '#FAF7EF' }} />
        {(['todos', 'pendiente', 'entregado', 'devuelto'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? '#1B3B36' : '#E1DDD0', background: filtroEstado === e ? '#EEF2EC' : 'white', color: filtroEstado === e ? '#1B3B36' : '#7E9389' }}>
            {e === 'todos' ? 'Todos' : ESTADO_CONFIG[e].label}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar paquete recibido</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: '4px' }}>Descripción *</label>
              <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Ej. Caja Amazon, sobre TIGO..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: '#FAF7EF' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: '4px' }}>Unidad destinataria *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: '#FAF7EF' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: '4px' }}>Remitente</label>
              <input value={form.remitente} onChange={e => setForm(f => ({ ...f, remitente: e.target.value }))} placeholder="Nombre o empresa"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: '#FAF7EF' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: '4px' }}>No. de guía</label>
              <input value={form.num_guia} onChange={e => setForm(f => ({ ...f, num_guia: e.target.value }))} placeholder="Número de rastreo"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: '#FAF7EF' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: '4px' }}>Empresa mensajería</label>
              <input value={form.empresa_mensajeria} onChange={e => setForm(f => ({ ...f, empresa_mensajeria: e.target.value }))} placeholder="DHL, FedEx, Amazon..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: '#FAF7EF' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#3E5A4C', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: '#FAF7EF' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleRegistrar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Registrando...' : '📦 Registrar recepción'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
          <p style={{ fontWeight: 600, color: '#7E9389' }}>No hay paquetes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtrados.map(p => {
            const cfg = ESTADO_CONFIG[p.estado]
            return (
              <div key={p.id} style={{ background: 'white', border: `1.5px solid ${p.estado === 'pendiente' ? '#C2D2CA' : '#E1DDD0'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ fontSize: '28px', flexShrink: 0 }}>{cfg.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#15291F' }}>{p.descripcion}</div>
                  <div style={{ fontSize: '12px', color: '#7E9389', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' }}>
                    {p.unidad_nombre && <span>📍 {p.unidad_nombre}</span>}
                    {p.remitente && <span>· De: {p.remitente}</span>}
                    {p.empresa_mensajeria && <span>· {p.empresa_mensajeria}</span>}
                    {p.num_guia && <span>· #{p.num_guia}</span>}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#7E9389', marginTop: '3px' }}>
                    Recibido: {new Date(p.hora_recepcion).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {p.hora_entrega && ` · Entregado: ${new Date(p.hora_entrega).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                  <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                  {canEdit && p.estado === 'pendiente' && (
                    <button
                      onClick={() => {
                        const msg = `📦 Paquete recibido en portería\nUnidad: ${p.unidad_nombre ?? ''}\nDescripción: ${p.descripcion}${p.remitente ? `\nDe: ${p.remitente}` : ''}${p.empresa_mensajeria ? `\nMensajería: ${p.empresa_mensajeria}` : ''}\nPuede pasar a recogerlo cuando guste.`
                        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                      }}
                      title="Notificar residente por WhatsApp"
                      style={{ padding: '5px 10px', background: '#dcfce7', color: '#16a34a', border: '1px solid #86efac', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600 }}
                    >💬 Avisar</button>
                  )}
                  {canEdit && p.estado === 'pendiente' && (
                    <button onClick={() => marcarEntregado(p.id)} style={{ padding: '6px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                      ✓ Entregar
                    </button>
                  )}
                  {canEdit && p.estado === 'pendiente' && (
                    <button onClick={() => cambiarEstado(p.id, 'devuelto')} style={{ padding: '5px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px' }}>
                      ↩ Devolver
                    </button>
                  )}
                  <button onClick={() => eliminar(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '15px', padding: '2px 4px' }}>🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
