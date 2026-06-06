import { useState, type CSSProperties} from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import type { ConsumoEnergiaArea } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
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
  electricidad: { label: 'Electricidad', icon: '⚡', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', unidadDefault: 'kWh' },
  agua:         { label: 'Agua',         icon: '💧', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', unidadDefault: 'm3' },
  gas:          { label: 'Gas',          icon: '🔥', bg: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', unidadDefault: 'm3' },
  otro:         { label: 'Otro',         icon: '📊', bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', unidadDefault: 'unidad' },
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
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
    if (!form.area.trim() || !form.lectura_actual) return notify({ variant: 'warning', title: 'Campos requeridos', text: 'Área y lectura actual son obligatorias.' })
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
      ? await updateCondominioRow('consumo_energia_areas', editId, payload)
      : await createCondominioRow('consumo_energia_areas', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const handleDelete = async (c: ConsumoEnergiaArea) => {
    const r = await confirm({ title: '¿Eliminar registro?', text: `${c.area} · ${c.periodo}`, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('consumo_energia_areas', c.id)
    onRefresh()
  }

  const periodos = [...new Set(consumos.map(c => c.periodo))].sort().reverse()
  const areas = [...new Set(consumos.map(c => c.area))].sort()

  const filtered = consumos.filter(c =>
    (!filterTipo || c.tipo === filterTipo) &&
    (!filterPeriodo || c.periodo === filterPeriodo) &&
    (!filterArea || c.area === filterArea)
  )

  // KPIs for current period (latest)
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

  return (
    <div style={{ padding: '20px', maxWidth: '1100px', margin: '0 auto' }}>
      {/* KPIs */}
      {latestPeriodo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
          {[
            { label: `Costo total ${latestPeriodo}`, value: fmt(totalCostoPeriodo, moneda), icon: '💰', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
            { label: `Electricidad ${latestPeriodo}`, value: `${totalElec.toFixed(1)} kWh`, icon: '⚡', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' },
            { label: `Agua ${latestPeriodo}`, value: `${totalAgua.toFixed(1)} m³`, icon: '💧', bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nuevo registro
          </button>
        )}
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, width: '150px' }}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={filterPeriodo} onChange={e => setFilterPeriodo(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
          <option value="">Todos los períodos</option>
          {periodos.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterArea} onChange={e => setFilterArea(e.target.value)} style={{ ...inputStyle, width: '150px' }}>
          <option value="">Todas las áreas</option>
          {areas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar registro' : 'Nuevo registro de consumo'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Área *</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Lobby, Bomba principal" autoFocus list="areas-list" />
              <datalist id="areas-list">{areas.map(a => <option key={a} value={a} />)}</datalist>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo *</label>
              <select style={inputStyle} value={form.tipo} onChange={e => { setF('tipo', e.target.value); setF('unidad', TIPO_STYLE[e.target.value]?.unidadDefault ?? 'unidad') }}>
                {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Período *</label>
              <input style={inputStyle} type="month" value={form.periodo} onChange={e => setF('periodo', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Lectura anterior</label>
              <input style={inputStyle} type="number" step="0.001" value={form.lectura_anterior} onChange={e => setF('lectura_anterior', e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Lectura actual *</label>
              <input style={inputStyle} type="number" step="0.001" value={form.lectura_actual} onChange={e => setF('lectura_actual', e.target.value)} placeholder="0.000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <input style={inputStyle} value={form.unidad} onChange={e => setF('unidad', e.target.value)} placeholder="kWh, m3..." />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Costo unitario</label>
              <input style={inputStyle} type="number" step="0.0001" value={form.costo_unitario} onChange={e => setF('costo_unitario', e.target.value)} placeholder="0.0000" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha lectura</label>
              <input style={inputStyle} type="date" value={form.fecha_lectura} onChange={e => setF('fecha_lectura', e.target.value)} />
            </div>
            {form.lectura_anterior && form.lectura_actual && form.costo_unitario && (
              <div style={{ background: 'var(--at-success-tint)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Consumo calculado</div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--at-success)' }}>
                  {(parseFloat(form.lectura_actual) - parseFloat(form.lectura_anterior)).toFixed(2)} {form.unidad}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--at-success)' }}>
                  ≈ {fmt((parseFloat(form.lectura_actual) - parseFloat(form.lectura_anterior)) * parseFloat(form.costo_unitario), moneda)}
                </div>
              </div>
            )}
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Observaciones" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<ConsumoEnergiaArea>
        data={filtered}
        rowKey="id"
        pageSize={50}
        searchableKeys={['area', 'periodo']}
        searchPlaceholder="Buscar área o período..."
        emptyState={{ icon: '📊', title: 'Sin registros de consumo' }}
        defaultSort={{ key: 'fecha_lectura', direction: 'desc' }}
        columns={[
          {
            key: 'tipo',
            header: 'Tipo',
            sortable: true,
            render: (c) => {
              const ts = TIPO_STYLE[c.tipo]
              return (
                <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: ts.bg, color: ts.color }}>
                  {ts.icon} {ts.label}
                </span>
              )
            },
          },
          { key: 'area', header: 'Área', sortable: true, render: (c) => <span style={{ fontWeight: 600 }}>{c.area}</span> },
          { key: 'periodo', header: 'Período', sortable: true },
          {
            key: 'lectura_anterior',
            header: 'Lect. Ant.',
            align: 'right',
            hideOnMobile: true,
            render: (c) => c.lectura_anterior != null ? c.lectura_anterior.toFixed(2) : '—',
          },
          {
            key: 'lectura_actual',
            header: 'Lect. Act.',
            align: 'right',
            hideOnMobile: true,
            render: (c) => <span style={{ fontWeight: 600 }}>{c.lectura_actual.toFixed(2)}</span>,
          },
          {
            key: 'consumo',
            header: 'Consumo',
            align: 'right',
            accessor: (c) => c.lectura_anterior != null ? c.lectura_actual - c.lectura_anterior : null,
            render: (c) => {
              const consumo = c.lectura_anterior != null ? c.lectura_actual - c.lectura_anterior : null
              return consumo != null
                ? <span style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{consumo.toFixed(2)} {c.unidad}</span>
                : '—'
            },
          },
          {
            key: 'costo_unitario',
            header: 'Costo unit.',
            align: 'right',
            hideOnMobile: true,
            render: (c) => c.costo_unitario != null ? c.costo_unitario.toFixed(4) : '—',
          },
          {
            key: 'total_costo',
            header: 'Total',
            align: 'right',
            sortable: true,
            render: (c) => c.total_costo != null
              ? <span style={{ fontWeight: 700, color: 'var(--at-success)' }}>{fmt(c.total_costo, moneda)}</span>
              : '—',
          },
          {
            key: 'fecha_lectura',
            header: 'Fecha',
            sortable: true,
            hideOnMobile: true,
            render: (c) => <span style={{ whiteSpace: 'nowrap' }}>{c.fecha_lectura}</span>,
          },
          {
            key: '__actions',
            header: '',
            render: (c) => (
              <div style={{ display: 'flex', gap: '4px' }}>
                {canEdit && (
                  <button
                    onClick={() => openEdit(c)}
                    aria-label="Editar registro"
                    style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}
                  >
                    ✏️
                  </button>
                )}
                <button
                  onClick={() => handleDelete(c)}
                  aria-label="Eliminar registro"
                  style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', color: 'var(--at-danger)' }}
                >
                  🗑
                </button>
              </div>
            ),
          },
        ] satisfies DataTableColumn<ConsumoEnergiaArea>[]}
      />
    </div>
  )
}
