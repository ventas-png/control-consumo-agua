import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import type { PlanPagoCond, CuotaPlanPago } from '../../../types'
import type { Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  planes: PlanPagoCond[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  activo:      { bg: '#e0f2fe', color: '#0369a1', label: 'Activo' },
  completado:  { bg: '#dcfce7', color: '#16a34a', label: 'Completado' },
  incumplido:  { bg: '#fee2e2', color: '#ef4444', label: 'Incumplido' },
  cancelado:   { bg: '#f1f5f9', color: '#94a3b8', label: 'Cancelado' },
}

const BLANK = { unidad_id: '', concepto: '', monto_total: '', num_cuotas: '3', fecha_inicio: new Date().toISOString().slice(0, 10), notas: '', aprobado_por: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }
function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function PlanPagoCondTab({ planes, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<PlanPagoCond | null>(null)
  const [cuotas, setCuotas] = useState<CuotaPlanPago[]>([])
  const [loadingCuotas, setLoadingCuotas] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activo' | 'completado' | 'incumplido' | 'cancelado'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  const fetchCuotas = useCallback(async (planId: string) => {
    setLoadingCuotas(true)
    const { data } = await supabase.from('cuotas_plan_pago').select('*').eq('plan_id', planId).order('numero')
    setCuotas((data ?? []) as CuotaPlanPago[])
    setLoadingCuotas(false)
  }, [])

  useEffect(() => { if (selected) fetchCuotas(selected.id) }, [selected, fetchCuotas])

  async function handleSave() {
    if (!form.unidad_id) return Swal.fire('Requerido', 'Seleccione una unidad.', 'warning')
    if (!form.concepto.trim()) return Swal.fire('Requerido', 'El concepto es obligatorio.', 'warning')
    const montoTotal = parseFloat(form.monto_total)
    const numCuotas = parseInt(form.num_cuotas)
    if (!montoTotal || montoTotal <= 0) return Swal.fire('Requerido', 'El monto total debe ser mayor a 0.', 'warning')
    if (!numCuotas || numCuotas < 1) return Swal.fire('Requerido', 'El número de cuotas debe ser al menos 1.', 'warning')

    const montoCuota = parseFloat((montoTotal / numCuotas).toFixed(2))
    setSaving(true)

    const { data: plan, error } = await supabase.from('planes_pago_condominio').insert({
      company_id: companyId, project_id: proyectoId, unidad_id: form.unidad_id,
      concepto: form.concepto.trim(), monto_total: montoTotal, num_cuotas: numCuotas,
      monto_cuota: montoCuota, fecha_inicio: form.fecha_inicio,
      notas: form.notas || null, aprobado_por: form.aprobado_por || null,
    }).select().single()

    if (error || !plan) { setSaving(false); return Swal.fire('Error', error?.message ?? 'Error al crear plan', 'error') }

    // Generate installments
    const installments = Array.from({ length: numCuotas }, (_, i) => ({
      company_id: companyId, plan_id: plan.id,
      numero: i + 1, monto: montoCuota,
      fecha_vencimiento: addMonths(form.fecha_inicio, i + 1),
    }))
    await supabase.from('cuotas_plan_pago').insert(installments)

    setSaving(false)
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar plan de pago?', text: 'Se eliminarán todas sus cuotas.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('planes_pago_condominio').delete().eq('id', id)
    if (selected?.id === id) { setSelected(null); setCuotas([]) }
    onRefresh()
  }

  async function cambiarEstadoPlan(id: string, estado: string) {
    await supabase.from('planes_pago_condominio').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function marcarCuotaPagada(cuota: CuotaPlanPago) {
    const pagado = !cuota.pagado
    const update: Record<string, unknown> = { pagado, fecha_pago: pagado ? new Date().toISOString().slice(0, 10) : null }
    await supabase.from('cuotas_plan_pago').update(update).eq('id', cuota.id)

    // Check if plan is complete
    if (pagado && selected) {
      const { data: all } = await supabase.from('cuotas_plan_pago').select('id, pagado').eq('plan_id', selected.id)
      const todasPagadas = (all ?? []).every(c => c.id === cuota.id ? true : c.pagado)
      if (todasPagadas) await supabase.from('planes_pago_condominio').update({ estado: 'completado' }).eq('id', selected.id)
    }
    fetchCuotas(selected!.id)
    onRefresh()
  }

  const today = new Date().toISOString().slice(0, 10)
  const filtered = filtroEstado === 'todos' ? planes : planes.filter(p => p.estado === filtroEstado)
  const montoCuotaPreview = form.monto_total && form.num_cuotas
    ? (parseFloat(form.monto_total) / parseInt(form.num_cuotas)).toFixed(2)
    : ''

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Planes de Pago</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>Acuerdos de pago para unidades con saldo en mora</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Plan
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {Object.entries(ESTADO_STYLE).map(([estado, s]) => (
          <div key={estado} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: 800, color: s.color }}>{planes.filter(p => p.estado === estado).length}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nuevo Plan de Pago</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Concepto *</label>
              <input style={inputStyle} value={form.concepto} onChange={e => setF('concepto', e.target.value)} placeholder="Ej: Deuda cuotas mantenimiento Q1 2026" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Monto total ({moneda}) *</label>
              <input style={inputStyle} type="number" step="0.01" value={form.monto_total} onChange={e => setF('monto_total', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Número de cuotas *</label>
              <input style={inputStyle} type="number" min="1" max="60" value={form.num_cuotas} onChange={e => setF('num_cuotas', e.target.value)} />
            </div>
            {montoCuotaPreview && (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ background: '#e0f2fe', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', color: '#0369a1', fontWeight: 700 }}>
                  ≈ {moneda} {montoCuotaPreview} / cuota
                </div>
              </div>
            )}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Primera cuota vence</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Aprobado por</label>
              <input style={inputStyle} value={form.aprobado_por} onChange={e => setF('aprobado_por', e.target.value)} placeholder="Nombre del aprobador" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Condiciones, observaciones…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Creando…' : 'Crear plan'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'activo', 'completado', 'incumplido', 'cancelado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === f ? '#e0f2fe' : 'white',
              color: filtroEstado === f ? '#0369a1' : '#64748b',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* Plans list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay planes de pago.</div>
          ) : filtered.map(p => {
            const unidad = unidades.find(u => u.id === p.unidad_id)
            const es = ESTADO_STYLE[p.estado] ?? ESTADO_STYLE.activo
            return (
              <div key={p.id} onClick={() => setSelected(selected?.id === p.id ? null : p)}
                style={{ background: 'white', border: `1.5px solid ${selected?.id === p.id ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{p.concepto}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {unidad && <span>🏠 {unidad.nombre}</span>}
                      <span>💰 {fmt(Number(p.monto_total), moneda)}</span>
                      <span>📋 {p.num_cuotas} cuotas de {fmt(Number(p.monto_cuota), moneda)}</span>
                      <span>📅 Desde {p.fecha_inicio}</span>
                    </div>
                    {p.aprobado_por && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>Aprobado por: {p.aprobado_por}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {p.estado === 'activo' && (
                        <button onClick={() => cambiarEstadoPlan(p.id, 'incumplido')}
                          style={{ padding: '3px 7px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          Incumplido
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Cuotas panel */}
        {selected && (
          <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
            <h3 style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: 700 }}>
              Cuotas — {selected.concepto}
            </h3>
            {loadingCuotas ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '12px' }}>Cargando…</div>
            ) : (
              <>
                {/* Progress */}
                {cuotas.length > 0 && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                      <span>{cuotas.filter(c => c.pagado).length}/{cuotas.length} pagadas</span>
                      <span>{Math.round(cuotas.filter(c => c.pagado).length / cuotas.length * 100)}%</span>
                    </div>
                    <div style={{ height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${cuotas.filter(c => c.pagado).length / cuotas.length * 100}%`, background: '#10b981', borderRadius: '3px', transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {cuotas.map(c => {
                    const vencida = !c.pagado && c.fecha_vencimiento < today
                    return (
                      <div key={c.id} style={{ background: 'white', borderRadius: '7px', padding: '8px 10px', border: `1px solid ${vencida ? '#fca5a5' : '#e2e8f0'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: '#374151' }}>Cuota #{c.numero}</span>
                          <span style={{ fontSize: '12px', color: '#0ea5e9', fontWeight: 600, marginLeft: '8px' }}>{fmt(Number(c.monto), moneda)}</span>
                          <div style={{ fontSize: '10px', color: vencida ? '#ef4444' : '#94a3b8' }}>
                            Vence: {c.fecha_vencimiento}{vencida ? ' ⚠️ Vencida' : ''}
                          </div>
                          {c.fecha_pago && <div style={{ fontSize: '10px', color: '#10b981' }}>Pagado: {c.fecha_pago}</div>}
                        </div>
                        {canEdit && (
                          <button onClick={() => marcarCuotaPagada(c)}
                            style={{ padding: '4px 9px', background: c.pagado ? '#dcfce7' : '#f1f5f9', color: c.pagado ? '#16a34a' : '#64748b', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                            {c.pagado ? '✓ Pagado' : 'Marcar pagado'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
