import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { ContratoArrendamiento, Unidad, EstadoContrato } from '../../../types'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

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
  activo:    { label: 'Activo',    bg: '#f0fdf4', color: '#16a34a' },
  vencido:   { label: 'Vencido',   bg: '#fef2f2', color: '#dc2626' },
  terminado: { label: 'Terminado', bg: '#f8fafc', color: '#64748b' },
}

export function ArrendamientosTab({ contratos, unidades, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoContrato | 'todos'>('activo')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    unidad_id: '', arrendatario_nombre: '', arrendatario_identificacion: '',
    arrendatario_telefono: '', arrendatario_email: '',
    monto_renta: '', dia_pago: '5', fecha_inicio: '', fecha_fin: '', deposito: '', notas: '',
  })

  const filtrados = contratos.filter(c => filtroEstado === 'todos' || c.estado === filtroEstado)

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
    const r = await Swal.fire({ title: '¿Eliminar contrato?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('contratos_arrendamiento').delete().eq('id', id)
    onRefresh()
  }

  const isVence30 = (c: ContratoArrendamiento) =>
    !!c.fecha_fin && c.fecha_fin <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) && c.estado === 'activo'

  const columns: DataTableColumn<ContratoArrendamiento>[] = [
    {
      key: 'arrendatario_nombre',
      header: 'Arrendatario',
      sortable: true,
      render: row => (
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.arrendatario_nombre}</div>
          {row.arrendatario_telefono && <div style={{ fontSize: '12px', color: '#64748b' }}>{row.arrendatario_telefono}</div>}
        </div>
      ),
    },
    {
      key: 'unidad_nombre',
      header: 'Unidad',
      sortable: true,
      accessor: row => row.unidad_nombre ?? '',
      render: row => <span style={{ color: '#374151' }}>{row.unidad_nombre || '—'}</span>,
    },
    {
      key: 'monto_renta',
      header: 'Renta/mes',
      sortable: true,
      align: 'right',
      accessor: row => row.monto_renta,
      render: row => <span style={{ fontWeight: 700, color: '#0f172a' }}>{moneda} {row.monto_renta.toFixed(2)}</span>,
    },
    {
      key: 'dia_pago',
      header: 'Día pago',
      sortable: true,
      accessor: row => row.dia_pago,
      render: row => <span style={{ color: '#374151' }}>Día {row.dia_pago}</span>,
    },
    {
      key: 'periodo',
      header: 'Período',
      sortable: true,
      accessor: row => row.fecha_inicio,
      render: row => {
        const vence30 = isVence30(row)
        return (
          <div style={{ color: vence30 ? '#ea580c' : '#374151', fontWeight: vence30 ? 700 : 400 }}>
            {row.fecha_inicio}{row.fecha_fin ? ` → ${row.fecha_fin}` : ' →'}
            {vence30 && <span style={{ display: 'block', fontSize: '11px', color: '#ea580c' }}>⚠️ Por vencer</span>}
          </div>
        )
      },
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const ec = ESTADO_CONFIG[row.estado]
        return canEdit ? (
          <select value={row.estado} onChange={e => cambiarEstado(row.id, e.target.value as EstadoContrato)}
            onClick={e => e.stopPropagation()}
            style={{ padding: '4px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, border: 'none', cursor: 'pointer', background: ec.bg, color: ec.color }}>
            {(Object.entries(ESTADO_CONFIG) as [EstadoContrato, typeof ESTADO_CONFIG[EstadoContrato]][]).map(([v, cfg]) => (
              <option key={v} value={v}>{cfg.label}</option>
            ))}
          </select>
        ) : (
          <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
        )
      },
    },
    {
      key: 'acciones',
      header: '',
      render: row => {
        const vence30 = isVence30(row)
        return (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
            {vence30 && (
              <button
                title="Notificar renovación por WhatsApp"
                onClick={() => {
                  const msg = `📋 Aviso de vencimiento de contrato\nArrendatario: ${row.arrendatario_nombre}\nUnidad: ${row.unidad_nombre ?? ''}\nVencimiento: ${row.fecha_fin}\nPor favor comuníquese para coordinar la renovación.`
                  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#16a34a' }}
              >💬</button>
            )}
            {canEdit && <button onClick={() => startEdit(row)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#64748b' }}>✏️</button>}
            <button onClick={() => eliminar(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#ef4444' }}>🗑</button>
          </div>
        )
      },
    },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Arrendamientos</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {activos.length} contratos activos · <span style={{ fontWeight: 600, color: '#0ea5e9' }}>{moneda} {rentaTotal.toFixed(2)}/mes</span>
            {porVencer.length > 0 && <span style={{ color: '#ea580c', fontWeight: 600 }}> · {porVencer.length} por vencer</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportarPDF} disabled={contratos.length === 0} style={{ padding: '9px 14px', background: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>📄 PDF</button>
          <button onClick={exportarXlsx} disabled={contratos.length === 0} style={{ padding: '9px 14px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>📊 Excel</button>
          {canCreate && (
            <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              + Nuevo contrato
            </button>
          )}
        </div>
      </div>

      {/* Alerta por vencer */}
      {porVencer.length > 0 && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '18px' }}>⚠️</span>
          <span style={{ fontSize: '13.5px', color: '#9a3412', fontWeight: 600 }}>
            {porVencer.length} contrato{porVencer.length > 1 ? 's' : ''} vence{porVencer.length > 1 ? 'n' : ''} en los próximos 30 días: {porVencer.map(c => c.arrendatario_nombre).join(', ')}
          </span>
        </div>
      )}

      {/* Filtros pill (estado) — UX custom mantenido fuera */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'activo', 'vencido', 'terminado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0', background: filtroEstado === e ? '#eff6ff' : 'white', color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? 'Todos' : ESTADO_CONFIG[e].label}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editingId ? 'Editar contrato' : 'Nuevo contrato de arrendamiento'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre del arrendatario *</label>
              <input value={form.arrendatario_nombre} onChange={e => setForm(f => ({ ...f, arrendatario_nombre: e.target.value }))} placeholder="Nombre completo"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad *</label>
              <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="">Seleccionar...</option>
                {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
              <input value={form.arrendatario_identificacion} onChange={e => setForm(f => ({ ...f, arrendatario_identificacion: e.target.value }))} placeholder="Número de documento"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Teléfono</label>
              <input value={form.arrendatario_telefono} onChange={e => setForm(f => ({ ...f, arrendatario_telefono: e.target.value }))} placeholder="+502..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Email</label>
              <input type="email" value={form.arrendatario_email} onChange={e => setForm(f => ({ ...f, arrendatario_email: e.target.value }))} placeholder="correo@ejemplo.com"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Monto de renta ({moneda}) *</label>
              <input type="number" value={form.monto_renta} onChange={e => setForm(f => ({ ...f, monto_renta: e.target.value }))} placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Depósito ({moneda})</label>
              <input type="number" value={form.deposito} onChange={e => setForm(f => ({ ...f, deposito: e.target.value }))} placeholder="0.00" min="0" step="0.01"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Día de pago</label>
              <input type="number" value={form.dia_pago} onChange={e => setForm(f => ({ ...f, dia_pago: e.target.value }))} min="1" max="28"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha inicio *</label>
              <input type="date" value={form.fecha_inicio} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha fin (opcional)</label>
              <input type="date" value={form.fecha_fin} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Condiciones especiales, observaciones..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      <DataTable
        data={filtrados}
        columns={columns}
        rowKey="id"
        searchableKeys={['arrendatario_nombre', row => row.unidad_nombre ?? '', row => row.arrendatario_identificacion ?? '']}
        searchPlaceholder="Buscar arrendatario, unidad o DPI…"
        defaultSort={{ key: 'arrendatario_nombre', direction: 'asc' }}
        emptyState={{ icon: '📄', title: `No hay contratos${filtroEstado !== 'todos' ? ` con estado "${filtroEstado}"` : ''}` }}
      />
    </div>
  )
}
