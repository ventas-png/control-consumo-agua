import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import { notify } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { LecturaMedidorGas, Unidad } from '../../../types'

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
      notify({ variant: 'warning', title: 'Faltan datos', text: 'La lectura actual es obligatoria' }); return
    }
    if (!form.unidad_id && !form.area.trim()) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Selecciona una unidad o especifica un área' }); return
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
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm(p => ({ ...p, lectura_anterior: '', lectura_actual: '', alerta_fuga: false, observaciones: '' }))
    setMostrarForm(false)
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-accent-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-accent)' }}>{totalConsumo.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: 'var(--at-accent)' }}>m³ consumo total</div>
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {totalCosto.toLocaleString()}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Costo total</div>
        </div>
        <div style={{ background: alertasFuga > 0 ? 'var(--at-danger-tint)' : 'var(--at-chip)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: alertasFuga > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{alertasFuga}</div>
          <div style={{ fontSize: 11, color: alertasFuga > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Alertas de fuga</div>
        </div>
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-ink-2)' }}>{lecturas.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Lecturas registradas</div>
        </div>
      </div>

      {/* Alerta fugas */}
      {alertasFuga > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--at-danger)' }}>
          🚨 <strong>{alertasFuga} alerta{alertasFuga > 1 ? 's' : ''} de fuga detectada{alertasFuga > 1 ? 's' : ''}</strong> — revisar con urgencia
        </div>
      )}

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...inp, width: 'auto' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            <option value="area">Áreas comunes</option>
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)}>
            <option value="">Todos los períodos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <span style={{ fontSize: 13, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} lecturas</span>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-warning)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nueva lectura'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
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
              <div style={{ ...inp, background: 'var(--at-chip)', color: consumoCalculado != null ? 'var(--at-ink-2)' : 'var(--at-ink-3)' }}>
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
                <div style={{ ...inp, background: 'var(--at-success-tint)', color: 'var(--at-success)', fontWeight: 600 }}>
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
              <label htmlFor="fuga_check" style={{ fontSize: 13, cursor: 'pointer', color: form.alerta_fuga ? 'var(--at-danger)' : 'var(--at-ink-2)' }}>
                🚨 Alerta de fuga
              </label>
            </div>
            <div style={{ gridColumn: 'span 3' }}>
              <label style={lbl}>Observaciones</label>
              <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Registrar'}
          </button>
        </div>
      )}

      {/* Tabla de lecturas — F3.9: migrado a <DataTable> shared */}
      <DataTable<LecturaMedidorGas>
        data={lista}
        rowKey="id"
        pageSize={30}
        searchableKeys={['area']}
        searchPlaceholder="Buscar área..."
        emptyState={{ icon: '🔥', title: 'Sin lecturas para los filtros seleccionados' }}
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        rowStyle={(l) => l.alerta_fuga ? { background: 'var(--at-danger-tint)' } : {}}
        columns={[
          { key: 'unidad', header: 'Unidad/Área', sortable: true,
            accessor: (l) => unidades.find(u => u.id === l.unidad_id)?.nombre ?? l.area ?? '',
            render: (l) => (
              <span style={{ fontWeight: 600 }}>
                {l.alerta_fuga && <span style={{ color: 'var(--at-danger)', marginRight: 4 }}>🚨</span>}
                {unidades.find(u => u.id === l.unidad_id)?.nombre ?? l.area ?? 'Área común'}
              </span>
            ),
          },
          { key: 'periodo', header: 'Período', sortable: true, hideOnMobile: true, render: (l) => l.periodo ?? '—' },
          { key: 'fecha', header: 'Fecha', sortable: true },
          { key: 'lectura_anterior', header: 'Lect. ant.', align: 'right', hideOnMobile: true,
            render: (l) => l.lectura_anterior?.toFixed(3) ?? '—' },
          { key: 'lectura_actual', header: 'Lect. act.', align: 'right', render: (l) => l.lectura_actual.toFixed(3) },
          { key: 'consumo', header: 'Consumo', align: 'right', sortable: true,
            render: (l) => l.consumo != null
              ? <span style={{ color: 'var(--at-accent)', fontWeight: 600 }}>{l.consumo.toFixed(3)} m³</span>
              : '—' },
          { key: 'costo_total', header: 'Costo', align: 'right', sortable: true,
            render: (l) => l.costo_total != null
              ? <span style={{ color: 'var(--at-success)', fontWeight: 600 }}>{moneda} {l.costo_total.toFixed(2)}</span>
              : '—' },
          { key: 'observaciones', header: '', hideOnMobile: true,
            render: (l) => l.observaciones
              ? <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }} title={l.observaciones}>📝</span>
              : null },
        ] satisfies DataTableColumn<LecturaMedidorGas>[]}
      />
    </div>
  )
}
