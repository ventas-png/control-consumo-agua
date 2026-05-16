import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ConsumoEnergiaArea } from '../../../types'
import Swal from 'sweetalert2'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  consumos: ConsumoEnergiaArea[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { label: string; icon: string; bg: string; color: string; unidadDefault: string }> = {
  electricidad: { label: 'Electricidad', icon: '⚡', bg: '#fef3c7', color: '#92400e', unidadDefault: 'kWh' },
  agua:         { label: 'Agua',         icon: '💧', bg: '#e0f2fe', color: '#0369a1', unidadDefault: 'm3' },
  gas:          { label: 'Gas',          icon: '🔥', bg: '#fed7aa', color: '#c2410c', unidadDefault: 'm3' },
  otro:         { label: 'Otro',         icon: '📊', bg: '#f3e8ff', color: '#7c3aed', unidadDefault: 'unidad' },
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid #e2e8f0',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

const BLANK = {
  area: '', tipo: 'electricidad', periodo: new Date().toISOString().slice(0, 7),
  lectura_anterior: '', lectura_actual: '', unidad: 'kWh',
  costo_unitario: '', total_costo: '', fecha_lectura: new Date().toISOString().slice(0, 10), notas: '',
}

function fmt(n: number, m: string) {
  return `${m} ${n.toLocaleString('es-GT', { minimumFractionDigits: 2 })}`
}

export function ConsumoEnergiaAreasTab({ consumos, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterTipo, setFilterTipo] = useState('')
  const [filterPeriodo, setFilterPeriodo] = useState('')
  const [filterArea, setFilterArea] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true) }
  const openEdit = (c: ConsumoEnergiaArea) => {
    setForm({
      area: c.area, tipo: c.tipo, periodo: c.periodo,
      lectura_anterior: c.lectura_anterior != null ? String(c.lectura_anterior) : '',
      lectura_actual: String(c.lectura_actual), unidad: c.unidad,
      costo_unitario: c.costo_unitario != null ? String(c.costo_unitario) : '',
      total_costo: c.total_costo != null ? String(c.total_costo) : '',
      fecha_lectura: c.fecha_lectura, notas: c.notas ?? '',
    })
    setEditId(c.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.area.trim() || !form.lectura_actual) return Swal.fire('Campos requeridos', 'Área y lectura actual son obligatorias.', 'warning')
    setSaving(true)
    const la = form.lectura_anterior ? parseFloat(form.lectura_anterior) : null
    const lac = parseFloat(form.lectura_actual)
    const cu = form.costo_unitario ? parseFloat(form.costo_unitario) : null
    const consumo = la != null ? lac - la : null
    const total = consumo != null && cu != null ? parseFloat((consumo * cu).toFixed(2)) : form.total_costo ? parseFloat(form.total_costo) : null

    const payload = {
      company_id: companyId, project_id: proyectoId,
      area: form.area.trim(), tipo: form.tipo, periodo: form.periodo,
      lectura_anterior: la, lectura_actual: lac, unidad: form.unidad,
      costo_unitario: cu, total_costo: total, fecha_lectura: form.fecha_lectura,
      notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('consumo_energia_areas').update(payload).eq('id', editId)
      : await supabase.from('consumo_energia_areas').insert(payload)
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); onRefresh()
  }

  const handleDelete = async (c: ConsumoEnergiaArea) => {
    const r = await Swal.fire({ title: '¿Eliminar registro?', text: `${c.area} · ${c.periodo}`, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('consumo_energia_areas').delete().eq('id', c.id)
    onRefresh()
  }

  const periodos = [...new Set(consumos.map(c => c.periodo))].sort().reverse()
  const areas = [...new Set(consumos.map(c => c.area))].sort()

  const filtered = consumos.filter(c =>
    (!filterTipo || c.tipo === filterTipo) &&
    (!filterPeriodo || c.periodo === filterPeriodo) &&
    (!filterArea || c.area === filterArea)
  )

  const latestPeriodo = periodos[0] ?? ''
  const latestConsumos = consumos.filter(c => c.periodo === latestPeriodo)
  const totalCostoPeriodo = latestConsumos.reduce((a, c) => a + (c.total_costo ?? 0), 0)
  const totalElec = latestConsumos.filter(c => c.tipo === 'electricidad').reduce((a, c) => {
    const consumo = c.lectura_anterior != null ? c.lectura_actual - c.lectura_anterior : 0
    return a + consumo
  }, 0)
  const totalAgua = latestConsumos.filter(c => c.tipo === 'agua').reduce((a, c) => {
    const consumo = c.lectura_anterior != null ? c.lectura_actual - c.lectura_anterior : 0
    return a + consumo
  }, 0)

  const columns: DataTableColumn<ConsumoEnergiaArea>[] = [
    {
      key: 'tipo',
      header: 'Tipo',
      sortable: true,
      render: row => {
        const ts = TIPO_STYLE[row.tipo]
        return <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.icon} {ts.label}</span>
      },
    },
    {
      key: 'area',
      header: 'Área',
      sortable: true,
      render: row => <span style={{ fontWeight: 600 }}>{row.area}</span>,
    },
    {
      key: 'periodo',
      header: 'Período',
      sortable: true,
      render: row => <span style={{ color: '#64748b' }}>{row.periodo}</span>,
    },
    {
      key: 'lectura_anterior',
      header: 'Lect. Ant.',
      sortable: true,
      align: 'right',
      accessor: row => row.lectura_anterior ?? 0,
      render: row => <span style={{ color: '#64748b' }}>{row.lectura_anterior != null ? row.lectura_anterior.toFixed(2) : '—'}</span>,
    },
    {
      key: 'lectura_actual',
      header: 'Lect. Act.',
      sortable: true,
      align: 'right',
      accessor: row => row.lectura_actual,
      render: row => <span style={{ fontWeight: 600 }}>{row.lectura_actual.toFixed(2)}</span>,
    },
    {
      key: 'consumo',
      header: 'Consumo',
      sortable: true,
      align: 'right',
      accessor: row => row.lectura_anterior != null ? row.lectura_actual - row.lectura_anterior : 0,
      render: row => {
        const consumo = row.lectura_anterior != null ? row.lectura_actual - row.lectura_anterior : null
        return (
          <span style={{ fontWeight: 700, color: '#0ea5e9' }}>
            {consumo != null ? `${consumo.toFixed(2)} ${row.unidad}` : '—'}
          </span>
        )
      },
    },
    {
      key: 'costo_unitario',
      header: 'Costo unit.',
      sortable: true,
      align: 'right',
      accessor: row => row.costo_unitario ?? 0,
      render: row => <span style={{ color: '#64748b' }}>{row.costo_unitario != null ? row.costo_unitario.toFixed(4) : '—'}</span>,
    },
    {
      key: 'total_costo',
      header: 'Total',
      sortable: true,
      align: 'right',
      accessor: row => row.total_costo ?? 0,
      render: row => (
        <span style={{ fontWeight: 700, color: '#16a34a' }}>
          {row.total_costo != null ? fmt(row.total_costo, moneda) : '—'}
        </span>
      ),
    },
    {
      key: 'fecha_lectura',
      header: 'Fecha',
      sortable: true,
      render: row => <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{row.fecha_lectura}</span>,
    },
    {
      key: 'acciones',
      header: '',
      render: row => (
        <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
          {canEdit && <button onClick={() => openEdit(row)} style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>✏️</button>}
          <button onClick={() => handleDelete(row)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: '#ef4444' }}>🗑</button>
        </div>
      ),
    },
  ]

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>
      {/* KPIs */}
      {latestPeriodo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
          {[
            { label: `Costo total ${latestPeriodo}`, value: fmt(totalCostoPeriodo, moneda), icon: '💰', bg: '#f0fdf4', color: '#16a34a' },
            { label: `Electricidad ${latestPeriodo}`, value: `${totalElec.toFixed(1)} kWh`, icon: '⚡', bg: '#fef3c7', color: '#92400e' },
            { label: `Agua ${latestPeriodo}`, value: `${totalAgua.toFixed(1)} m³`, icon: '💧', bg: '#e0f2fe', color: '#0369a1' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Botón Nuevo */}
      {canCreate && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
          <button onClick={openNew} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nuevo registro
          </button>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar registro' : 'Nuevo registro de consumo'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Área *</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Lobby, Bomba principal" autoFocus list="areas-list" />
              <datalist id="areas-list">{areas.map(a => <option key={a} value={a} />)}</datalist>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => { setF('tipo', e.target.value); setF('unidad', TIPO_STYLE[e.target.value]?.unidadDefault ?? 'unidad') }}>
                {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Período *</label>
              <input style={inputStyle} type="month" value={form.periodo} onChange={e => setF('periodo', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Lectura anterior</label>
              <input style={inputStyle} type="number" step="0.001" value={form.lectura_anterior} onChange={e => setF('lectura_anterior', e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Lectura actual *</label>
              <input style={inputStyle} type="number" step="0.001" value={form.lectura_actual} onChange={e => setF('lectura_actual', e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <input style={inputStyle} value={form.unidad} onChange={e => setF('unidad', e.target.value)} placeholder="kWh, m3..." />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Costo unitario</label>
              <input style={inputStyle} type="number" step="0.0001" value={form.costo_unitario} onChange={e => setF('costo_unitario', e.target.value)} placeholder="0.0000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha lectura</label>
              <input style={inputStyle} type="date" value={form.fecha_lectura} onChange={e => setF('fecha_lectura', e.target.value)} />
            </div>
            {form.lectura_anterior && form.lectura_actual && form.costo_unitario && (
              <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Consumo calculado</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#16a34a' }}>
                  {(parseFloat(form.lectura_actual) - parseFloat(form.lectura_anterior)).toFixed(2)} {form.unidad}
                </div>
                <div style={{ fontSize: '12px', color: '#16a34a' }}>
                  ≈ {fmt((parseFloat(form.lectura_actual) - parseFloat(form.lectura_anterior)) * parseFloat(form.costo_unitario), moneda)}
                </div>
              </div>
            )}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      <DataTable
        data={filtered}
        columns={columns}
        rowKey="id"
        searchableKeys={['area', row => row.notas ?? '']}
        searchPlaceholder="Buscar por área o notas…"
        filters={[
          {
            key: 'tipo',
            value: filterTipo,
            onChange: setFilterTipo,
            options: [
              { value: '', label: 'Todos los tipos' },
              ...Object.entries(TIPO_STYLE).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` })),
            ],
          },
          {
            key: 'periodo',
            value: filterPeriodo,
            onChange: setFilterPeriodo,
            options: [{ value: '', label: 'Todos los períodos' }, ...periodos.map(p => ({ value: p, label: p }))],
          },
          {
            key: 'area',
            value: filterArea,
            onChange: setFilterArea,
            options: [{ value: '', label: 'Todas las áreas' }, ...areas.map(a => ({ value: a, label: a }))],
          },
        ]}
        defaultSort={{ key: 'fecha_lectura', direction: 'desc' }}
        emptyState={{ icon: '📊', title: 'Sin registros de consumo' }}
      />
    </div>
  )
}
