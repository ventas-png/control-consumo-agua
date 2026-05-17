import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { GastoCondominio, CategoriaGasto, EstadoGasto } from '../../../types'
import Swal from 'sweetalert2'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  gastos: GastoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CAT_CONFIG: Record<CategoriaGasto, { label: string; icon: string; color: string }> = {
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', color: '#0ea5e9' },
  servicios:     { label: 'Servicios',     icon: '💡', color: '#f59e0b' },
  administrativo:{ label: 'Administrativo',icon: '📋', color: '#8b5cf6' },
  seguridad:     { label: 'Seguridad',     icon: '🛡️', color: '#ef4444' },
  limpieza:      { label: 'Limpieza',      icon: '🧹', color: '#10b981' },
  obras:         { label: 'Obras',         icon: '🏗️', color: '#f97316' },
  otros:         { label: 'Otros',         icon: '📁', color: '#94a3b8' },
}

const ESTADO_CONFIG: Record<EstadoGasto, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: '#f59e0b', bg: '#fef3c7' },
  pagado:    { label: 'Pagado',    color: '#10b981', bg: '#d1fae5' },
  anulado:   { label: 'Anulado',   color: '#94a3b8', bg: '#f1f5f9' },
}

const blank = (): Partial<GastoCondominio> => ({
  concepto: '', categoria: 'otros', monto: undefined,
  fecha: new Date().toISOString().slice(0, 10),
  proveedor_nombre: '', estado: 'pagado', metodo_pago: 'transferencia',
  comprobante_num: '', notas: '',
})

function barWidth(val: number, max: number) {
  return max > 0 ? `${Math.min(100, Math.round((val / max) * 100))}%` : '0%'
}

