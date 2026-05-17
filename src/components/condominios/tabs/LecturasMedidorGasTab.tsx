import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { LecturaMedidorGas, Unidad } from '../../../types'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  lecturas: LecturaMedidorGas[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

export default function LecturasMedidorGasTab({ lecturas, unidades, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroPeriodo, setFiltroPeriodo] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const periodos = [...new Set(lecturas.map(l => l.periodo).filter(Boolean))].sort().reverse() as string[]

  const [form, setForm] = useState({
    unidad_id: '', area: '',
    fecha: new Date().toISOString().split('T')[0],
    lectura_anterior: '', lectura_actual: '',
    costo_unitario: '', alerta_fuga: false,
    periodo: new Date().toISOString().slice(0, 7),
    leido_por: '', observaciones: '',
  })

  const lista = lecturas.filter(l =>
    (filtroUnidad === '' || l.unidad_id === filtroUnidad || (!l.unidad_id && filtroUnidad === 'area')) &&
    (filtroPeriodo === '' || l.periodo === filtroPeriodo)
  )

  const totalConsumo = lista.reduce((s, l) => s + (l.consumo ?? 0), 0)
  const totalCosto = lista.reduce((s, l) => s + (l.costo_total ?? 0), 0)
  const alertasFuga = lecturas.filter(l => l.alerta_fuga).length

  const consumoCalculado = form.lectura_actual && form.lectura_anterior
    ? Math.max(0, parseFloat(form.lectura_actual) - parseFloat(form.lectura_anterior))
    : null

  async function guardar() {
    if (!form.lectura_actual) {
      Swal.fire('Faltan datos', 'La lectura actual es obligatoria', 'warning'); return
    }
    if (!form.unidad_id && !form.area.trim()) {
      Swal.fire('Faltan datos', 'Selecciona una unidad o especifica un área', 'warning'); return
    }
    const consumo = consumoCalculado
    const costo_total = consumo != null && form.costo_unitario ? consumo * parseFloat(form.costo_unitario) : null
    setSaving(true)
    const { error } = await supabase.from('lecturas_medidor_gas').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      area: form.area.trim() || null,
      fecha: form.fecha,
      lectura_anterior: form.lectura_anterior ? parseFloat(form.lectura_anterior) : null,
      lectura_actual: parseFloat(form.lectura_actual),
      consumo,
      alerta_fuga: form.alerta_fuga,
      costo_unitario: form.costo_unitario ? parseFloat(form.costo_unitario) : null,
      costo_total,
      periodo: form.periodo || null,
      leido_por: form.leido_por.trim() || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    setForm(p => ({ ...p, lectura_anterior: '', lectura_actual: '', alerta_fuga: false, observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 3, display: 'block' }

  const columns: DataTableColumn<LecturaMedidorGas>[] = [
    {
      key: 'unidad_area',
      header: 'Unidad/Área',
      sortable: true,
      accessor: row => {
        const unidad = unidades.find(u => u.id === row.unidad_id)
        return unidad?.nombre ?? row.area ?? 'Área común'
      },
      render: row => {
        const unidad = unidades.find(u => u.id === row.unidad_id)
        return (
          <span style={{ fontWeight: 600 }}>
            {row.alerta_fuga && <span style={{ color: '#ef4444', marginRight: 4 }}>🚨</span>}
            {unidad?.nombre ?? row.area ?? 'Área común'}
          </span>
        )
      },
    },
    {
      key: 'periodo',
      header: 'Período',
      sortable: true,
      accessor: row => row.periodo ?? '',
      render: row => <span style={{ color: '#6b7280' }}>{row.periodo ?? '—'}</span>,
    },
    {
      key: 'fecha',
      header: 'Fecha',
      sortable: true,
      render: row => <span style={{ color: '#6b7280' }}>{row.fecha}</span>,
    },
    {
      key: 'lectura_anterior',
      header: 'Lect. anterior',
      sortable: true,
      align: 'right',
      accessor: row => row.lectura_anterior ?? 0,
      render: row => <span style={{ color: '#9ca3af' }}>{row.lectura_anterior?.toFixed(3) ?? '—'}</span>,
    },
    {
      key: 'lectura_actual',
      header: 'Lect. actual',
      sortable: true,
      align: 'right',
      accessor: row => row.lectura_actual,
      render: row => <span style={{ fontWeight: 600 }}>{row.lectura_actual.toFixed(3)}</span>,
    },
    {
      key: 'consumo',
      header: 'Consumo',
      sortable: true,
      align: 'right',
      accessor: row => row.consumo ?? 0,
      render: row => (
        <span style={{ color: '#6366f1', fontWeight: 600 }}>
          {row.consumo != null ? `${row.consumo.toFixed(3)} m³` : '—'}
        </span>
      ),
    },
    {
      key: 'costo_total',
      header: 'Costo',
      sortable: true,
      align: 'right',
      accessor: row => row.costo_total ?? 0,
      render: row => (
        <span style={{ color: '#10b981', fontWeight: 600 }}>
          {row.costo_total != null ? `${moneda} ${row.costo_total.toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      key: 'obs',
      header: '',
      render: row => (
        row.observaciones ? <span style={{ fontSize: 11, color: '#9ca3af' }} title={row.observaciones}>📝</span> : null
      ),
    },
  ]

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ background: '#eef2ff', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#6366f1' }}>{totalConsumo.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: '#6366f1' }}>m³ consumo total</div>
        </div>
        <div style={{ background: '#d1fae5', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{moneda} {totalCosto.toLocaleString()}</div>
          <div style={{ fontSize: 11, color: '#10b981' }}>Costo total</div>
        </div>
        <div style={{ background: alertasFuga > 0 ? '#fef2f2' : '#f3f4f6', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: alertasFuga > 0 ? '#ef4444' : '#6b7280' }}>{alertasFuga}</div>
          <div style={{ fontSize: 11, color: alertasFuga > 0 ? '#ef4444' : '#6b7280' }}>Alertas de fuga</div>
        </div>
        <div style={{ background: '#f9fafb', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#374151' }}>{lecturas.length}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Lecturas registradas</div>
        </div>
      </div>

      {/* Alerta fugas */}
      {alertasFuga > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#ef4444' }}>
          🚨 <strong>{alertasFuga} alerta{alertasFuga > 1 ? 's' : ''} de fuga detectada{alertasFuga > 1 ? 's' : ''}</strong> — revisar con urgencia
        </div>
      )}

      {/* Botón nueva lectura */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva lectura'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nueva lectura de gas</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                <option value="">— Área común —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            {!form.unidad_id && (
              <div>
                <label style={lbl}>Área</label>
                <input style={inp} placeholder="Cocina comunitaria…" value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} />
              </div>
            )}
            <div>
              <label style={lbl}>Fecha</label>
              <input type="date" style={inp} value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Período</label>
              <input style={inp} placeholder="2026-04" value={form.periodo} onChange={e => setForm(p => ({ ...p, periodo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Lectura anterior (m³)</label>
              <input type="number" step="0.001" style={inp} value={form.lectura_anterior} onChange={e => setForm(p => ({ ...p, lectura_anterior: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Lectura actual (m³) *</label>
              <input type="number" step="0.001" style={inp} value={form.lectura_actual} onChange={e => setForm(p => ({ ...p, lectura_actual: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Consumo (m³)</label>
              <div style={{ ...inp, background: '#f3f4f6', color: consumoCalculado != null ? '#374151' : '#9ca3af' }}>
                {consumoCalculado != null ? `${consumoCalculado.toFixed(3)} m³` : 'Auto-calculado'}
              </div>
            </div>
            <div>
              <label style={lbl}>Costo unitario ({moneda}/m³)</label>
              <input type="number" step="0.0001" style={inp} value={form.costo_unitario} onChange={e => setForm(p => ({ ...p, costo_unitario: e.target.value }))} />
            </div>
            {consumoCalculado != null && form.costo_unitario && (
              <div>
                <label style={lbl}>Costo total estimado</label>
                <div style={{ ...inp, background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>
                  {moneda} {(consumoCalculado * parseFloat(form.costo_unitario)).toFixed(2)}
                </div>
              </div>
            )}
            <div>
              <label style={lbl}>Leído por</label>
              <input style={inp} value={form.leido_por} onChange={e => setForm(p => ({ ...p, leido_por: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <input type="checkbox" id="fuga_check" checked={form.alerta_fuga} onChange={e => setForm(p => ({ ...p, alerta_fuga: e.target.checked }))} />
              <label htmlFor="fuga_check" style={{ fontSize: 13, cursor: 'pointer', color: form.alerta_fuga ? '#ef4444' : '#374151' }}>
                🚨 Alerta de fuga
              </label>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Observaciones</label>
              <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Registrar'}
          </button>
        </div>
      )}

      <DataTable
        data={lista}
        columns={columns}
        rowKey="id"
        searchableKeys={[
          row => unidades.find(u => u.id === row.unidad_id)?.nombre ?? row.area ?? '',
          row => row.observaciones ?? '',
          row => row.leido_por ?? '',
        ]}
        searchPlaceholder="Buscar por unidad, área, observaciones…"
        filters={[
          {
            key: 'unidad',
            value: filtroUnidad,
            onChange: setFiltroUnidad,
            options: [
              { value: '', label: 'Todas las unidades' },
              ...unidades.map(u => ({ value: u.id, label: u.nombre })),
              { value: 'area', label: 'Áreas comunes' },
            ],
          },
          {
            key: 'periodo',
            value: filtroPeriodo,
            onChange: setFiltroPeriodo,
            options: [
              { value: '', label: 'Todos los períodos' },
              ...periodos.map(p => ({ value: p, label: p })),
            ],
          },
        ]}
        pageSizeOptions={[25, 50, 100, 200]}
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        rowStyle={row => row.alerta_fuga ? { background: '#fef2f2' } : {}}
        emptyState={{ icon: '🔥', title: 'Sin lecturas para los filtros seleccionados' }}
      />
    </div>
  )
}
