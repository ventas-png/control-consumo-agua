import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Visitante, Unidad } from '../../../types'

interface Props {
  visitantes: Visitante[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  onRefresh: () => void
}

export function VisitantesTab({ visitantes, unidades, proyectoId, companyId, userId, canCreate, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [soloActivos, setSoloActivos] = useState(false)
  const [form, setForm] = useState({
    unidad_id: '',
    nombre: '',
    identificacion: '',
    placa_vehiculo: '',
    motivo: '',
    notas: '',
  })

  const hoy = new Date().toISOString().slice(0, 10)

  const filtrados = visitantes.filter(v => {
    const matchBusqueda = !busqueda || v.nombre.toLowerCase().includes(busqueda.toLowerCase()) || (v.identificacion || '').includes(busqueda)
    const matchActivo = !soloActivos || !v.hora_salida
    return matchBusqueda && matchActivo
  })

  function resetForm() {
    setForm({ unidad_id: '', nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', notas: '' })
    setShowForm(false)
  }

  async function handleRegistrar() {
    if (!form.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre del visitante.', 'error'); return }
    if (!form.unidad_id) { Swal.fire('Error', 'Seleccione la unidad a visitar.', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('visitantes').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id,
      nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      motivo: form.motivo.trim() || null,
      notas: form.notas.trim() || null,
      registrado_por: userId,
      hora_entrada: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: 'Visita registrada', timer: 1500, showConfirmButton: false })
    resetForm()
    onRefresh()
  }

  async function registrarSalida(id: string) {
    const { error } = await supabase.from('visitantes').update({ hora_salida: new Date().toISOString() }).eq('id', id)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
  }

  const visitantesHoy = visitantes.filter(v => v.hora_entrada.startsWith(hoy)).length
  const enPremisas = visitantes.filter(v => !v.hora_salida).length

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Control de Visitantes</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {visitantesHoy} visitas hoy · <span style={{ color: '#16a34a', fontWeight: 600 }}>{enPremisas} en premisas</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar visita
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar visitante o DPI..."
          style={{ flex: 1, minWidth: '200px', padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', background: '#f8fafc' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: '#374151', cursor: 'pointer', padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', background: soloActivos ? '#f0fdf4' : '#f8fafc' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo en premisas
        </label>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar visitante</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre del visitante"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
              <input value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                placeholder="Número de documento"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
              <input value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))}
                placeholder="Ej. ABC-123"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
              <input value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                placeholder="Ej. Entrega, Social, Mantenimiento..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Opcional"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleRegistrar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Registrando...' : '✓ Registrar entrada'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚪</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>No hay visitantes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtrados.map(v => {
            const enPremisa = !v.hora_salida
            return (
              <div key={v.id} style={{ background: 'white', border: `1.5px solid ${enPremisa ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: enPremisa ? 'linear-gradient(135deg,#10b981,#059669)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: enPremisa ? 'white' : '#94a3b8', fontWeight: 700, fontSize: '15px', flexShrink: 0 }}>
                  {v.nombre.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{v.nombre}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
                    {v.motivo && <span>· {v.motivo}</span>}
                    {v.identificacion && <span>· ID: {v.identificacion}</span>}
                    {v.placa_vehiculo && <span>· 🚗 {v.placa_vehiculo}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Entrada: {new Date(v.hora_entrada).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>
                  {v.hora_salida && <div style={{ fontSize: '12px', color: '#94a3b8' }}>Salida: {new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' })}</div>}
                  {enPremisa && <span style={{ display: 'inline-block', marginTop: '4px', padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: '#dcfce7', color: '#16a34a', fontWeight: 700 }}>En premisas</span>}
                </div>
                {enPremisa && (
                  <button onClick={() => registrarSalida(v.id)} style={{ padding: '7px 14px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, flexShrink: 0 }}>
                    Registrar salida
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
