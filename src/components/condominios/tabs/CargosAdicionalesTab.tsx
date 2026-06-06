import { useState, type CSSProperties} from 'react'
import { createCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../shared/Dialog'
import { CargoAdicionalUnidad, CategoriaCargoAdicional, EstadoCargoAdicional, Unidad } from '../../../types'

interface Props {
  cargos: CargoAdicionalUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaCargoAdicional; label: string; icon: string; color: string }[] = [
  { value: 'reparacion',     label: 'Reparación',      icon: '🔧', color: 'var(--at-accent)' },
  { value: 'exceso_consumo', label: 'Exceso consumo',  icon: '💧', color: 'var(--at-primary-2)' },
  { value: 'dano',           label: 'Daño',            icon: '⚠️', color: 'var(--at-danger)' },
  { value: 'servicio',       label: 'Servicio extra',  icon: '🛎️', color: 'var(--at-accent)' },
  { value: 'multa',          label: 'Multa',           icon: '⚖️', color: 'var(--at-warning)' },
  { value: 'otro',           label: 'Otro',            icon: '📄', color: 'var(--at-ink-3)' },
]

const ESTADOS: { value: EstadoCargoAdicional; label: string; color: string; bg: string }[] = [
  { value: 'pendiente', label: 'Pendiente', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'pagado',    label: 'Pagado',    color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  { value: 'anulado',   label: 'Anulado',   color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
]

export default function CargosAdicionalesTab({ cargos, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<EstadoCargoAdicional | ''>('pendiente')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    unidad_id: '', concepto: '', categoria: 'otro' as CategoriaCargoAdicional,
    monto: '', fecha_cargo: new Date().toISOString().split('T')[0],
    fecha_vencimiento: '', referencia: '', observaciones: '',
  })

  const lista = cargos.filter(c =>
    (filtroUnidad === '' || c.unidad_id === filtroUnidad) &&
    (filtroEstado === '' || c.estado === filtroEstado)
  )

  const totalPendiente = cargos.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0)
  const totalCobrado = cargos.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)

  // Group by unidad
  const porUnidad = lista.reduce<Record<string, CargoAdicionalUnidad[]>>((acc, c) => {
    const k = c.unidad_id
    if (!acc[k]) acc[k] = []
    acc[k].push(c)
    return acc
  }, {})

  async function guardar() {
    if (!form.unidad_id || !form.concepto.trim() || !form.monto) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Unidad, concepto y monto son obligatorios' }); return
    }
    setSaving(true)
    const { error } = await createCondominioRow('cargos_adicionales_unidad', {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id, concepto: form.concepto.trim(),
      categoria: form.categoria, monto: parseFloat(form.monto),
      fecha_cargo: form.fecha_cargo,
      fecha_vencimiento: form.fecha_vencimiento || null,
      referencia: form.referencia.trim() || null,
      observaciones: form.observaciones.trim() || null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    setForm({ unidad_id: '', concepto: '', categoria: 'otro', monto: '', fecha_cargo: new Date().toISOString().split('T')[0], fecha_vencimiento: '', referencia: '', observaciones: '' })
    setMostrarForm(false)
    onRefresh()
  }

  async function marcarPagado(c: CargoAdicionalUnidad) {
    const { error } = await updateCondominioRow('cargos_adicionales_unidad', c.id, { estado: 'pagado' as EstadoCargoAdicional })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function anular(c: CargoAdicionalUnidad) {
    const res = await confirm({ title: 'Anular cargo', text: '¿Confirmar anulación?', icon: 'warning', variant: 'danger', confirmText: 'Anular' })
    if (!res.isConfirmed) return
    await updateCondominioRow('cargos_adicionales_unidad', c.id, { estado: 'anulado' as EstadoCargoAdicional })
    onRefresh()
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total pendiente', value: `${moneda} ${totalPendiente.toLocaleString()}`, color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
          { label: 'Total cobrado', value: `${moneda} ${totalCobrado.toLocaleString()}`, color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Registros activos', value: cargos.filter(c => c.estado === 'pendiente').length, color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 12, color: k.color }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select style={{ ...inp, width: 'auto' }} value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <select style={{ ...inp, width: 'auto' }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as EstadoCargoAdicional | '')}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>
        {canCreate && (
          <button onClick={() => setMostrarForm(!mostrarForm)}
            style={{ padding: '8px 16px', background: 'var(--at-accent)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {mostrarForm ? '✕ Cancelar' : '+ Nuevo cargo'}
          </button>
        )}
      </div>

      {/* Formulario */}
      {mostrarForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>Nuevo cargo adicional</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={lbl}>Unidad *</label>
              <select style={inp} value={form.unidad_id} onChange={e => setForm(p => ({ ...p, unidad_id: e.target.value }))}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={lbl}>Concepto *</label>
              <input style={inp} placeholder="Reparación fuga agua, exceso consumo…" value={form.concepto} onChange={e => setForm(p => ({ ...p, concepto: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Categoría</label>
              <select style={inp} value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value as CategoriaCargoAdicional }))}>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Monto ({moneda}) *</label>
              <input type="number" style={inp} value={form.monto} onChange={e => setForm(p => ({ ...p, monto: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha cargo</label>
              <input type="date" style={inp} value={form.fecha_cargo} onChange={e => setForm(p => ({ ...p, fecha_cargo: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Fecha vencimiento</label>
              <input type="date" style={inp} value={form.fecha_vencimiento} onChange={e => setForm(p => ({ ...p, fecha_vencimiento: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Referencia</label>
              <input style={inp} placeholder="Ticket, factura…" value={form.referencia} onChange={e => setForm(p => ({ ...p, referencia: e.target.value }))} />
            </div>
            <div>
              <label style={lbl}>Observaciones</label>
              <input style={inp} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>
          </div>
          <button onClick={guardar} disabled={saving}
            style={{ padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
            {saving ? 'Guardando…' : '✅ Crear cargo'}
          </button>
        </div>
      )}

      {/* Lista agrupada */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>Sin cargos para los filtros seleccionados</div>
      ) : (
        Object.entries(porUnidad).map(([unidadId, items]) => {
          const unidad = unidades.find(u => u.id === unidadId)
          const totalUnidad = items.reduce((s, c) => s + c.monto, 0)
          return (
            <div key={unidadId} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid var(--at-line)' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>🏠 {unidad?.nombre || 'Unidad'}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--at-warning)' }}>{moneda} {totalUnidad.toLocaleString()}</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {items.map(c => {
                  const cat = CATEGORIAS.find(k => k.value === c.categoria)
                  const est = ESTADOS.find(e => e.value === c.estado)
                  const vencido = c.fecha_vencimiento && new Date(c.fecha_vencimiento) < new Date() && c.estado === 'pendiente'
                  return (
                    <div key={c.id} style={{ background: 'var(--at-surface)', border: `1px solid ${vencido ? 'var(--at-danger-border)' : 'var(--at-line)'}`, borderRadius: 8, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: cat?.color + '20', color: cat?.color }}>{cat?.icon} {cat?.label}</span>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{c.concepto}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 3 }}>
                          {c.fecha_cargo}
                          {c.fecha_vencimiento && <span> · Vence: <span style={{ color: vencido ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{c.fecha_vencimiento}</span></span>}
                          {c.referencia && <span> · Ref: {c.referencia}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: 16, color: c.estado === 'pagado' ? 'var(--at-success)' : 'var(--at-danger)' }}>
                          {moneda} {c.monto.toLocaleString()}
                        </span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: est?.bg, color: est?.color }}>{est?.label}</span>
                        {canEdit && c.estado === 'pendiente' && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => marcarPagado(c)}
                              style={{ padding: '4px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                              ✓ Pagado
                            </button>
                            <button onClick={() => anular(c)}
                              style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                              Anular
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
