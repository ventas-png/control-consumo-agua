import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { PrestamoEquipo, EstadoPrestamo, Unidad } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
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
  prestado: { color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', label: 'Prestado' },
  devuelto: { color: 'var(--at-success)', bg: 'var(--at-success-tint)', label: 'Devuelto' },
  dañado:   { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', label: 'Dañado'   },
  perdido:  { color: 'var(--at-accent-hover)', bg: 'var(--at-accent-tint)', label: 'Perdido'  },
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
    if (!form.equipo_nombre.trim() || !form.unidad_id) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Equipo y unidad son obligatorios.' })
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
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function marcarDevuelto(p: PrestamoEquipo) {
    const result = await openPromptDialog({
      title: '¿Marcar como devuelto?',
      fields: [{
        name: 'observaciones',
        label: 'Observaciones de devolución (opcional)',
        placeholder: 'Ej: devuelto en buen estado',
        autoFocus: true,
      }],
      submitText: 'Sí, devuelto',
    })
    if (!result) return
    await supabase.from('prestamos_equipo').update({
      estado: 'devuelto',
      fecha_devolucion: new Date().toISOString().slice(0, 10),
      hora_devolucion: new Date().toTimeString().slice(0, 5),
      observaciones: result.observaciones || p.observaciones,
    }).eq('id', p.id)
    onRefresh()
  }

  async function marcarEstado(id: string, estado: EstadoPrestamo) {
    await supabase.from('prestamos_equipo').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar registro?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('prestamos_equipo').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Préstamo de Equipos</h2>
        {canCreate && (
          <button onClick={() => setShowForm(v => !v)}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Registrar Préstamo
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Activos (prestados)', value: activos,                   color: 'var(--at-warning)' },
          { label: 'Total histórico',     value: prestamos.length,          color: 'var(--at-ink)' },
          { label: 'Con depósito',        value: conDeposito,               color: 'var(--at-accent)' },
          { label: 'Dañados/Perdidos',    value: prestamos.filter(p => p.estado === 'dañado' || p.estado === 'perdido').length, color: 'var(--at-danger)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo préstamo</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Equipo *</label>
              <input style={inputStyle} list="equipos-list" value={form.equipo_nombre}
                onChange={e => setF('equipo_nombre', e.target.value)} placeholder="Ej: Sillas, Proyector…" autoFocus />
              <datalist id="equipos-list">{EQUIPOS_COMUNES.map(e => <option key={e} value={e} />)}</datalist>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Cantidad</label>
              <input style={inputStyle} type="number" min="1" value={form.cantidad} onChange={e => setF('cantidad', parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha préstamo</label>
              <input style={inputStyle} type="date" value={form.fecha_prestamo} onChange={e => setF('fecha_prestamo', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Hora</label>
              <input style={inputStyle} type="time" value={form.hora_prestamo} onChange={e => setF('hora_prestamo', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Depósito</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.deposito} onChange={e => setF('deposito', e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
              <input type="checkbox" checked={form.deposito_pagado} onChange={e => setF('deposito_pagado', e.target.checked)} id="dep_pagado" />
              <label htmlFor="dep_pagado" style={{ fontSize: '12px', color: 'var(--at-ink-3)', cursor: 'pointer' }}>Depósito pagado</label>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Entregado por</label>
              <input style={inputStyle} value={form.entregado_por} onChange={e => setF('entregado_por', e.target.value)} placeholder="Nombre del encargado" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Observaciones</label>
              <input style={inputStyle} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Estado del equipo, condiciones, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {(['all','prestado','devuelto','dañado','perdido'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e as EstadoPrestamo | 'all')}
            style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 600, borderRadius: '20px', border: '1.5px solid', cursor: 'pointer',
              background: filtroEstado === e ? 'var(--at-ink)' : 'var(--at-surface)',
              color: filtroEstado === e ? 'white' : 'var(--at-ink-3)',
              borderColor: filtroEstado === e ? 'var(--at-ink)' : 'var(--at-line)' }}>
            {e === 'all' ? 'Todos' : ESTADO_STYLE[e as EstadoPrestamo]?.label ?? e}
          </button>
        ))}
      </div>

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<PrestamoEquipo>
        data={filtered}
        rowKey="id"
        pageSize={50}
        defaultSort={{ key: 'fecha_prestamo', direction: 'desc' }}
        emptyState={{ icon: '📋', title: 'No hay préstamos registrados' }}
        columns={[
          { key: 'equipo_nombre', header: 'Equipo', sortable: true,
            render: (p) => (
              <div style={{ fontWeight: 600 }}>
                {p.equipo_nombre}
                {p.observaciones && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 400 }}>{p.observaciones}</div>}
              </div>
            ) },
          { key: 'unidad_nombre', header: 'Unidad', sortable: true,
            accessor: (p) => p.unidad_nombre ?? '',
            render: (p) => <span style={{ color: 'var(--at-ink-3)' }}>{p.unidad_nombre ?? '—'}</span> },
          { key: 'cantidad', header: 'Qty', align: 'center', sortable: true, hideOnMobile: true,
            render: (p) => p.cantidad },
          { key: 'fecha_prestamo', header: 'F. Préstamo', sortable: true,
            render: (p) => <span style={{ color: 'var(--at-ink-3)' }}>{p.fecha_prestamo}{p.hora_prestamo ? ` ${p.hora_prestamo}` : ''}</span> },
          { key: 'fecha_devolucion', header: 'F. Devolución', sortable: true, hideOnMobile: true,
            accessor: (p) => p.fecha_devolucion ?? '',
            render: (p) => p.fecha_devolucion ? <span style={{ color: 'var(--at-ink-3)' }}>{p.fecha_devolucion}</span> : <span style={{ color: 'var(--at-line-strong)' }}>—</span> },
          { key: 'deposito', header: 'Depósito', align: 'right', sortable: true, hideOnMobile: true,
            accessor: (p) => p.deposito ?? 0,
            render: (p) => p.deposito ? (
              <span style={{ fontSize: 12, color: p.deposito_pagado ? 'var(--at-success)' : 'var(--at-warning)', fontWeight: 600 }}>
                {p.deposito_pagado ? '✓' : '!'} {p.deposito.toFixed(2)}
              </span>
            ) : <span style={{ color: 'var(--at-line-strong)' }}>—</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (p) => {
              const es = ESTADO_STYLE[p.estado]
              return <span style={{ background: es.bg, color: es.color, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{es.label}</span>
            } },
          { key: 'actions', header: '', align: 'right',
            render: (p) => canEdit ? (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {p.estado === 'prestado' && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); marcarDevuelto(p) }}
                      style={{ padding: '3px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                      ✓ Devuelto
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); marcarEstado(p.id, 'dañado') }}
                      style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                      Dañado
                    </button>
                  </>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }} aria-label="Eliminar préstamo"
                  style={{ padding: '3px 7px', background: 'var(--at-chip)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer', color: 'var(--at-ink-3)' }}>🗑️</button>
              </div>
            ) : null },
        ] satisfies DataTableColumn<PrestamoEquipo>[]}
      />
    </div>
  )
}
