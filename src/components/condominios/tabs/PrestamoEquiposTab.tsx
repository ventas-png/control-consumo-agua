import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { PrestamoEquipo, EstadoPrestamo, Unidad } from '../../../types'
import Swal from 'sweetalert2'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  prestamos: PrestamoEquipo[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<EstadoPrestamo, { color: string; bg: string; label: string }> = {
  prestado: { color: '#f59e0b', bg: '#fef3c7', label: 'Prestado' },
  devuelto: { color: '#10b981', bg: '#dcfce7', label: 'Devuelto' },
  dañado:   { color: '#ef4444', bg: '#fee2e2', label: 'Dañado'   },
  perdido:  { color: '#7c3aed', bg: '#ede9fe', label: 'Perdido'  },
}

const EQUIPOS_COMUNES = ['Sillas','Mesas','Proyector','Pantalla','Micrófono','Toldo','Cañonera','Extensiones','Decoraciones','Cocina','Otro']

const BLANK = {
  unidad_id: '', equipo_nombre: '', cantidad: 1,
  fecha_prestamo: new Date().toISOString().slice(0,10), hora_prestamo: '',
  fecha_devolucion: '', deposito: '', deposito_pagado: false,
  entregado_por: '', observaciones: '',
}

export function PrestamoEquiposTab({ prestamos, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoPrestamo | 'all'>('all')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  const filtered = prestamos.filter(p => filtroEstado === 'all' || p.estado === filtroEstado)
  const activos   = prestamos.filter(p => p.estado === 'prestado').length
  const conDeposito = prestamos.filter(p => p.estado === 'prestado' && p.deposito && p.deposito > 0).length

  async function handleSave() {
    if (!form.equipo_nombre.trim() || !form.unidad_id) return Swal.fire('Campos requeridos', 'Equipo y unidad son obligatorios.', 'warning')
    setSaving(true)
    const { error } = await supabase.from('prestamos_equipo').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id,
      equipo_nombre: form.equipo_nombre.trim(),
      cantidad: form.cantidad,
      fecha_prestamo: form.fecha_prestamo,
      hora_prestamo: form.hora_prestamo || null,
      deposito: form.deposito ? parseFloat(form.deposito) : null,
      deposito_pagado: form.deposito_pagado,
      entregado_por: form.entregado_por || null,
      observaciones: form.observaciones || null,
      estado: 'prestado',
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function marcarDevuelto(p: PrestamoEquipo) {
    const r = await Swal.fire({
      title: '¿Marcar como devuelto?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, devuelto', confirmButtonColor: '#10b981',
      input: 'text', inputLabel: 'Observaciones de devolución (opcional)', inputPlaceholder: 'Ej: devuelto en buen estado',
    })
    if (!r.isConfirmed) return
    await supabase.from('prestamos_equipo').update({
      estado: 'devuelto',
      fecha_devolucion: new Date().toISOString().slice(0, 10),
      hora_devolucion: new Date().toTimeString().slice(0, 5),
      observaciones: r.value || p.observaciones,
    }).eq('id', p.id)
    onRefresh()
  }

  async function marcarEstado(id: string, estado: EstadoPrestamo) {
    await supabase.from('prestamos_equipo').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar registro?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('prestamos_equipo').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  const columns: DataTableColumn<PrestamoEquipo>[] = [
    {
      key: 'equipo_nombre',
      header: 'Equipo',
      sortable: true,
      render: row => (
        <div style={{ fontWeight: 600 }}>
          {row.equipo_nombre}
          {row.observaciones && <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>{row.observaciones}</div>}
        </div>
      ),
    },
    {
      key: 'unidad_nombre',
      header: 'Unidad',
      sortable: true,
      accessor: row => row.unidad_nombre ?? '',
      render: row => <span style={{ color: '#64748b' }}>{row.unidad_nombre ?? '—'}</span>,
    },
    {
      key: 'cantidad',
      header: 'Qty',
      sortable: true,
      align: 'center',
      accessor: row => row.cantidad,
    },
    {
      key: 'fecha_prestamo',
      header: 'F. Préstamo',
      sortable: true,
      render: row => <span style={{ color: '#64748b' }}>{row.fecha_prestamo}{row.hora_prestamo ? ` ${row.hora_prestamo}` : ''}</span>,
    },
    {
      key: 'fecha_devolucion',
      header: 'F. Devolución',
      sortable: true,
      accessor: row => row.fecha_devolucion ?? '',
      render: row => <span style={{ color: '#64748b' }}>{row.fecha_devolucion ?? '—'}</span>,
    },
    {
      key: 'deposito',
      header: 'Depósito',
      sortable: true,
      align: 'right',
      accessor: row => row.deposito ?? 0,
      render: row => (
        row.deposito ? (
          <span style={{ fontSize: '12px', color: row.deposito_pagado ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
            {row.deposito_pagado ? '✓' : '!'} {row.deposito.toFixed(2)}
          </span>
        ) : <span style={{ color: '#cbd5e1' }}>—</span>
      ),
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const es = ESTADO_STYLE[row.estado]
        return <span style={{ background: es.bg, color: es.color, padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>{es.label}</span>
      },
    },
    {
      key: 'acciones',
      header: '',
      render: row => (
        canEdit ? (
          <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
            {row.estado === 'prestado' && (
              <>
                <button onClick={() => marcarDevuelto(row)}
                  style={{ padding: '3px 8px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                  ✓ Devuelto
                </button>
                <button onClick={() => marcarEstado(row.id, 'dañado')}
                  style={{ padding: '3px 7px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
                  Dañado
                </button>
              </>
            )}
            <button onClick={() => handleDelete(row.id)}
              style={{ padding: '3px 7px', background: '#f1f5f9', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#94a3b8' }}>🗑️</button>
          </div>
        ) : null
      ),
    },
  ]

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Préstamo de Equipos</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Préstamo
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Activos (prestados)', value: activos,                   color: '#f59e0b' },
          { label: 'Total histórico',     value: prestamos.length,          color: '#0f172a' },
          { label: 'Con depósito',        value: conDeposito,               color: '#8b5cf6' },
          { label: 'Dañados/Perdidos',    value: prestamos.filter(p => p.estado === 'dañado' || p.estado === 'perdido').length, color: '#ef4444' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo préstamo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Equipo *</label>
              <input style={inputStyle} list="equipos-list" value={form.equipo_nombre}
                onChange={e => setF('equipo_nombre', e.target.value)} placeholder="Ej: Sillas, Proyector…" autoFocus />
              <datalist id="equipos-list">{EQUIPOS_COMUNES.map(e => <option key={e} value={e} />)}</datalist>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Cantidad</label>
              <input style={inputStyle} type="number" min="1" value={form.cantidad} onChange={e => setF('cantidad', parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha préstamo</label>
              <input style={inputStyle} type="date" value={form.fecha_prestamo} onChange={e => setF('fecha_prestamo', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Hora</label>
              <input style={inputStyle} type="time" value={form.hora_prestamo} onChange={e => setF('hora_prestamo', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Depósito</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.deposito} onChange={e => setF('deposito', e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
              <input type="checkbox" checked={form.deposito_pagado} onChange={e => setF('deposito_pagado', e.target.checked)} id="dep_pagado" />
              <label htmlFor="dep_pagado" style={{ fontSize: '12px', color: '#64748b', cursor: 'pointer' }}>Depósito pagado</label>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Entregado por</label>
              <input style={inputStyle} value={form.entregado_por} onChange={e => setF('entregado_por', e.target.value)} placeholder="Nombre del encargado" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Observaciones</label>
              <input style={inputStyle} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Estado del equipo, condiciones, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter pill — UX custom mantenido fuera */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        {(['all','prestado','devuelto','dañado','perdido'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e as EstadoPrestamo | 'all')}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
              background: filtroEstado === e ? '#0f172a' : 'white',
              color: filtroEstado === e ? 'white' : '#64748b',
              borderColor: filtroEstado === e ? '#0f172a' : '#e2e8f0' }}>
            {e === 'all' ? 'Todos' : ESTADO_STYLE[e as EstadoPrestamo]?.label ?? e}
          </button>
        ))}
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        rowKey="id"
        searchableKeys={['equipo_nombre', row => row.unidad_nombre ?? '', row => row.entregado_por ?? '']}
        searchPlaceholder="Buscar por equipo, unidad o encargado…"
        pageSizeOptions={[25, 50, 100, 200]}
        defaultSort={{ key: 'fecha_prestamo', direction: 'desc' }}
        emptyState={{ icon: '📦', title: 'No hay préstamos registrados' }}
      />
    </div>
  )
}
