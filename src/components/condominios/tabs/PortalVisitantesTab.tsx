import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import type { Visitante } from '../../../types'

interface Props {
  visitantes: Visitante[]
  unidadId: string
  proyectoId: string
  companyId: string
  onRefresh: () => void
}

function blankForm() {
  return { nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', valido_hasta: '' }
}

export function PortalVisitantesTab({ visitantes, unidadId, proyectoId, companyId, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(blankForm())

  const hoy      = new Date().toISOString().slice(0, 10)
  const vigentes = visitantes.filter(v => !v.valido_hasta || v.valido_hasta >= hoy)
  const recientes = visitantes.filter(v => v.hora_entrada.slice(0, 10) === hoy)

  async function preAutorizar() {
    if (!form.nombre.trim()) { toast.error('Ingrese el nombre del visitante.'); return }
    setSaving(true)
    const { error } = await supabase.from('visitantes').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: unidadId,
      nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      motivo: form.motivo.trim() || null,
      valido_hasta: form.valido_hasta || null,
      hora_entrada: new Date().toISOString(),
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('¡Visitante pre-autorizado!', { description: 'La administración fue notificada.' })
    setForm(blankForm()); setShowForm(false); onRefresh()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>Mis visitantes</h3>
          {recientes.length > 0 && <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#2563eb' }}>{recientes.length} visita{recientes.length > 1 ? 's' : ''} hoy</p>}
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
          + Pre-autorizar visita
        </button>
      </div>

      {showForm && (
        <div style={{ background: 'white', border: '1.5px solid #bfdbfe', borderRadius: '14px', padding: '18px', marginBottom: '18px' }}>
          <h4 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700 }}>Autorizar visitante</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre completo del visitante *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre y apellido..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Identificación</label>
              <input value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))} placeholder="DPI, pasaporte..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Placa del vehículo</label>
              <input value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))} placeholder="Ej. ABC-123"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Motivo de la visita</label>
              <input value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Familiar, técnico, delivery..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Autorización válida hasta</label>
              <input type="date" value={form.valido_hasta} min={hoy} onChange={e => setForm(f => ({ ...f, valido_hasta: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
              <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#94a3b8' }}>Dejar vacío para visita de hoy únicamente</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
            <button onClick={preAutorizar} disabled={saving} style={{ padding: '10px 22px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Autorizando...' : '✅ Autorizar visita'}
            </button>
            <button onClick={() => { setShowForm(false); setForm(blankForm()) }} style={{ padding: '10px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {vigentes.length === 0 && visitantes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>🚪</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>Sin visitantes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visitantes.sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada)).map(v => {
            const esHoy = v.hora_entrada.slice(0, 10) === hoy
            const vigente = !v.valido_hasta || v.valido_hasta >= hoy
            return (
              <div key={v.id} style={{ background: 'white', border: `1.5px solid ${esHoy ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: '12px', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>👤</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{v.nombre}</div>
                  <div style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {v.identificacion && <span>🪪 {v.identificacion}</span>}
                    {v.placa_vehiculo && <span>🚗 {v.placa_vehiculo}</span>}
                    {v.motivo && <span>· {v.motivo}</span>}
                  </div>
                  <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                    {new Date(v.hora_entrada).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {v.valido_hasta && ` · Válida hasta ${new Date(v.valido_hasta + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' })}`}
                  </div>
                </div>
                {esHoy && <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#eff6ff', color: '#2563eb', flexShrink: 0 }}>Hoy</span>}
                {!esHoy && vigente && <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#f0fdf4', color: '#16a34a', flexShrink: 0 }}>Vigente</span>}
                {!vigente && !esHoy && <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#f8fafc', color: '#94a3b8', flexShrink: 0 }}>Expirada</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