export function ContabilidadTab({ gastos, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [filtroCat, setFiltroCat] = useState<CategoriaGasto | 'todos'>('todos')
  const [filtroEstado, setFiltroEstado] = useState<EstadoGasto | 'todos'>('todos')
  const [form, setForm] = useState<Partial<GastoCondominio>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const thisMonth = new Date().toISOString().slice(0, 7)
  const thisYear  = new Date().getFullYear().toString()

  const pagados   = gastos.filter(g => g.estado === 'pagado')
  const pendientes = gastos.filter(g => g.estado === 'pendiente')
  const totalAnio  = pagados.filter(g => g.fecha.startsWith(thisYear)).reduce((s, g) => s + g.monto, 0)
  const totalMes   = pagados.filter(g => g.fecha.startsWith(thisMonth)).reduce((s, g) => s + g.monto, 0)

  const porCat: Partial<Record<CategoriaGasto, number>> = {}
  for (const g of pagados.filter(g => g.fecha.startsWith(thisYear))) {
    porCat[g.categoria] = (porCat[g.categoria] ?? 0) + g.monto
  }
  const catEntries = Object.entries(porCat).sort((a, b) => b[1] - a[1]) as [CategoriaGasto, number][]
  const maxCat = Math.max(...catEntries.map(([, v]) => v), 1)

  const filtered = gastos.filter(g =>
    (filtroCat === 'todos' || g.categoria === filtroCat) &&
    (filtroEstado === 'todos' || g.estado === filtroEstado)
  )

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Gastos del Condominio',
      proyectoNombre,
      headers: ['Fecha', 'Concepto', 'Categoría', 'Monto', 'Estado', 'Proveedor'],
      rows: filtered.map(g => [g.fecha, g.concepto, CAT_CONFIG[g.categoria].label, `${moneda} ${g.monto.toFixed(2)}`, ESTADO_CONFIG[g.estado].label, g.proveedor_nombre ?? '—']),
      totalesRow: ['', '', 'TOTAL PAGADOS', `${moneda} ${filtered.filter(g => g.estado === 'pagado').reduce((s, g) => s + g.monto, 0).toFixed(2)}`, '', ''],
      rightAlignCols: [3],
      filename: `gastos-${new Date().toISOString().slice(0, 7)}`,
    })
  }

  function exportarXlsx() {
    exportarExcel(`gastos-${new Date().toISOString().slice(0, 7)}`, [{
      name: 'Gastos',
      headers: ['Fecha', 'Concepto', 'Categoría', 'Monto', 'Estado', 'Proveedor', 'Método Pago', 'No. Comprobante', 'Notas'],
      rows: gastos.map(g => [g.fecha, g.concepto, CAT_CONFIG[g.categoria].label, g.monto, ESTADO_CONFIG[g.estado].label, g.proveedor_nombre ?? '', g.metodo_pago ?? '', g.comprobante_num ?? '', g.notas ?? '']),
    }])
  }

  function startEdit(g: GastoCondominio) {
    setForm({
      concepto: g.concepto, categoria: g.categoria, monto: g.monto, fecha: g.fecha,
      proveedor_nombre: g.proveedor_nombre ?? '', estado: g.estado,
      metodo_pago: g.metodo_pago ?? 'transferencia',
      comprobante_num: g.comprobante_num ?? '', notas: g.notas ?? '',
    })
    setEditId(g.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.concepto?.trim()) return Swal.fire('Campo requerido', 'Ingresa el concepto.', 'warning')
    if (!form.monto || form.monto <= 0) return Swal.fire('Campo requerido', 'Ingresa el monto.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      concepto: form.concepto!.trim(), categoria: form.categoria ?? 'otros',
      monto: form.monto!, fecha: form.fecha!,
      proveedor_nombre: form.proveedor_nombre || null,
      estado: form.estado ?? 'pagado',
      metodo_pago: form.metodo_pago || null,
      comprobante_num: form.comprobante_num || null,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('gastos_condominio').update(payload).eq('id', editId)
      : await supabase.from('gastos_condominio').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar gasto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('gastos_condominio').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  const columns: DataTableColumn<GastoCondominio>[] = [
    {
      key: 'fecha',
      header: 'Fecha',
      sortable: true,
      render: row => <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{row.fecha}</span>,
    },
    {
      key: 'concepto',
      header: 'Concepto',
      sortable: true,
      render: row => (
        <div style={{ fontWeight: 600, color: '#0f172a' }}>
          {row.concepto}
          {row.proveedor_nombre && <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 400 }}>{row.proveedor_nombre}</div>}
        </div>
      ),
    },
    {
      key: 'categoria',
      header: 'Categoría',
      sortable: true,
      accessor: row => CAT_CONFIG[row.categoria].label,
      render: row => {
        const cat = CAT_CONFIG[row.categoria]
        return <span style={{ fontSize: '11px', fontWeight: 600, color: cat.color }}>{cat.icon} {cat.label}</span>
      },
    },
    {
      key: 'monto',
      header: 'Monto',
      sortable: true,
      align: 'right',
      accessor: row => row.monto,
      render: row => <span style={{ fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' }}>{moneda} {row.monto.toFixed(2)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const est = ESTADO_CONFIG[row.estado]
        return <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
      },
    },
    {
      key: 'acciones',
      header: '',
      render: row => (
        canEdit ? (
          <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => startEdit(row)} style={{ padding: '3px 7px', background: '#f1f5f9', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
            <button onClick={() => handleDelete(row.id)} style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
          </div>
        ) : null
      ),
    },
  ]

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: `Gastos ${thisYear}`, value: `${moneda} ${totalAnio.toFixed(0)}`,     icon: '📊', color: '#0ea5e9' },
          { label: 'Gastos del mes',    value: `${moneda} ${totalMes.toFixed(0)}`,       icon: '📅', color: '#8b5cf6' },
          { label: 'Pendientes pago',   value: `${moneda} ${pendientes.reduce((s,g) => s+g.monto,0).toFixed(0)}`, icon: '⏳', color: '#f59e0b' },
          { label: 'Registros',         value: String(gastos.length),                    icon: '🗂️', color: '#10b981' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '20px', marginBottom: '20px', alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Gastos del Condominio</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={exportarPDF} disabled={filtered.length === 0} style={{ padding: '6px 12px', background: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📄 PDF</button>
              <button onClick={exportarXlsx} disabled={gastos.length === 0} style={{ padding: '6px 12px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '12px' }}>📊 Excel</button>
              {canCreate && !showForm && (
                <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nuevo Gasto</button>
              )}
            </div>
          </div>

          {showForm && (
            <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Gasto' : 'Registrar Gasto'}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Concepto *</label>
                  <input style={inputStyle} value={form.concepto ?? ''} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))} placeholder="Ej: Factura electricidad febrero" />
                </div>
                <div>
                  <label style={labelStyle}>Categoría</label>
                  <select style={inputStyle} value={form.categoria ?? 'otros'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaGasto }))}>
                    {Object.entries(CAT_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Monto ({moneda}) *</label>
                  <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto ?? ''} onChange={e => setForm(f => ({ ...f, monto: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
                </div>
                <div>
                  <label style={labelStyle}>Fecha *</label>
                  <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Estado</label>
                  <select style={inputStyle} value={form.estado ?? 'pagado'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoGasto }))}>
                    {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Proveedor</label>
                  <input style={inputStyle} value={form.proveedor_nombre ?? ''} onChange={e => setForm(f => ({ ...f, proveedor_nombre: e.target.value }))} placeholder="Nombre empresa/persona" />
                </div>
                <div>
                  <label style={labelStyle}>Método de pago</label>
                  <select style={inputStyle} value={form.metodo_pago ?? 'transferencia'} onChange={e => setForm(f => ({ ...f, metodo_pago: e.target.value }))}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="cheque">Cheque</option>
                    <option value="tarjeta">Tarjeta</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>No. Comprobante</label>
                  <input style={inputStyle} value={form.comprobante_num ?? ''} onChange={e => setForm(f => ({ ...f, comprobante_num: e.target.value }))} placeholder="Factura / recibo" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Notas</label>
                  <input style={inputStyle} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
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

          {/* Filtros pill por categoría (UX custom con contadores) */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {(['todos', ...Object.keys(CAT_CONFIG)] as const).map(c => (
              <button key={c} onClick={() => setFiltroCat(c as CategoriaGasto | 'todos')}
                style={{ padding: '4px 10px', borderRadius: '16px', border: '1.5px solid', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                  borderColor: filtroCat === c ? '#0ea5e9' : '#e2e8f0',
                  background: filtroCat === c ? '#e0f2fe' : 'white',
                  color: filtroCat === c ? '#0ea5e9' : '#64748b' }}>
                {c === 'todos' ? `Todos (${gastos.length})` : `${CAT_CONFIG[c as CategoriaGasto].icon} ${CAT_CONFIG[c as CategoriaGasto].label}`}
              </button>
            ))}
          </div>

          <DataTable
            data={filtered}
            columns={columns}
            rowKey="id"
            searchableKeys={['concepto', row => row.proveedor_nombre ?? '', row => row.comprobante_num ?? '']}
            searchPlaceholder="Buscar por concepto, proveedor o comprobante…"
            filters={[
              {
                key: 'estado',
                value: filtroEstado,
                onChange: v => setFiltroEstado(v as EstadoGasto | 'todos'),
                options: [
                  { value: 'todos', label: 'Todos los estados' },
                  ...Object.entries(ESTADO_CONFIG).map(([k, v]) => ({ value: k, label: v.label })),
                ],
              },
            ]}
            pageSizeOptions={[25, 50, 100, 200]}
            defaultSort={{ key: 'fecha', direction: 'desc' }}
            emptyState={{ icon: '🧾', title: 'No hay gastos registrados' }}
          />
        </div>

        {/* Panel de categorías (sticky) */}
        <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', position: 'sticky', top: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>📊 Gastos por categoría ({thisYear})</h3>
          {catEntries.length === 0 ? (
            <p style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', margin: '20px 0' }}>Sin datos</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {catEntries.map(([cat, total]) => {
                const c = CAT_CONFIG[cat]
                return (
                  <div key={cat}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                      <span style={{ color: '#64748b', fontWeight: 600 }}>{c.icon} {c.label}</span>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{moneda} {total.toFixed(0)}</span>
                    </div>
                    <div style={{ background: '#f1f5f9', borderRadius: '4px', height: '7px' }}>
                      <div style={{ background: c.color, height: '7px', borderRadius: '4px', width: barWidth(total, maxCat), transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                <span>Total pagado</span>
                <span>{moneda} {totalAnio.toFixed(0)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
