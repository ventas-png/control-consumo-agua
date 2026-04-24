import React, { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { PlantillaCuota, PeriodicidadPlantilla, Unidad } from '../../../types'

interface Props {
  plantillas: PlantillaCuota[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PERIODO_LABELS: Record<PeriodicidadPlantilla, string> = {
  mensual: 'Mensual', bimestral: 'Bimestral', trimestral: 'Trimestral',
  semestral: 'Semestral', anual: 'Anual', 'única': 'Única',
}

export default function PlantillasCuotaTab({ plantillas, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generando, setGenerando] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    nombre: '', concepto: 'mantenimiento', monto: '',
    dia_vencimiento: '5', periodicidad: 'mensual' as PeriodicidadPlantilla,
    aplica_a: 'todas', notas: '',
  })

  function resetForm() {
    setForm({ nombre: '', concepto: 'mantenimiento', monto: '', dia_vencimiento: '5', periodicidad: 'mensual', aplica_a: 'todas', notas: '' })
    setMostrarForm(false); setEditingId(null)
  }

  function startEdit(p: PlantillaCuota) {
    setForm({
      nombre: p.nombre, concepto: p.concepto, monto: String(p.monto),
      dia_vencimiento: String(p.dia_vencimiento), periodicidad: p.periodicidad,
      aplica_a: p.aplica_a, notas: p.notas ?? '',
    })
    setEditingId(p.id); setMostrarForm(true)
  }

  async function guardar() {
    if (!form.nombre.trim() || !form.monto) { Swal.fire('Error', 'Nombre y monto son obligatorios', 'warning'); return }
    setSaving(true)
    const data = {
      company_id: companyId, project_id: proyectoId,
      nombre: form.nombre.trim(), concepto: form.concepto,
      monto: parseFloat(form.monto), dia_vencimiento: parseInt(form.dia_vencimiento),
      periodicidad: form.periodicidad, aplica_a: form.aplica_a,
      notas: form.notas.trim() || null,
    }
    const { error } = editingId
      ? await supabase.from('plantillas_cuota').update(data).eq('id', editingId)
      : await supabase.from('plantillas_cuota').insert(data)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    resetForm(); onRefresh()
  }

  async function toggleActiva(p: PlantillaCuota) {
    await supabase.from('plantillas_cuota').update({ activa: !p.activa }).eq('id', p.id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar plantilla?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('plantillas_cuota').delete().eq('id', id)
    onRefresh()
  }

  async function generarCuotas(p: PlantillaCuota) {
    const { value: periodo } = await Swal.fire({
      title: `Generar cuotas — ${p.nombre}`,
      html: `<p style="font-size:13px;color:#374151;margin-bottom:8px">Período (YYYY-MM):</p>
             <input id="periodo-input" class="swal2-input" type="month" value="${new Date().toISOString().slice(0,7)}" style="font-size:14px">`,
      showCancelButton: true,
      confirmButtonText: 'Generar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => (document.getElementById('periodo-input') as HTMLInputElement)?.value,
    })
    if (!periodo) return

    const unidadesTarget = unidades.filter(u => {
      if (!u.activo) return false
      if (p.aplica_a === 'todas') return true
      return true // extend with tipo_unidad filter if needed
    })

    if (unidadesTarget.length === 0) { Swal.fire('Sin unidades', 'No hay unidades activas para generar cuotas', 'info'); return }

    const confirm = await Swal.fire({
      title: '¿Confirmar generación?',
      text: `Se crearán ${unidadesTarget.length} cuotas de ${moneda} ${p.monto.toLocaleString()} para el período ${periodo}`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar',
    })
    if (!confirm.isConfirmed) return

    setGenerando(p.id)
    const [year, month] = periodo.split('-').map(Number)
    const fechaVenc = new Date(year, month - 1, p.dia_vencimiento).toISOString().slice(0, 10)
    const rows = unidadesTarget.map(u => ({
      company_id: companyId, project_id: proyectoId,
      unidad_id: u.id,
      concepto: p.concepto,
      monto: p.monto,
      periodo,
      fecha_vencimiento: fechaVenc,
      estado: 'pendiente',
    }))

    const { error } = await supabase.from('cuotas_condominio').insert(rows)
    setGenerando(null)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `${rows.length} cuotas generadas`, text: `Período ${periodo}`, timer: 2000, showConfirmButton: false })
    onRefresh()
  }

  const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: React.CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Plantillas de cuota</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{plantillas.filter(p => p.activa).length} activas · {unidades.filter(u => u.activo).length} unidades</div>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva plantilla'}
          </button>
        )}
      </div>

      {/* Form */}
      {mostrarForm && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>{editingId ? 'Editar plantilla' : 'Nueva plantilla de cuota'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Nombre *</label>
              <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Cuota de mantenimiento mensual" />
            </div>
            <div>
              <label style={lbl}>Concepto</label>
              <select style={inp} value={form.concepto} onChange={e => setForm(p => ({ ...p, concepto: e.target.value }))}>
                {['mantenimiento','agua','seguridad','amenidades','extraordinaria','cam','otro'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Monto ({moneda}) *</label>
              <input type="number" step="0.01" style={inp} value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Día de vencimiento</label>
              <input type="number" min={1} max={28} style={inp} value={form.dia_vencimiento} onChange={e => setForm(p => ({ ...p, dia_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Periodicidad</label>
              <select style={inp} value={form.periodicidad} onChange={e => setForm(p => ({ ...p, periodicidad: e.target.value as PeriodicidadPlantilla }))}>
                {(Object.entries(PERIODO_LABELS) as [PeriodicidadPlantilla, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Aplica a</label>
              <select style={inp} value={form.aplica_a} onChange={e => setForm(p => ({ ...p, aplica_a: e.target.value }))}>
                <option value="todas">Todas las unidades</option>
                <option value="residencial">Solo residencial</option>
                <option value="comercial">Solo comercial</option>
              </select>
            </div>
            <div>
              <label style={lbl}>Notas</label>
              <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Guardar plantilla'}
          </button>
        </div>
      )}

      {/* Lista */}
      {plantillas.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          No hay plantillas de cuota — crea una para generar cuotas masivas
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {plantillas.map(p => (
            <div key={p.id} style={{ background: p.activa ? '#fff' : '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, opacity: p.activa ? 1 : 0.65 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{p.nombre}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#f0fdf4', color: '#16a34a' }}>{PERIODO_LABELS[p.periodicidad]}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: '#f3f4f6', color: '#374151' }}>{p.concepto}</span>
                </div>
                <div style={{ fontSize: 13, color: '#374151' }}>
                  <strong>{moneda} {p.monto.toLocaleString()}</strong> · vence día {p.dia_vencimiento} · {p.aplica_a === 'todas' ? 'Todas las unidades' : p.aplica_a}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {canCreate && p.activa && (
                  <button onClick={() => generarCuotas(p)} disabled={generando === p.id}
                    style={{ padding: '7px 14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    {generando === p.id ? '⏳' : '⚡ Generar'}
                  </button>
                )}
                {canEdit && (
                  <>
                    <button onClick={() => startEdit(p)} style={{ padding: '7px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>✏️</button>
                    <button onClick={() => toggleActiva(p)} style={{ padding: '7px 12px', background: p.activa ? '#fef3c7' : '#f0fdf4', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>{p.activa ? '⏸' : '▶'}</button>
                    <button onClick={() => eliminar(p.id)} style={{ padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>🗑</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
