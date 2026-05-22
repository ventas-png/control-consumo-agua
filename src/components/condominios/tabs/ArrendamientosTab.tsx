import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { ContratoArrendamiento, Unidad, EstadoContrato } from '../../../types'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  contratos: ContratoArrendamiento[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoContrato, { label: string; bg: string; color: string }> = {
  activo:    { label: 'Activo',    bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  vencido:   { label: 'Vencido',   bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  terminado: { label: 'Terminado', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

export function ArrendamientosTab({ contratos, unidades, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoContrato | 'todos'>('activo')
  const [busqueda, setBusqueda] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    unidad_id: '', arrendatario_nombre: '', arrendatario_identificacion: '',
    arrendatario_telefono: '', arrendatario_email: '',
    monto_renta: '', dia_pago: '5', fecha_inicio: '', fecha_fin: '', deposito: '', notas: '',
  })

  const filtrados = contratos.filter(c => {
    const matchEstado = filtroEstado === 'todos' || c.estado === filtroEstado
    const matchBusqueda = !busqueda ||
      c.arrendatario_nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      (c.unidad_nombre || '').toLowerCase().includes(busqueda.toLowerCase()) ||
      (c.arrendatario_identificacion || '').includes(busqueda)
    return matchEstado && matchBusqueda
  })

  const activos = contratos.filter(c => c.estado === 'activo')
  const rentaTotal = activos.reduce((s, c) => s + c.monto_renta, 0)

  const porVencer = contratos.filter(c => c.estado === 'activo' && c.fecha_fin && c.fecha_fin <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))

  function resetForm() {
    setForm({ unidad_id: '', arrendatario_nombre: '', arrendatario_identificacion: '', arrendatario_telefono: '', arrendatario_email: '', monto_renta: '', dia_pago: '5', fecha_inicio: '', fecha_fin: '', deposito: '', notas: '' })
    setShowForm(false); setEditingId(null)
  }

  function startEdit(c: ContratoArrendamiento) {
    setForm({
      unidad_id: c.unidad_id, arrendatario_nombre: c.arrendatario_nombre,
      arrendatario_identificacion: c.arrendatario_identificacion ?? '',
      arrendatario_telefono: c.arrendatario_telefono ?? '',
      arrendatario_email: c.arrendatario_email ?? '',
      monto_renta: String(c.monto_renta), dia_pago: String(c.dia_pago),
      fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin ?? '',
      deposito: c.deposito != null ? String(c.deposito) : '', notas: c.notas ?? '',
    })
    setEditingId(c.id); setShowForm(true)
  }

  async function handleGuardar() {
    if (!form.arrendatario_nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre del arrendatario.', 'error'); return }
    if (!form.unidad_id) { Swal.fire('Error', 'Seleccione la unidad.', 'error'); return }
    if (!form.monto_renta || isNaN(Number(form.monto_renta))) { Swal.fire('Error', 'Ingrese el monto de renta.', 'error'); return }
    if (!form.fecha_inicio) { Swal.fire('Error', 'Ingrese la fecha de inicio.', 'error'); return }
    setSaving(true)
    const data = {
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      arrendatario_nombre: form.arrendatario_nombre.trim(),
      arrendatario_identificacion: form.arrendatario_identificacion.trim() || null,
      arrendatario_telefono: form.arrendatario_telefono.trim() || null,
      arrendatario_email: form.arrendatario_email.trim() || null,
      monto_renta: Number(form.monto_renta), dia_pago: Number(form.dia_pago),
      fecha_inicio: form.fecha_inicio, fecha_fin: form.fecha_fin || null,
      deposito: form.deposito ? Number(form.deposito) : null,
      estado: 'activo' as EstadoContrato,
      notas: form.notas.trim() || null,
    }
    const { error } = editingId
      ? await supabase.from('contratos_arrendamiento').update(data).eq('id', editingId)
      : await supabase.from('contratos_arrendamiento').insert(data)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: editingId ? 'Contrato actualizado' : 'Contrato registrado', timer: 1400, showConfirmButton: false })
    resetForm(); onRefresh()
  }

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Contratos de Arrendamiento',
      proyectoNombre,
      headers: ['Arrendatario', 'Unidad', 'Renta/mes', 'Depósito', 'Día pago', 'Inicio', 'Fin', 'Estado'],
      rows: filtrados.map(c => [c.arrendatario_nombre, c.unidad_nombre ?? '—', `${moneda} ${c.monto_renta.toFixed(2)}`, c.deposito != null ? `${moneda} ${c.deposito.toFixed(2)}` : '—', `Día ${c.dia_pago}`, c.fecha_inicio, c.fecha_fin ?? '—', ESTADO_CONFIG[c.estado].label]),
      totalesRow: ['TOTAL ACTIVOS', '', `${moneda} ${rentaTotal.toFixed(2)}`, '', '', '', '', ''],
      rightAlignCols: [2, 3],
      filename: `arrendamientos-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`arrendamientos-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Arrendamientos',
      headers: ['Arrendatario', 'DPI', 'Teléfono', 'Email', 'Unidad', 'Renta/mes', 'Depósito', 'Día pago', 'Inicio', 'Fin', 'Estado'],
      rows: contratos.map(c => [c.arrendatario_nombre, c.arrendatario_identificacion ?? '', c.arrendatario_telefono ?? '', c.arrendatario_email ?? '', c.unidad_nombre ?? '', c.monto_renta, c.deposito ?? '', c.dia_pago, c.fecha_inicio, c.fecha_fin ?? '', c.estado]),
    }])
  }

  async function cambiarEstado(id: string, estado: EstadoContrato) {
    await supabase.from('contratos_arrendamiento').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar contrato?', icon: 'warning', showCancelButton: true, confirmButtonColor: 'var(--at-danger)', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('contratos_arrendamiento').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Arrendamientos</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {activos.length} contratos activos · <span style={{ fontWeight: 600, color: 'var(--at-primary)' }}>{moneda} {rentaTotal.toFixed(2)}/mes</span>
            {porVencer.length > 0 && <span style={{ color: 'var(--at-warning)', fontWeight: 600 }}> · {porVencer.length} por vencer</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportarPDF} disabled={contratos.length === 0} style={{ padding: '9px 14px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>📄 PDF</button>
          <button onClick={exportarXlsx} disabled={contratos.length === 0} style={{ padding: '9px 14px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>📊 Excel</button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              + Nuevo contrato
            </button>
          )}
        </div>
      </div>

      {/* Alerta por vencer */}
      {porVencer.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13.5px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {porVencer.length} contrato{porVencer.length > 1 ? 's' : ''} vence{porVencer.length > 1 ? 'n' : ''} en los próximos 30 días: {porVencer.map(c => c.arrendatario_nombre).join(', ')}
          </span>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar arrendatario, unidad..."
          style={{ flex: 1, minWidth: '180px', padding: '8px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)' }} />
        {(['todos', 'activo', 'vencido', 'terminado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-line)', background: filtroEstado === e ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: filtroEstado === e ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {e === 'todos' ? 'Todos' : ESTADO_CONFIG[e].label}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editingId ? 'Editar contrato' : 'Nuevo contrato de arrendamiento'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre del arrendatario *</label>
              <input value={form.arrendatario_nombre} onChange={e => setForm(f => ({ ...f, arrendatario_nombre: e.target.value }))} placeholder="Nombre completo"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
              <input value={form.arrendatario_identificacion} onChange={e => setForm(f => ({ ...f, arrendatario_identificacion: e.target.value }))} placeholder="Número de documento"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Teléfono</label>
              <input value={form.arrendatario_telefono} onChange={e => setForm(f => ({ ...f, arrendatario_telefono: e.target.value }))} placeholder="+502..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Email</label>
              <input type="email" value={form.arrendatario_email} onChange={e => setForm(f => ({ ...f, arrendatario_email: e.target.value }))} placeholder="correo@ejemplo.com"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Monto de renta ({moneda}) *</label>
              <input type="number" value={form.monto_renta} onChange={e => setForm(f => ({ ...f, monto_renta: e.target.value }))} placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Depósito ({moneda})</label>
              <input type="number" value={form.deposito} onChange={e => setForm(f => ({ ...f, deposito: e.target.value }))} placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Día de pago</label>
              <input type="number" value={form.dia_pago} onChange={e => setForm(f => ({ ...f, dia_pago: e.target.value }))} min="1" max="28"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha inicio *</label>
              <input type="date" value={form.fecha_inicio} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha fin (opcional)</label>
              <input type="date" value={form.fecha_fin} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Condiciones especiales, observaciones..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay contratos {filtroEstado !== 'todos' ? `con estado "${filtroEstado}"` : 'registrados'}</p>
        </div>
      ) : (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13.5px' }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)', borderBottom: '1px solid var(--at-line)' }}>
                {['Arrendatario', 'Unidad', 'Renta/mes', 'Día pago', 'Período', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11.5px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => {
                const ec = ESTADO_CONFIG[c.estado]
                const vence30 = c.fecha_fin && c.fecha_fin <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) && c.estado === 'activo'
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{c.arrendatario_nombre}</div>
                      {c.arrendatario_telefono && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{c.arrendatario_telefono}</div>}
                    </td>
                    <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)' }}>{c.unidad_nombre || '—'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {c.monto_renta.toFixed(2)}</td>
                    <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)' }}>Día {c.dia_pago}</td>
                    <td style={{ padding: '10px 14px', color: vence30 ? 'var(--at-warning)' : 'var(--at-ink-2)', fontWeight: vence30 ? 700 : 400 }}>
                      {c.fecha_inicio}{c.fecha_fin ? ` → ${c.fecha_fin}` : ' →'}
                      {vence30 && <span style={{ display: 'block', fontSize: '11px', color: 'var(--at-warning)' }}>⚠️ Por vencer</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {canEdit ? (
                        <select value={c.estado} onChange={e => cambiarEstado(c.id, e.target.value as EstadoContrato)}
                          style={{ padding: '4px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, border: 'none', cursor: 'pointer', background: ec.bg, color: ec.color }}>
                          {(Object.entries(ESTADO_CONFIG) as [EstadoContrato, typeof ESTADO_CONFIG[EstadoContrato]][]).map(([v, cfg]) => (
                            <option key={v} value={v}>{cfg.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {vence30 && (
                        <button
                          title="Notificar renovación por WhatsApp"
                          onClick={() => {
                            const msg = `📋 Aviso de vencimiento de contrato\nArrendatario: ${c.arrendatario_nombre}\nUnidad: ${c.unidad_nombre ?? ''}\nVencimiento: ${c.fecha_fin}\nPor favor comuníquese para coordinar la renovación.`
                            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--at-success)' }}
                        >💬</button>
                      )}
                      {canEdit && <button onClick={() => startEdit(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--at-ink-3)' }}>✏️</button>}
                      <button onClick={() => eliminar(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: 'var(--at-danger)' }}>🗑</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
